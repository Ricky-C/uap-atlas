// Edge of the app: records.json is external data, so it is parsed and narrowed
// here. Everything past this module trusts UAPRecord (see CLAUDE.md conventions).
// Fail soft: a malformed field degrades to its honest default, never a crash.

import raw from "../data/records.json";
import {
  OBJECT_CLASSES,
  type GeoPrecision,
  type ObjectClass,
  type UAPRecord,
} from "../schema";

const GEO_PRECISIONS: readonly GeoPrecision[] = [
  "point",
  "city",
  "region",
  "theater",
  "unknown",
];

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

// A record is plottable only when it has coordinates AND an honest precision
// tier; "unknown" precision is never drawn on the globe (DESIGN.md), it lives
// in the side index instead.
export function isPlottable(r: UAPRecord): boolean {
  return r.lat !== null && r.lon !== null && r.geoPrecision !== "unknown";
}

export function incidentYear(r: UAPRecord): number | null {
  if (!r.incidentDate) return null;
  const year = Number(r.incidentDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}
