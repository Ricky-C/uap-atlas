// Resolve locationRaw -> { lat, lon, geoPrecision } against the hand-curated table
// in data/locations.json. Pure: the table is loaded by fetch.ts and passed in. A
// location not in the table is FLAGGED, never guessed — the record keeps lat/lon
// null and geoPrecision "unknown" so the UI can be honest about it.
//
// Deliberately-redacted locations are a separate case from an un-curated miss: the
// government withheld them on purpose. They are forced to "unknown", kept out of the
// curator's "add these" list, and never resolvable via the table — even if someone
// mistakenly adds a redaction marker to it (DATA.md hard rule 1 / never de-anonymize).

import type { GeoPrecision, UAPRecord } from "../schema";

export interface LocationEntry {
  lat: number;
  lon: number;
  geoPrecision: GeoPrecision;
}

export type LocationTable = Record<string, LocationEntry>;

export interface GeocodeResult {
  records: UAPRecord[];
  misses: string[]; // distinct locationRaw values a human should add to the table
  redacted: string[]; // distinct locationRaw values withheld at source — never resolved
}

const PRECISIONS: readonly GeoPrecision[] = ["point", "city", "region", "theater", "unknown"];

// Redaction markers: a bracketed placeholder ("[location redacted]"), the words
// redacted/withheld, or a FOIA exemption code like "(b)(1)".
const REDACTED = /(\bredact|\bwithheld\b|^\s*\[[^\]]*\]\s*$|\(b\)\(\d)/i;

export function isRedactedLocation(locationRaw: string): boolean {
  return REDACTED.test(locationRaw);
}

// Validate the curated table at the edge; a bad hand-edit should stop the run.
export function parseLocationTable(source: string, value: unknown): LocationTable {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`ingest/geocode: ${source} must be a JSON object keyed by location text`);
  }
  const table: LocationTable = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isRedactedLocation(key)) {
      throw new Error(
        `ingest/geocode: ${source}["${key}"] looks like a redaction marker — do not geocode withheld locations`,
      );
    }
    const e = raw as Record<string, unknown>;
    if (typeof e?.lat !== "number" || typeof e?.lon !== "number") {
      throw new Error(`ingest/geocode: ${source}["${key}"] needs numeric lat and lon`);
    }
    if (e.lat < -90 || e.lat > 90 || e.lon < -180 || e.lon > 180) {
      throw new Error(`ingest/geocode: ${source}["${key}"] lat/lon out of range`);
    }
    if (!PRECISIONS.includes(e.geoPrecision as GeoPrecision) || e.geoPrecision === "unknown") {
      throw new Error(
        `ingest/geocode: ${source}["${key}"].geoPrecision must be one of ${PRECISIONS.filter((p) => p !== "unknown").join(", ")}`,
      );
    }
    table[key] = { lat: e.lat, lon: e.lon, geoPrecision: e.geoPrecision as GeoPrecision };
  }
  return table;
}

export function geocodeRecords(records: UAPRecord[], table: LocationTable): GeocodeResult {
  const misses = new Set<string>();
  const redacted = new Set<string>();
  const unresolved = (record: UAPRecord): UAPRecord => ({
    ...record,
    lat: null,
    lon: null,
    geoPrecision: "unknown",
  });

  const geocoded = records.map((record): UAPRecord => {
    // No location yet (e.g. a real record awaiting the portal index): unresolved, but not a
    // curation miss — there is nothing for a human to add to the table.
    if (record.locationRaw.trim() === "") {
      return unresolved(record);
    }
    if (isRedactedLocation(record.locationRaw)) {
      redacted.add(record.locationRaw);
      return unresolved(record);
    }
    const hit = table[record.locationRaw];
    if (!hit) {
      misses.add(record.locationRaw);
      return unresolved(record);
    }
    return { ...record, lat: hit.lat, lon: hit.lon, geoPrecision: hit.geoPrecision };
  });

  return { records: geocoded, misses: [...misses], redacted: [...redacted] };
}
