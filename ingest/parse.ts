// Filename + index -> partial UAPRecord. Pure: no IO (fetch.ts already read disk).
//
// The recon on real war.gov data showed filenames encode agency / docType / docId
// for most files (e.g. DOW-UAP-D001, CIA-UAP-D001), while a few use bureau-style
// case numbers (e.g. 62-HQ-83894). Incident date and location are NOT in the
// filename — they live in the release index. So: derive agency/docType/docId from
// the filename where possible (index overrides win), and take date/location from
// the index. Geo coordinates and the Claude-enriched fields are filled later; here
// they stay at honest defaults (unknown / null / empty).

import type { ObjectClass, UAPRecord } from "../schema";
import type { FetchedFile, FetchedRelease } from "./fetch";

// e.g. "DOW-UAP-D001_Nimitz-Encounter-Report.pdf" -> "DOW", "DOW-UAP-D001"
const SERIES = /^([A-Z]{2,6})-UAP-([A-Z]{1,3})(\d{3,})/;

function deriveAgency(file: string): string | null {
  return SERIES.exec(file)?.[1] ?? null;
}

function deriveDocType(file: string): string {
  const kind = SERIES.exec(file)?.[2];
  switch (kind) {
    case "D":
      return "report";
    case "PR":
      return "incident-report";
    case "VS":
      return "video-still";
    case "IMG":
      return "rendering";
    default:
      return "document";
  }
}

// ISO 8601 date only. Anything fuzzier (a bare year, a range) becomes null rather
// than fabricating precision the source doesn't have. See DATA.md.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw || !ISO_DATE.test(raw)) return null;
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  // Reject impossible calendar dates that Date silently rolls over (2023-06-31 -> Jul 1):
  // if the parsed instant doesn't render back to the same YYYY-MM-DD, it wasn't a real date.
  return new Date(t).toISOString().slice(0, 10) === raw ? raw : null;
}

function mediaFor(file: FetchedFile): UAPRecord["media"] {
  switch (file.raw.mediaType) {
    case "video":
      return { video: file.relPath };
    case "image":
      return file.raw.docType === "rendering" || /IMG\d/.test(file.file)
        ? { rendering: file.relPath }
        : { docImage: file.relPath };
    case "document":
      return { docImage: file.relPath };
  }
}

function parseFile(releaseId: string, file: FetchedFile): UAPRecord {
  const { raw } = file;
  const objectClass: ObjectClass = "unknown"; // filled by the Claude pass (Phase 2)
  return {
    id: file.sha256.slice(0, 16),
    release: releaseId,
    sourceAgency: raw.agency || deriveAgency(file.file) || "unknown",
    docType: raw.docType ?? deriveDocType(file.file),
    incidentDate: normalizeDate(raw.incidentDate),
    locationRaw: raw.incidentLocation,
    lat: null, // geocode.ts
    lon: null, // geocode.ts
    geoPrecision: "unknown", // geocode.ts
    objectClass,
    resolved: false, // PURSUE archives only unresolved cases
    redactionPct: null, // Claude pass (Phase 2)
    summary: "", // Claude pass (Phase 2); Phase 1 records carry no summary yet
    sourceUrl: raw.sourceUrl,
    media: mediaFor(file),
    // Note: the source's document id (raw.docId, or the DOW-UAP-D001 token in the
    // filename) is intentionally not persisted — UAPRecord has no docId field, and
    // `id` is the content hash. Add a field to schema.ts first if that changes.
  };
}

export function parseRelease(release: FetchedRelease): UAPRecord[] {
  // Content-addressed ids must be unique; if two files hash identically, fail loud
  // rather than silently dropping one.
  const seen = new Map<string, string>();
  return release.files.map((file) => {
    const record = parseFile(release.releaseId, file);
    const prior = seen.get(record.id);
    if (prior) {
      throw new Error(
        `ingest/parse: content-hash collision on id ${record.id} between ${prior} and ${file.file}`,
      );
    }
    seen.set(record.id, file.file);
    return record;
  });
}
