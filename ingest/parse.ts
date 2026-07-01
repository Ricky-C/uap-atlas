// Filename + optional index -> UAPRecord. Pure: no IO (fetch.ts already read disk).
//
// The real war.gov filenames span several conventions (see the fixtures and DATA.md):
//   modern PURSUE   DOW-UAP-D001_...  CIA-UAP-002-...  DoW-UAP-D079_...  DOW-UAP-D3-...
//                   (agency casing varies; separator - or _; 1-3 digit id; optional
//                    series letters D/PR/VM/VS/IMG; release_03 CIA has no series letter)
//   FBI photos      FBI-Photo-A1.png   FBI-Photo-B10.pdf
//   archival        65_HS1-..._62-HQ-83894_Section_1.pdf   341_110677_...  059UAP00011.pdf
//   redaction-only  Serial-3_Redacted.pdf   USPER-Statement-Redacted.pdf
//
// We derive agency / docType from the filename where the convention allows and take
// everything else from the index when present (index wins). Archival and redaction-only
// names carry no PURSUE agency code, so their agency stays "unknown" until the index
// supplies it — we never guess. Geo and the Claude-enriched fields are filled later; here
// they stay at honest defaults (unknown / null / empty).

import type { ObjectClass, UAPRecord } from "../schema";
import type { FetchedFile, FetchedRelease } from "./fetch";

// AGENCY-UAP-<series?><id>: captures agency (2-6 letters, any case) and the optional
// series letters. Leading zeros on the id are tolerated; the id value itself is unused.
// No trailing anchor: the id separator is '-' OR '_' (and '_' is a \w char, so \b would
// fail before it), and greedy \d+ already consumes the whole id.
const SERIES = /^([A-Za-z]{2,6})-UAP-([A-Za-z]{1,3})?0*\d+/;
// FBI-Photo-A1.png / FBI-Photo-B10.pdf
const PHOTO = /^([A-Za-z]{2,6})-Photo-[A-Za-z]?\d+/;

function normalizeAgency(raw: string | undefined): string | null {
  return raw ? raw.toUpperCase() : null;
}

function deriveAgency(file: string): string | null {
  return normalizeAgency(SERIES.exec(file)?.[1] ?? PHOTO.exec(file)?.[1] ?? undefined);
}

function docTypeForSeries(series: string | undefined): string {
  switch (series?.toUpperCase()) {
    case "D":
      return "report";
    case "PR":
      return "incident-report";
    case "VS":
      return "video-still";
    case "VM":
      return "visual-media";
    case "IMG":
      return "rendering";
    default:
      return "document";
  }
}

function deriveDocType(file: string): string {
  if (/digital[-_ ]?rendering|(^|[-_])rendering([-_]|$)/i.test(file)) return "rendering";
  if (/-Photo-/i.test(file)) return "photo";
  return docTypeForSeries(SERIES.exec(file)?.[2]);
}

// ISO 8601 date only. Anything fuzzier (a bare year, a range) becomes null rather than
// fabricating precision the source doesn't have. See DATA.md.
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
  if (file.mediaType === "video") return { video: file.relPath };
  if (file.mediaType === "image") {
    // Only synthetic renderings (Digital-Rendering, the IMG series) belong in the rendering
    // slot. A video-still (VS) is a real captured frame, not a rendering, so it stays a
    // docImage — consistent with the honesty posture.
    return /rendering/i.test(file.file) || /-UAP-IMG/i.test(file.file)
      ? { rendering: file.relPath }
      : { docImage: file.relPath };
  }
  return { docImage: file.relPath }; // documents (pdf, etc.)
}

function parseFile(releaseId: string, file: FetchedFile): UAPRecord {
  const idx = file.entry;
  const objectClass: ObjectClass = "unknown"; // filled by the Claude pass (Phase 2)
  return {
    id: file.sha256.slice(0, 16),
    release: releaseId,
    sourceAgency: idx?.agency ?? deriveAgency(file.file) ?? "unknown",
    docType: idx?.docType ?? deriveDocType(file.file),
    incidentDate: normalizeDate(idx?.incidentDate),
    // Location comes from the index; without it we hold an empty string (honest "unknown"),
    // never a guess inferred from the filename. geocode.ts leaves it unresolved.
    locationRaw: idx?.incidentLocation ?? "",
    lat: null, // geocode.ts
    lon: null, // geocode.ts
    geoPrecision: "unknown", // geocode.ts
    objectClass,
    resolved: false, // PURSUE archives only unresolved cases
    redactionPct: null, // Claude pass (Phase 2)
    summary: "", // Claude pass (Phase 2); Phase 1 records carry no summary yet
    sourceUrl: idx?.sourceUrl ?? "", // from the index; empty until it's joined in
    media: mediaFor(file),
    // Note: the source's document id (idx.docId, or the DOW-UAP-D001 token in the filename)
    // is intentionally not persisted — UAPRecord has no docId field, and `id` is the content
    // hash. Add a field to schema.ts first if that changes.
  };
}

export function parseRelease(release: FetchedRelease): UAPRecord[] {
  // Content-addressed ids must be unique; if two files hash identically, fail loud rather
  // than silently dropping one.
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
