// THE CONTRACT. This file defines UAPRecord and is imported by *both* the ingest
// script (ingest/) and the app (src/). Never let the two sides drift — change the
// schema here and let the compiler enforce the rest. See DATA.md.

export type GeoPrecision = "point" | "city" | "region" | "theater" | "unknown";

export type ObjectClass =
  | "orb"
  | "disc"
  | "fireball"
  | "light"
  | "triangle"
  | "craft"
  | "other"
  | "unknown";

export interface UAPRecord {
  id: string; // stable, content-addressed (hash of source file)
  release: string; // "01" | "02" | "03" ...
  sourceAgency: string; // FBI | CIA | NASA | DOW | ICA ...
  docType: string; // FD-1057 | FD-302 | rendering | video-still | study ...
  incidentDate: string | null; // ISO 8601; null when the source is fuzzy ("1949", "2022")
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
