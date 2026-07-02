// Project Blue Book historical layer (Phase 3). Parses the Berliner catalog of
// Blue Book "unknowns" — the ~585 cases the USAF's own investigation closed as
// unidentified (1947-1969) — into UAPRecords for the low-emphasis basemap under
// the PURSUE hero layer. Run via `pnpm bluebook`; output is data/bluebook.json.
//
// Sources (both read from gitignored data/raw/, downloaded once by hand):
//   data/raw/bluebook/unknowns.html   NICAP's hosting of Don Berliner's catalog
//     (Fund for UFO Research), compiled from the public-domain Blue Book files at
//     Maxwell AFB. We extract FACTS ONLY — date and location, which came from the
//     government case files — and deliberately do not commit the catalog's prose.
//   data/raw/gazetteer/               GeoNames dumps (cities1000.txt,
//     admin1CodesASCII.txt, countryInfo.txt) — CC BY 4.0, attribution in DATA.md.
//     Deterministic offline geocoding at city precision; misses are flagged and
//     stay unplotted, never guessed. data/bluebook-locations.json (committed,
//     same shape as locations.json) overrides the gazetteer for curated entries.
//
// Idempotent: pure function of the two inputs; the output write is skipped when
// nothing changed. Fails loud when an input is missing, naming the download step.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { UAPRecord } from "../schema";
import { normalizeDate } from "./parse";
import { parseLocationTable, type LocationTable } from "./geocode";
import { readJson } from "./io";

const SOURCE_HTML = join("data", "raw", "bluebook", "unknowns.html");
const SOURCE_URL = "https://www.nicap.org/bluebook/unknowns.htm";
const GAZETTEER_DIR = join("data", "raw", "gazetteer");
const OVERRIDES_PATH = join("data", "bluebook-locations.json");
const OUT_PATH = join("data", "bluebook.json");

// ── entry extraction ────────────────────────────────────────────────────────

// A catalog entry begins "Month D, YYYY; Location. ..." (separator drifts to a
// period in places; day ranges like "June 3-7" occur). Everything after the
// location sentence is Berliner's prose and is not extracted.
const ENTRY_START =
  /^((?:Jan|Feb|March|April|May|June|July|Aug|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:\s*-\s*\d{1,2})?,\s*\d{4})\s*[;.]\s*(.*)$/;

