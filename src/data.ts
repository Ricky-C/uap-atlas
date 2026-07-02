// Edge of the app: records.json is external data, so it is parsed and narrowed
// here. Everything past this module trusts UAPRecord (see CLAUDE.md conventions).
// Fail soft: a malformed field degrades to its honest default, never a crash.

import raw from "../data/records.json";
import rawBluebook from "../data/bluebook.json";
import rawSkeptic from "../data/skeptic.json";
import {
  OBJECT_CLASSES,
  type GeoPrecision,
  type ObjectClass,
  type SkepticCandidate,
  type UAPRecord,
} from "../schema";

const GEO_PRECISIONS: readonly GeoPrecision[] = ["point", "city", "region", "theater", "unknown"];

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNullableString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNullableNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asGeoPrecision(v: unknown): GeoPrecision {
  return GEO_PRECISIONS.includes(v as GeoPrecision) ? (v as GeoPrecision) : "unknown";
}

function asObjectClass(v: unknown): ObjectClass {
  return OBJECT_CLASSES.includes(v as ObjectClass) ? (v as ObjectClass) : "unknown";
}

function parseRecord(v: unknown): UAPRecord | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = asString(r.id);
  if (!id) return null; // a record with no id is unaddressable — drop it
  const media = (typeof r.media === "object" && r.media !== null ? r.media : {}) as Record<
    string,
    unknown
  >;
  return {
    id,
    release: asString(r.release),
    sourceAgency: asString(r.sourceAgency, "unknown"),
    docType: asString(r.docType, "unknown"),
    incidentDate: asNullableString(r.incidentDate),
    locationRaw: asString(r.locationRaw),
    lat: asNullableNumber(r.lat),
    lon: asNullableNumber(r.lon),
    geoPrecision: asGeoPrecision(r.geoPrecision),
    objectClass: asObjectClass(r.objectClass),
    resolved: r.resolved === true,
    redactionPct: asNullableNumber(r.redactionPct),
    summary: asString(r.summary),
    sourceUrl: asString(r.sourceUrl),
    media: {
      docImage: typeof media.docImage === "string" ? media.docImage : undefined,
      video: typeof media.video === "string" ? media.video : undefined,
      rendering: typeof media.rendering === "string" ? media.rendering : undefined,
    },
  };
}

export const RECORDS: UAPRecord[] = (raw as unknown[])
  .map(parseRecord)
  .filter((r): r is UAPRecord => r !== null);

// The Project Blue Book historical basemap (1947-1969 USAF "unknowns") — rendered
// as a low-emphasis layer beneath the PURSUE hero cases, never in the case index.
export const BLUEBOOK: UAPRecord[] = (rawBluebook as unknown[])
  .map(parseRecord)
  .filter((r): r is UAPRecord => r !== null);

export function isBasemap(r: UAPRecord): boolean {
  return r.release === "bluebook";
}

// Header counter: how many PURSUE releases the corpus spans (the Blue Book
// basemap is a historical layer, not a release, so it doesn't count). A record
// with a missing release field degrades to "" — filtered so it can't mint a
// phantom release in the header.
export const RELEASE_COUNT = new Set(RECORDS.map((r) => r.release).filter(Boolean)).size;

// Skeptic layer (data/skeptic.json, built by `pnpm skeptic`). Parsed at the edge
// like everything external. Three states per record, and the distinction is the
// honesty of the feature: an array (possibly empty) = cross-referenced; undefined
// = not checkable (no day-precision incident date).
function parseCandidate(v: unknown): SkepticCandidate | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  if (typeof c.date !== "string") return null;
  return {
    date: c.date,
    vehicle: asString(c.vehicle, "unknown vehicle"),
    payload: asString(c.payload, "unnamed payload"),
    site: asString(c.site),
  };
}

const skepticSource: string =
  typeof (rawSkeptic as { source?: unknown }).source === "string"
    ? (rawSkeptic as { source: string }).source
    : "";

const skepticById = new Map<string, SkepticCandidate[]>(
  Object.entries((rawSkeptic as { byId?: unknown }).byId ?? {}).map(([id, list]) => [
    id,
    (Array.isArray(list) ? list : [])
      .map(parseCandidate)
      .filter((c): c is SkepticCandidate => c !== null),
  ]),
);

