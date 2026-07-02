// THE CONTRACT. This file defines UAPRecord and is imported by *both* the ingest
// script (ingest/) and the app (src/). Never let the two sides drift — change the
// schema here and let the compiler enforce the rest. See DATA.md.

export type GeoPrecision = "point" | "city" | "region" | "theater" | "unknown";

// Runtime source of truth for the object-class enum. Both sides import this:
// ingest/enrich.ts validates the model's output against it and derives the
// structured-output JSON schema from it; the app narrows against the same list.
// Keeping it a runtime const (not a type-only union) means there is exactly one
// place to add a class. Golden rule 1: the schema is the contract.
export const OBJECT_CLASSES = [
  "orb",
  "disc",
  "fireball",
  "light",
  "triangle",
  "craft",
  "other",
  "unknown",
] as const;

export type ObjectClass = (typeof OBJECT_CLASSES)[number];

// One prosaic-context candidate from the skeptic layer (Phase 4): an orbital
// launch near a record's incident date. Produced by ingest/skeptic.ts into
// data/skeptic.json (keyed by record id); rendered neutrally in the drawer —
// context only, never asserted as an explanation.
export interface SkepticCandidate {
  date: string; // ISO day of the launch
  vehicle: string; // e.g. "Falcon 9"
  payload: string; // flight/mission name
  site: string; // launch site (human-readable where GCAT's table resolves it)
}

export interface UAPRecord {
  id: string; // stable, content-addressed (hash of source file)
  release: string; // "01" | "02" | "03" ...
  sourceAgency: string; // FBI | CIA | NASA | DOW | ICA ...
  docType: string; // FD-1057 | FD-302 | rendering | video-still | study ...
  incidentDate: string | null; // ISO 8601 at source precision: "1947-12-30", "2008-07", or "1949"; ranges/decades collapse to their start; null when unknown/unparseable
  locationRaw: string; // "Colorado Springs" | "Northeastern US" | "INDOPACOM AOR"
  lat: number | null;
  lon: number | null;
  geoPrecision: GeoPrecision;
  objectClass: ObjectClass;
  resolved: boolean; // always false for this corpus; keep the field
  redactionPct: number | null; // % of page area redacted (0-100)
  summary: string; // neutral, LLM-generated, non-sensational
  sourceUrl: string; // link back to the government record
  media: {
    docImage?: string;
    video?: string;
    rendering?: string;
  };
}