// The location sentence ends at the first period followed by what reads as the
// start of the time/witness clause (a digit — including the scan's OCR habit of
// rendering a leading 1 as the letter "l" — or a known clause opener). Tradeoff:
// a location containing ". <digit>" ("Highway No. 5") would truncate there; none
// exist in the catalog, and a truncated location degrades to a flagged geocode
// miss rather than a wrong plot.
const LOCATION_END =
  /^(.*?)\.\s+(?=[0-9#]|l[0-9lO:]|Z:|After|At\b|Between|About|Approx|Daytime|Day\b|Night|Witness|Early|Late|Dusk|Dawn|Evening|Morning|Afternoon|Midnight|Noon|No time|Unknown|Twilight|Sunset|Sunrise|Time|Local)/;

// A time fragment glued onto the location when the catalog omitted the period
// ("Gulfport, Mississippi 12:12 p.m") — stripped, OCR'd l-for-1 included. The
// leading clock digits are REQUIRED so place names containing "am" (Alabama,
// Amsterdam) can never match.
const TRAILING_TIME = /[.,]?\s+[0-9lO][0-9lO:.]*\s*(?:a\.?\s?m|p\.?\s?m)\b\.?.*$/i;

interface CatalogEntry {
  raw: string; // "<date>; <location>" — the extracted facts, id source
  date: string | null;
  locationRaw: string;
}

// Blue Book ran 1947 - Dec 1969. The scan OCRs a handful of 5s as 8s ("June 25,
// 1982" sits between 1952 entries on the page), so a year outside the program
// window is corrected when swapping exactly one of its 8s to a 5 lands inside
// the window; anything else out-of-window becomes null — an impossible date is
// worse than an absent one.
function fixCatalogYear(date: string | null): string | null {
  if (date === null) return date;
  const year = String(date.slice(0, 4));
  const inWindow = (y: number) => y >= 1947 && y <= 1969;
  if (inWindow(Number(year))) return date;
  for (let i = 0; i < year.length; i++) {
    if (year[i] !== "8") continue;
    const fixed = Number(`${year.slice(0, i)}5${year.slice(i + 1)}`);
    if (inWindow(fixed)) return `${fixed}${date.slice(4)}`;
  }
  return null;
}

export function parseCatalog(htmlText: string): CatalogEntry[] {
  // The source file hand-wraps long paragraphs, so a physical newline INSIDE a
  // <p> is mid-sentence, not an entry boundary — join those first, then let the
  // HTML tags (each entry is its own <p>) become the real line breaks. Without
  // this, an entry whose location clause wraps the physical line is silently
  // truncated — a garbled fact, worse than a dropped one.
  const text = htmlText
    .replace(/\r?\n/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;|&[a-z]+;/gi, " ");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "");

  const entries: CatalogEntry[] = [];
  for (const line of lines) {
    const m = ENTRY_START.exec(line);
    if (!m) continue;
    const dateText = m[1];
    const rest = m[2];
    const locMatch = LOCATION_END.exec(rest);
    // Fall back to the first sentence; a mangled entry yields a geocode miss, not a crash.
    const locationRaw = (locMatch?.[1] ?? rest.split(". ")[0] ?? "")
      .replace(TRAILING_TIME, "")
      .replace(/[.\s]+$/, "")
      .trim();
    entries.push({
      raw: `${dateText}; ${locationRaw}`,
      date: fixCatalogYear(normalizeDate(dateText)),
      locationRaw,
    });
  }
  return entries;
}

// ── gazetteer geocoding ─────────────────────────────────────────────────────

interface GazetteerHit {
  lat: number;
  lon: number;
}

interface Gazetteer {
  // "city|CC|ADMIN1" and "city|CC" -> highest-population match
  byKey: Map<string, GazetteerHit & { population: number }>;
  usStates: Map<string, string>; // "new mexico" -> "NM" (admin1 code)
  countries: Map<string, string>; // "canada" -> "CA"
}

function requireFile(path: string, hint: string): string {
  if (!existsSync(path)) {
    throw new Error(`ingest/bluebook: missing ${path} — ${hint}`);
  }
  return readFileSync(path, "utf8");
}

export function loadGazetteer(dir: string): Gazetteer {
  const hint = `download the GeoNames dumps into ${dir}/ (see DATA.md "The Blue Book layer")`;

  const usStates = new Map<string, string>();
  for (const line of requireFile(join(dir, "admin1CodesASCII.txt"), hint).split("\n")) {
    const [code, name] = line.split("\t");
    if (code?.startsWith("US.") && name) usStates.set(name.toLowerCase(), code.slice(3));
  }

  const countries = new Map<string, string>();
  for (const line of requireFile(join(dir, "countryInfo.txt"), hint).split("\n")) {
    if (line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols[0]?.length === 2 && cols[4]) countries.set(cols[4].toLowerCase(), cols[0]);
  }

  const byKey = new Map<string, GazetteerHit & { population: number }>();
  const put = (key: string, hit: GazetteerHit & { population: number }) => {
    const prior = byKey.get(key);
    if (!prior || hit.population > prior.population) byKey.set(key, hit);
  };
  for (const line of requireFile(join(dir, "cities1000.txt"), hint).split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 15) continue;
    const [, name, asciiname] = cols;
    const lat = Number(cols[4]);
    const lon = Number(cols[5]);
    const cc = cols[8];
    const admin1 = cols[10];
    const population = Number(cols[14]) || 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !cc) continue;
    const hit = { lat, lon, population };
    for (const n of new Set([name.toLowerCase(), asciiname.toLowerCase()])) {
      if (!n) continue;
      put(`${n}|${cc}|${admin1}`, hit);
      put(`${n}|${cc}`, hit);
    }
  }
  return { byKey, usStates, countries };
}

// Leading qualifiers that don't change which gazetteer entry we want. "near X"
// resolves to X at city precision — within the honesty budget of a city point.
const QUALIFIER = /^(?:near|over|off|outside|vicinity of)\s+/i;

