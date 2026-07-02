// Skeptic layer (Phase 4), first cross-reference: orbital launches near each
// incident. For every PURSUE record whose incidentDate has full day precision,
// list orbital launch attempts within ±1 day from Jonathan McDowell's GCAT
// launch log — presented in the drawer as neutral context ("prosaic candidates"),
// never as an explanation. Run via `pnpm skeptic`; output is data/skeptic.json.
//
// Source (gitignored, downloaded once by hand — the script prints the command):
//   data/raw/gcat/launch.tsv   GCAT launch list (planet4589.org/space/gcat)
//   data/raw/gcat/sites.tsv    GCAT site table (launch-site codes -> names)
// GCAT is CC BY 4.0 — "GCAT (J. McDowell, planet4589.org/space/gcat)"; the
// attribution also ships in the UI's method note and DATA.md.
//
// Only orbital attempts (LaunchCode O*) are candidates: they are the class of
// event a ground observer plausibly reports (boost plumes, fuel dumps, re-entering
// stages). Suborbital/missile rows would flood the window with sounding rockets.
// Idempotent: pure function of the two inputs; write skipped when unchanged.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SkepticCandidate, UAPRecord } from "../schema";

const RECORDS_PATH = join("data", "records.json");
const GCAT_DIR = join("data", "raw", "gcat");
const OUT_PATH = join("data", "skeptic.json");
const WINDOW_DAYS = 1;
const GCAT_BASE = "https://planet4589.org/space/gcat";

// Shape check only — calendar validity of UAPRecord.incidentDate is verified
// where it's consumed (the record loop fails loud on an impossible date).
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

function requireFile(name: string): string {
  const path = join(GCAT_DIR, name);
  if (!existsSync(path)) {
    throw new Error(
      `ingest/skeptic: missing ${path} — download it once: ` +
        `curl -sL -o ${path} ${GCAT_BASE}/tsv/${name === "launch.tsv" ? "launch" : "tables"}/${name}`,
    );
  }
  return readFileSync(path, "utf8");
}

// GCAT TSVs: first line is a '#'-prefixed tab-separated header; comment lines
// start with '#'. Column lookup is by header name so upstream re-ordering fails
// loud (missing column) instead of silently reading the wrong field.
function parseTsv(name: string, text: string): { col: (n: string) => number; rows: string[][] } {
  const lines = text.split("\n");
  const header =
    lines[0]
      ?.replace(/^#/, "")
      .split("\t")
      .map((h) => h.trim()) ?? [];
  const col = (n: string): number => {
    const i = header.indexOf(n);
    if (i === -1) throw new Error(`ingest/skeptic: ${name} has no "${n}" column (format change?)`);
    return i;
  };
  const rows = lines
    .slice(1)
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t").map((f) => f.trim()));
  return { col, rows };
}

// "2026 Jun 29 0225:00" / "1957 Oct 4" -> "2026-06-29" / "1957-10-04".
// Fuzzier GCAT dates return null and are skipped — including a "?" after the DAY
// ("2012 May 23?", GCAT's date-uncertain marker): an approximate launch date
// must not enter a ±1-day window with the same weight as a confirmed one.
function isoDay(gcatDate: string): string | null {
  const m = /^(\d{4})\s+([A-Z][a-z]{2})[a-z?]*\s+(\d{1,2})(\?)?(?=\s|$)/.exec(gcatDate);
  if (!m || m[4] !== undefined || !(m[2] in MONTHS)) return null;
  return `${m[1]}-${MONTHS[m[2]]}-${m[3].padStart(2, "0")}`;
}

// `iso` must be a real calendar day; callers validate (fail loud, naming the
// record) before shifting.
function shiftDay(iso: string, days: number): string {
  const t = Date.parse(`${iso}T12:00:00Z`); // noon avoids any DST edge
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

export function run(): void {
  const records = JSON.parse(readFileSync(RECORDS_PATH, "utf8")) as UAPRecord[];

  const sites = parseTsv("sites.tsv", requireFile("sites.tsv"));
  const siteName = new Map<string, string>();
  for (const row of sites.rows) {
    const code = row[sites.col("Site")];
    const name = row[sites.col("ShortName")] || row[sites.col("Name")];
    if (code && name && name !== "-") siteName.set(code, name);
  }

  const launches = parseTsv("launch.tsv", requireFile("launch.tsv"));
  const byDay = new Map<string, SkepticCandidate[]>();
  let orbital = 0;
  for (const row of launches.rows) {
    if (!row[launches.col("LaunchCode")]?.startsWith("O")) continue;
    const date = isoDay(row[launches.col("Launch_Date")]);
    if (date === null) continue;
    orbital++;
    const clean = (v: string | undefined): string => (v && v !== "-" ? v : "");
    const site = row[launches.col("Launch_Site")];
    const candidate: SkepticCandidate = {
      date,
      vehicle: clean(row[launches.col("LV_Type")]) || "unknown vehicle",
      payload:
        clean(row[launches.col("Flight")]) ||
        clean(row[launches.col("Mission")]) ||
        clean(row[launches.col("Flight_ID")]) ||
        "unnamed payload",
      site: siteName.get(site) ?? site ?? "",
    };
    const list = byDay.get(date) ?? [];
    list.push(candidate);
    byDay.set(date, list);
  }

  // Keyed by record id; a present-but-empty array means "checked, none found",
  // an absent id means "not checkable" (no day-precision date). The app renders
  // the two differently — that distinction is the honesty of the feature.
  const byId: Record<string, SkepticCandidate[]> = {};
  let checkable = 0;
  let withHits = 0;
  for (const r of records) {
    if (r.incidentDate === null || !FULL_DATE.test(r.incidentDate)) continue;
    if (Number.isNaN(Date.parse(`${r.incidentDate}T12:00:00Z`))) {
      throw new Error(
        `ingest/skeptic: record ${r.id} has an impossible incidentDate "${r.incidentDate}"`,
      );
    }
    checkable++;
    const hits: SkepticCandidate[] = [];
    for (let d = -WINDOW_DAYS; d <= WINDOW_DAYS; d++) {
      hits.push(...(byDay.get(shiftDay(r.incidentDate, d)) ?? []));
    }
    hits.sort((a, b) => a.date.localeCompare(b.date));
    if (hits.length > 0) withHits++;
    byId[r.id] = hits;
  }

  const out = {
    source: `GCAT (J. McDowell, ${GCAT_BASE}), CC BY 4.0 — orbital launch attempts within ±${WINDOW_DAYS} day`,
    byId,
  };
  const json = `${JSON.stringify(out, null, 2)}\n`;
  const changed = !existsSync(OUT_PATH) || readFileSync(OUT_PATH, "utf8") !== json;
  if (changed) writeFileSync(OUT_PATH, json, "utf8");

  console.log(
    `skeptic: ${orbital} orbital launches indexed — ${checkable} records checkable ` +
      `(day-precision dates), ${withHits} with candidates`,
  );
  console.log(changed ? `skeptic: wrote ${OUT_PATH}` : `skeptic: ${OUT_PATH} already up to date`);
}

run();
