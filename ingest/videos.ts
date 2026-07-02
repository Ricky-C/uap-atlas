// Released videos join the corpus (reversing the early videos-excluded decision).
// Pure: no IO. Two jobs, both within one release:
//
//   1. PAIRING — a VID row that names document cases (its "PDF Pairing" column,
//      a document row's "Video Pairing" column, or a full case code mentioned in
//      the VID blurb) attaches its DVIDS id to those documents' media.videos.
//      Codes are matched in normalized form (portal.normalizeCaseCode) so the
//      export's cosmetic drift ("PR-019" vs "DOW-UAP-PR019") can't miss.
//      Blurb ranges ("D004 through D008") attach only their named endpoints —
//      a partial pairing beats a guessed one.
//
//   2. STANDALONE — a VID row paired to nothing becomes a first-class record of
//      its own: same unresolved posture, dated/located from the CSV columns,
//      summary/objectClass left for the text-mode enrichment pass. Its id is
//      `dvids-<id>` (stable across re-runs; the DVIDS id is the content address
//      the way a file hash is for documents), and its sourceUrl is the DVIDS
//      page — DoD's own distribution service is the official home of the video.
//
// The app never hosts video bytes; it embeds the official DVIDS player.

import type { UAPRecord } from "../schema";
import type { FetchedFile } from "./fetch";
import { normalizeDate } from "./parse";
import { caseCodeFromFile, caseCodesInText, type PortalRow, type PortalVideoRow } from "./portal";

export function dvidsPageUrl(dvidsId: string): string {
  return `https://www.dvidshub.net/video/${dvidsId}`;
}

export interface VideoJoin {
  records: UAPRecord[]; // documents (videos attached where paired) + standalone video records
  pairedVideos: number; // VID rows attached to at least one document
  standaloneCount: number;
  unmatchedPairings: string[]; // pairing codes that resolved to nothing (curator log)
  rangeNotes: string[]; // blurb ranges ("D004 through D008") — interiors need a human
}

// A blurb range names only its endpoints in machine-readable form; the codes
// between them never auto-attach (endpoints only, never a guess). Surfaced so
// a curator can attach the interiors by hand instead of the gap shipping
// silently release after release.
const RANGE_MENTION =
  /([A-Za-z]{2,6}-UAP-[A-Za-z]{0,3}\d+)\s+through\s+((?:[A-Za-z]{2,6}-UAP-)?[A-Za-z]{0,3}\d+)/gi;

function videoRecord(row: PortalVideoRow): UAPRecord {
  return {
    id: `dvids-${row.dvidsId}`,
    release: row.release,
    sourceAgency: row.agency ?? "unknown",
    docType: "released video",
    incidentDate: normalizeDate(row.incidentDate),
    locationRaw: row.incidentLocation ?? "",
    lat: null, // geocode.ts (run.ts geocodes documents and videos together)
    lon: null,
    geoPrecision: "unknown",
    objectClass: "unknown", // text-mode Claude pass (pnpm enrich)
    resolved: false, // PURSUE archives only unresolved cases
    redactionPct: null, // a video has no page area to redact
    summary: "", // text-mode Claude pass
    sourceUrl: dvidsPageUrl(row.dvidsId),
    media: { videos: [row.dvidsId] },
  };
}

export function applyVideos(
  docRecords: UAPRecord[],
  files: FetchedFile[], // same order as docRecords (parseRelease maps 1:1)
  videoRows: PortalVideoRow[],
  docRows: PortalRow[],
): VideoJoin {
  if (docRecords.length !== files.length) {
    throw new Error(
      `ingest/videos: ${docRecords.length} records vs ${files.length} files — the 1:1 pairing broke`,
    );
  }

  // Case code → document record id(s). Distinct files can share a code prefix
  // (multi-part documents), so a code may fan out to several records.
  const docIdsByCode = new Map<string, string[]>();
  files.forEach((f, i) => {
    const code = caseCodeFromFile(f.file);
    if (code === null) return;
    const ids = docIdsByCode.get(code) ?? [];
    ids.push(docRecords[i].id);
    docIdsByCode.set(code, ids);
  });

  const videoByCode = new Map<string, PortalVideoRow>();
  for (const row of videoRows) {
    if (row.code !== null) videoByCode.set(row.code, row);
  }

  // Collect pairing edges: document record id → DVIDS ids.
  const videosByDocId = new Map<string, Set<string>>();
  const pairedDvids = new Set<string>();
  const unmatched = new Set<string>();
  const attach = (docCode: string, row: PortalVideoRow): void => {
    const ids = docIdsByCode.get(docCode);
    if (ids === undefined) {
      unmatched.add(`${docCode} (named by video "${row.title}")`);
      return;
    }
    for (const id of ids) {
      const set = videosByDocId.get(id) ?? new Set<string>();
      set.add(row.dvidsId);
      videosByDocId.set(id, set);
    }
    pairedDvids.add(row.dvidsId);
  };

  const rangeNotes: string[] = [];
  for (const row of videoRows) {
    for (const code of row.pdfPairing) attach(code, row);
    // Full case codes mentioned in the blurb; only codes that resolve to a
    // document in this release count (mentions of other videos fall through).
    for (const code of caseCodesInText(row.blurb)) {
      if (code !== row.code && docIdsByCode.has(code)) attach(code, row);
    }
    for (const m of row.blurb.matchAll(RANGE_MENTION)) {
      rangeNotes.push(
        `"${row.title}" blurb names ${m[1]} through ${m[2]} — endpoints auto-attach; verify the interiors`,
      );
    }
  }
  for (const docRow of docRows) {
    if (docRow.videoPairing.length === 0) continue;
    const docCode = caseCodeFromFile(docRow.file);
    if (docCode === null) continue;
    for (const code of docRow.videoPairing) {
      const row = videoByCode.get(code);
      if (row === undefined) {
        unmatched.add(`${code} (named by document ${docRow.file})`);
        continue;
      }
      attach(docCode, row);
    }
  }

  // Attach — numeric sort keeps media.videos deterministic across runs.
  const byNumber = (a: string, b: string): number => Number(a) - Number(b);
  const records = docRecords.map((r) => {
    const set = videosByDocId.get(r.id);
    if (set === undefined) return r;
    return { ...r, media: { ...r.media, videos: [...set].sort(byNumber) } };
  });

  // Two clip rows can share one DVIDS entry (e.g. PR057a/PR057b) — one video,
  // one record. First row wins, deterministically (CSV order is stable).
  const standalone: UAPRecord[] = [];
  const seenDvids = new Set<string>();
  for (const row of videoRows) {
    if (pairedDvids.has(row.dvidsId) || seenDvids.has(row.dvidsId)) continue;
    seenDvids.add(row.dvidsId);
    standalone.push(videoRecord(row));
  }

  return {
    records: [...records, ...standalone],
    pairedVideos: pairedDvids.size,
    standaloneCount: standalone.length,
    unmatchedPairings: [...unmatched].sort(),
    rangeNotes,
  };
}