// Historical/colloquial region names -> ISO country codes the gazetteer uses.
// Deterministic aliases for the catalog's 1947-69 vocabulary; a name not here and
// not in countryInfo stays a miss for the curated override table.
const COUNTRY_ALIASES: Record<string, string> = {
  "west germany": "DE",
  "east germany": "DE",
  "french morocco": "MA",
  okinawa: "JP",
  korea: "KR",
  "south korea": "KR",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "philippine islands": "PH",
  "phillipine islands": "PH",
  "french indo china": "VN",
  newfoundland: "CA",
  labrador: "CA",
  "azores islands": "PT",
  azores: "PT",
  massachusette: "US:MA", // catalog typo; the colon form pins a US state
  "long island": "US:NY",
};

// Installation suffixes: "Rome AFB, New York" plots at Rome, NY — the base is
// named for (and sits by) the town; city precision remains honest. A base whose
// name isn't its town's ("McChord", "Tyndall") misses and gets curated instead.
const INSTALLATION =
  /\s+(?:AFB|AB|Air\s+Base|Air\s+Force\s+Base|Air\s+Depot|Air\s+Force\s+Station|Naval\s+Air\s+Station|NAS|Field|State\s+Park|National\s+Park|Airport)$/i;

// Catalog abbreviations the gazetteer spells out.
function expandAbbreviations(s: string): string {
  return s
    .replace(/^Ft\.?\s+/i, "Fort ")
    .replace(/^Mt\.?\s+/i, "Mount ")
    .replace(/^Pt\.?\s+/i, "Point ");
}

// The gazetteer's canonical name differs from the catalog's for a few cities.
const CITY_ALIASES: Record<string, string> = {
  "new york": "new york city",
};