export const SKEPTIC_SOURCE = skepticSource;

export function skepticCandidates(id: string): SkepticCandidate[] | undefined {
  return skepticById.get(id);
}

// A record is plottable only when it has coordinates AND an honest precision
// tier; "unknown" precision is never drawn on the globe (DESIGN.md), it lives
// in the side index instead.
export function isPlottable(r: UAPRecord): boolean {
  return r.lat !== null && r.lon !== null && r.geoPrecision !== "unknown";
}

// Lunar/cislunar cases (Apollo-era NASA records): unplottable on Earth but not
// locationless — they anchor to the symbolic moon marker instead. Low Earth
// Orbit stays unplotted; it is neither an Earth location nor a lunar one.
export function isLunar(r: UAPRecord): boolean {
  return /\b(moon|lunar|cislunar)\b/i.test(r.locationRaw);
}

// Case-index quick filters (faceted navigation): a search string plus three
// facets. Pure functions — App derives the filtered list and the facet option
// counts from the same predicate, so the two can never disagree.
export interface IndexFilters {
  query: string;
  agency: string | null;
  objectClass: string | null;
  onGlobeOnly: boolean;
}

// Shared by initial state and every "clear" — safe as a single reference
// because filters are never mutated in place, only replaced via spread.
export const EMPTY_FILTERS: IndexFilters = {
  query: "",
  agency: null,
  objectClass: null,
  onGlobeOnly: false,
};

export function filtersActive(f: IndexFilters): boolean {
  return f.query.trim() !== "" || f.agency !== null || f.objectClass !== null || f.onGlobeOnly;
}

function matchesFilters(
  r: UAPRecord,
  f: IndexFilters,
  skipFacet?: "agency" | "objectClass",
): boolean {
  if (skipFacet !== "agency" && f.agency !== null && r.sourceAgency !== f.agency) return false;
  if (skipFacet !== "objectClass" && f.objectClass !== null && r.objectClass !== f.objectClass)
    return false;
  if (f.onGlobeOnly && !isPlottable(r) && !isLunar(r)) return false;
  const q = f.query.trim().toLowerCase();
  if (q !== "") {
    const hay =
      `${r.locationRaw} ${r.sourceAgency} ${r.objectClass} ${r.docType} ${r.incidentDate ?? ""} ${r.id}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function filterForIndex(records: UAPRecord[], f: IndexFilters): UAPRecord[] {
  if (!filtersActive(f)) return records;
  return records.filter((r) => matchesFilters(r, f));
}

// Facet option counts answer "what would selecting this show?" — every OTHER
// active filter applies; the facet's own current selection does not (standard
// faceted-navigation behavior).
export function facetCounts(
  records: UAPRecord[],
  f: IndexFilters,
  facet: "agency" | "objectClass",
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (!matchesFilters(r, f, facet)) continue;
    const key = facet === "agency" ? r.sourceAgency : r.objectClass;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Case-index order (TICKETS.md T2): dated cases newest-first, undated grouped
// at the end; id breaks ties so the order is stable across renders and rebuilds.
// incidentDate carries mixed precision ("1949", "2008-07", "1947-12-30"), so a
// bare lexical compare would put "2008" before "2008-07" descending; padding
// the missing parts with a high sentinel sorts lower-precision dates at the
// newest end of the period they name.
function dateSortKey(d: string): string {
  return `${d}-99-99`.slice(0, 10);
}

export function sortForIndex(records: UAPRecord[]): UAPRecord[] {
  return [...records].sort((a, b) => {
    if (a.incidentDate !== null && b.incidentDate !== null) {
      return (
        dateSortKey(b.incidentDate).localeCompare(dateSortKey(a.incidentDate)) ||
        a.id.localeCompare(b.id)
      );
    }
    if (a.incidentDate !== null) return -1;
    if (b.incidentDate !== null) return 1;
    return a.id.localeCompare(b.id);
  });
}

export function incidentYear(r: UAPRecord): number | null {
  if (!r.incidentDate) return null;
  const year = Number(r.incidentDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}