// A handful of entries embed the report's own coordinates — "(34 55 N., 164 05 E.)",
// "(19* N., 172* E.)", and occasionally longitude-first "(129* 51 E., 34 19 N.)"
// (the scan renders the degree sign as "*"; minutes are sometimes omitted). Exact
// coordinates given -> the "point" tier, per the DATA.md precision table.
const LAT = /(\d{1,2})[*°']?(?:\s+(\d{1,2}))?\s*N\.?/;
const LON = /(\d{1,3})[*°']?(?:\s+(\d{1,2}))?\s*([EW])\b/;

function parseEmbeddedCoords(locationRaw: string): BBGeo | null {
  // Only a parenthetical coordinate annotation counts — matching lat/lon loose in
  // the string could stitch a "coordinate" out of two unrelated digit groups.
  const paren = /\(([^)]*)\)/.exec(locationRaw);
  if (!paren) return null;
  const latM = LAT.exec(paren[1]);
  const lonM = LON.exec(paren[1]);
  if (!latM || !lonM) return null;
  const lat = Number(latM[1]) + Number(latM[2] ?? 0) / 60;
  const lon = (Number(lonM[1]) + Number(lonM[2] ?? 0) / 60) * (lonM[3] === "W" ? -1 : 1);
  if (lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon, geoPrecision: "point" };
}

export interface BBGeo {
  lat: number | null;
  lon: number | null;
  geoPrecision: UAPRecord["geoPrecision"];
}

export function geocodeBBLocation(
  locationRaw: string,
  gaz: Gazetteer,
  overrides: LocationTable,
): BBGeo {
  const unresolved: BBGeo = { lat: null, lon: null, geoPrecision: "unknown" };

  // Curated overrides win (and a null override = curated unplottable).
  const over = overrides[locationRaw];
  if (over !== undefined) {
    return over === null ? unresolved : over;
  }

  const embedded = parseEmbeddedCoords(locationRaw);
  if (embedded !== null) return embedded;

  const cleaned = locationRaw.replace(QUALIFIER, "").trim();
  const parts = cleaned
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return unresolved; // no state/country hint — curate via overrides

  const tail = parts[parts.length - 1].toLowerCase().replace(/\.$/, "");
  const alias = COUNTRY_ALIASES[tail];
  const usState = alias?.startsWith("US:") ? alias.slice(3) : gaz.usStates.get(tail);
  const country = alias !== undefined && usState === undefined ? alias : gaz.countries.get(tail);

  const city = (name: string): BBGeo | null => {
    const n = expandAbbreviations(name).toLowerCase();
    const variants = [CITY_ALIASES[n] ?? n, n.replace(INSTALLATION, "").trim()];
    for (const v of variants) {
      if (!v) continue;
      const hit =
        usState !== undefined
          ? gaz.byKey.get(`${v}|US|${usState}`)
          : country !== undefined
            ? gaz.byKey.get(`${v}|${country}`)
            : undefined;
      if (hit) return { lat: hit.lat, lon: hit.lon, geoPrecision: "city" };
    }
    return null;
  };

  // "Offutt AFB, Omaha, Nebraska": the installation misses but its town resolves —
  // walk the leading parts in order and take the first that geocodes.
  for (const part of parts.slice(0, -1)) {
    const hit = city(part);
    if (hit !== null) return hit;
  }
  return unresolved;
}

// ── emit ────────────────────────────────────────────────────────────────────

function toRecord(entry: CatalogEntry, geo: BBGeo): UAPRecord {
  return {
    id: createHash("sha256").update(entry.raw).digest("hex").slice(0, 16),
    release: "bluebook",
    sourceAgency: "USAF",
    docType: "bb-unknown", // a Blue Book case the USAF closed as unidentified
    incidentDate: entry.date,
    locationRaw: entry.locationRaw,
    lat: geo.lat,
    lon: geo.lon,
    geoPrecision: geo.geoPrecision,
    objectClass: "unknown",
    resolved: false,
    redactionPct: null,
    summary: "", // facts only — the catalog's prose is not republished here
    sourceUrl: SOURCE_URL,
    media: {},
  };
}

export function run(): void {
  const html = requireFile(
    SOURCE_HTML,
    `download it once: curl -sL ${SOURCE_URL} -o ${SOURCE_HTML}`,
  );
  const entries = parseCatalog(html);
  if (entries.length < 400) {
    throw new Error(
      `ingest/bluebook: only ${entries.length} catalog entries parsed — the source page ` +
        `layout may have changed; refusing to emit a gutted basemap`,
    );
  }

  const overrides = existsSync(OVERRIDES_PATH)
    ? parseLocationTable(OVERRIDES_PATH, readJson(OVERRIDES_PATH))
    : {};
  const gaz = loadGazetteer(GAZETTEER_DIR);

  const misses = new Map<string, number>();
  const seen = new Map<string, CatalogEntry>();
  const records: UAPRecord[] = [];
  let dated = 0;
  let plotted = 0;

  for (const entry of entries) {
    const geo = geocodeBBLocation(entry.locationRaw, gaz, overrides);
    const record = toRecord(entry, geo);
    const dup = seen.get(record.id);
    if (dup) continue; // the page repeats a handful of entries verbatim; one record each
    seen.set(record.id, entry);
    if (record.incidentDate !== null) dated++;
    if (record.lat !== null) plotted++;
    else if (overrides[entry.locationRaw] !== null) {
      misses.set(entry.locationRaw, (misses.get(entry.locationRaw) ?? 0) + 1);
    }
    records.push(record);
  }

  records.sort((a, b) => a.id.localeCompare(b.id));
  const json = `${JSON.stringify(records, null, 2)}\n`;
  const changed = !existsSync(OUT_PATH) || readFileSync(OUT_PATH, "utf8") !== json;
  if (changed) writeFileSync(OUT_PATH, json, "utf8");

  console.log(
    `bluebook: ${records.length} unknowns — ${plotted} plotted (city), ${dated} dated, ` +
      `${misses.size} distinct unresolved locations`,
  );
  if (misses.size > 0) {
    console.warn(
      `\n  unresolved locations stay unplotted (honest). Curate the frequent ones into ` +
        `${OVERRIDES_PATH}:`,
    );
    for (const [loc, n] of [...misses].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.warn(`    · (${n}) ${loc}`);
    }
  }
  console.log(changed ? `bluebook: wrote ${OUT_PATH}` : `bluebook: ${OUT_PATH} already up to date`);
}

run();
