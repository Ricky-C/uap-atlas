// war.gov portal CSV -> per-release index entries. Pure: no IO (fetch.ts reads the
// file and passes text in). The portal's filterable index exports as one CSV covering
// every release (Featured, Redaction, Release Date, Title, Type, ..., Agency,
// Incident Date, Incident Location, PDF | Image Link, ...). This module parses the
// document/image rows and joins them to on-disk filenames so their fields can override
// the filename-derived values exactly like a hand-authored index.json row would; the
// VID rows parse separately into released-video rows (parsePortalVideos — they carry a
// DVIDS id and no file link). Audio rows stay excluded.
//
// The CSV is untrusted external data: validated at the edge, fail loud naming the row.
// Quirks handled here, all observed in the real export:
//   - URL paths use release_1 while disk uses release_01 (ids are zero-padded)
//   - URL basenames differ from disk filenames in case (~128 of 199) — matching is
//     case-insensitive and the on-disk name wins
//   - a PDF row and its paired video rows can reference the same document link —
//     document/image rows are preferred, first among equals
//   - Type values carry stray whitespace ("PDF ")
//   - Incident Date is free text ("July, 2008", "12/30/47", "1970s") — kept raw here;
//     parse.ts normalizes it into (possibly reduced-precision) ISO 8601

import type { RawIndexEntry } from "./fetch";

// A file value joined from external data must be a bare filename so it can never
// escape the release directory (path-traversal guard). Shared with fetch.ts's
// index.json loader; callers prefix `where` with their own module name.
export function safeName(where: string, name: string): string {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(`${where}: file "${name}" must be a bare filename (no path segments)`);
  }
  return name;
}

// Minimal RFC 4180 parser: quoted fields, "" escapes, embedded newlines, CRLF.
// The real export has multi-line Description Blurb fields, so line-splitting is not
// an option and the parse walks characters with a quote state.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text; // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (inQuotes) {
    throw new Error("ingest/portal: CSV ends inside a quoted field (truncated export?)");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop rows that are entirely empty (trailing blank lines).
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// Portal agency names -> the short codes the schema uses (FBI | CIA | NASA | DOW ...).
// An unmapped name is left undefined so the filename-derived agency stands — we log
// it for a curator rather than inventing a code.
const AGENCY_CODES: Record<string, string> = {
  "department of war": "DOW",
  fbi: "FBI",
  nasa: "NASA",
  cia: "CIA",
  "central intelligence agency": "CIA",
  "department of state": "DOS",
  "department of energy": "DOE",
  "intelligence community agency": "ICA",
  "office of the director of national intelligence": "ODNI",
  "u.s. government": "USG",
};

// Document/image rows carry the file we ingest; a video row only ever shares a
// link with its paired document (its own home is parsePortalVideos below).
const DOCUMENT_TYPES = new Set(["PDF", "IMG"]);

export interface PortalRow {
  file: string; // URL basename, percent-decoded (bare filename, validated)
  release: string; // zero-padded, e.g. "01"
  type: string; // PDF | IMG | VID | AUD (trimmed)
  agency?: string; // mapped code, undefined when unmapped/absent
  agencyRaw?: string; // portal name when it didn't map (for the curator log)
  incidentDate?: string; // raw portal text; normalized later in parse.ts
  incidentLocation?: string;
  sourceUrl: string; // https link to the official record
  videoPairing: string[]; // normalized case codes of paired released videos ([] when none)
}

// ── case codes ──────────────────────────────────────────────────────────────
// Pairing columns and titles name cases in drifting formats ("DoW-UAP-D010",
// "PR-019", "FBI-UAP-PR003"). Everything reduces to a canonical
// AGENCY-UAP-SERIES<n> form (uppercase, id without leading zeros) so the video
// join can never miss on cosmetics. A bare series code ("PR-019") borrows the
// agency of the row it appears on. Unrecognizable text → null, never a guess.

export function normalizeCaseCode(raw: string, contextAgency?: string): string | null {
  const s = raw.trim().toUpperCase();
  if (s === "") return null;
  let m = /^([A-Z]{2,6})-UAP-([A-Z]{0,3})-?0*(\d+)$/.exec(s);
  if (m) return `${m[1]}-UAP-${m[2]}${Number(m[3])}`;
  m = /^([A-Z]{1,3})-?0*(\d+)$/.exec(s);
  if (m && contextAgency) return `${contextAgency}-UAP-${m[1]}${Number(m[2])}`;
  return null;
}

// The code embedded at the start of an on-disk filename ("DOW-UAP-D084_USArmy-…")
// — the same convention parse.ts derives agency/docType from.
export function caseCodeFromFile(file: string): string | null {
  const m = /^([A-Za-z]{2,6})-UAP-([A-Za-z]{0,3})?0*(\d+)/.exec(file);
  return m ? `${m[1].toUpperCase()}-UAP-${(m[2] ?? "").toUpperCase()}${Number(m[3])}` : null;
}

// Find every full case code mentioned in free text (a title or blurb). Bare
// series codes are NOT matched here — without a row context they'd be guesses.
export function caseCodesInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/([A-Za-z]{2,6})-UAP-([A-Za-z]{0,3})?0*(\d+)/g)) {
    out.add(`${m[1].toUpperCase()}-UAP-${(m[2] ?? "").toUpperCase()}${Number(m[3])}`);
  }
  return [...out];
}

// A pairing cell can list several codes ("FBI-UAP-D009 | FBI-UAP-D010").
function parsePairingCell(cell: string, contextAgency?: string): string[] {
  return cell
    .split(/[|;,&]/)
    .map((c) => normalizeCaseCode(c, contextAgency))
    .filter((c): c is string => c !== null);
}

const REQUIRED_HEADERS = [
  "Type",
  "Agency",
  "Incident Date",
  "Incident Location",
  "PDF | Image Link",
] as const;

function cleanCell(v: string | undefined): string {
  const t = (v ?? "").trim();
  return t === "" || t.toUpperCase() === "N/A" ? "" : t;
}

export function parsePortalCsv(source: string, text: string): PortalRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error(`ingest/portal: ${source} is empty`);
  const header = rows[0].map((h) => h.trim());
  const col: Record<string, number> = {};
  header.forEach((h, i) => {
    if (!(h in col)) col[h] = i; // first occurrence wins (export has trailing blank columns)
  });
  for (const h of REQUIRED_HEADERS) {
    if (!(h in col)) {
      throw new Error(`ingest/portal: ${source} is missing the "${h}" column`);
    }
  }

  const out: PortalRow[] = [];
  rows.slice(1).forEach((cells, i) => {
    const where = `${source} row ${i + 2}`;
    const at = (name: string): string => cleanCell(cells[col[name]]);

    const url = at("PDF | Image Link");
    if (url === "") return; // video-only rows ship no file link — nothing to join
    if (!/^https:\/\//i.test(url)) {
      // sourceUrl ends up as an <a href> in the app — https only, fail loud.
      throw new Error(`ingest/portal: ${where} link "${url}" is not an https URL`);
    }
    // The export is a war.gov portal artifact; a link to any other host means a
    // corrupted/spoofed export, and the app labels sourceUrl "the official record".
    const host = new URL(url).hostname.toLowerCase();
    if (host !== "war.gov" && !host.endsWith(".war.gov")) {
      throw new Error(`ingest/portal: ${where} link host "${host}" is not war.gov`);
    }
    const releaseMatch = /\/release_(\d+)\//.exec(url);
    if (!releaseMatch) {
      throw new Error(`ingest/portal: ${where} link "${url}" has no /release_NN/ path segment`);
    }
    const file = safeName(
      `ingest/portal: ${where}`,
      decodeURIComponent(url.split("/").at(-1) ?? ""),
    );

    const agencyRaw = at("Agency");
    const agency = AGENCY_CODES[agencyRaw.toLowerCase()];
    out.push({
      file,
      release: releaseMatch[1].padStart(2, "0"),
      type: at("Type").toUpperCase(),
      agency,
      agencyRaw: agency === undefined && agencyRaw !== "" ? agencyRaw : undefined,
      incidentDate: at("Incident Date") || undefined,
      incidentLocation: at("Incident Location") || undefined,
      sourceUrl: url,
      videoPairing: parsePairingCell(at("Video Pairing"), agency),
    });
  });
  return out;
}

// ── released videos (VID rows) ──────────────────────────────────────────────
// VID rows ship no file link — they were excluded from the corpus until the
// video pass. Each carries a DVIDS id (DoD's public distribution service; the
// app embeds the official player from it), the usual index fields, a long
// description blurb, and sometimes an explicit pairing to document cases.
// Release attribution: VID rows have no /release_NN/ URL, but their Release
// Date matches the document rows' exactly — the date→release map is derived
// from the document rows in the same export, never hardcoded.

export interface PortalVideoRow {
  code: string | null; // normalized case code from the Title (e.g. "FBI-UAP-PR3")
  title: string;
  dvidsId: string; // numeric string, validated — page/embed URLs are built from it
  release: string; // zero-padded, via the Release-Date map
  agency?: string;
  agencyRaw?: string;
  incidentDate?: string; // raw portal text; normalized later
  incidentLocation?: string;
  blurb: string; // Description Blurb — the enrichment pass reads this
  pdfPairing: string[]; // normalized codes of paired document cases ([] when none)
}

export interface PortalVideos {
  rows: PortalVideoRow[];
  skipped: string[]; // VID rows dropped for a stated reason (curator log)
}

export function parsePortalVideos(source: string, text: string): PortalVideos {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error(`ingest/portal: ${source} is empty`);
  const header = rows[0].map((h) => h.trim());
  const col: Record<string, number> = {};
  header.forEach((h, i) => {
    if (!(h in col)) col[h] = i;
  });

  // Older exports may predate the video columns — no videos, not an error.
  if (!("DVIDS Video ID" in col) || !("Release Date" in col) || !("Title" in col)) {
    return { rows: [], skipped: [] };
  }

  // Release-Date → release map from the document rows' URLs. Ambiguous dates
  // (one date, several releases) are unusable — affected VID rows are skipped
  // loudly rather than mis-attributed.
  const dateToReleases = new Map<string, Set<string>>();
  for (const cells of rows.slice(1)) {
    const url = cleanCell(cells[col["PDF | Image Link"]]);
    const m = /\/release_(\d+)\//.exec(url);
    if (!m) continue;
    const date = cleanCell(cells[col["Release Date"]]);
    if (date === "") continue;
    const set = dateToReleases.get(date) ?? new Set<string>();
    set.add(m[1].padStart(2, "0"));
    dateToReleases.set(date, set);
  }

  const out: PortalVideoRow[] = [];
  const skipped: string[] = [];
  rows.slice(1).forEach((cells, i) => {
    const where = `${source} row ${i + 2}`;
    const at = (name: string): string => (name in col ? cleanCell(cells[col[name]]) : "");
    if (at("Type").toUpperCase() !== "VID") return;

    const title = at("Title");
    const dvidsId = at("DVIDS Video ID");
    if (!/^\d+$/.test(dvidsId)) {
      // The id becomes a dvidshub.net URL in the app — numeric only, fail soft per row.
      skipped.push(`${where} ("${title}"): DVIDS id "${dvidsId}" is not numeric`);
      return;
    }
    const releases = dateToReleases.get(at("Release Date"));
    if (releases === undefined || releases.size !== 1) {
      skipped.push(
        `${where} ("${title}"): Release Date "${at("Release Date")}" maps to ` +
          `${releases === undefined ? "no" : releases.size} release(s)`,
      );
      return;
    }

    const agencyRaw = at("Agency");
    const agency = AGENCY_CODES[agencyRaw.toLowerCase()];
    out.push({
      code: caseCodesInText(title)[0] ?? null,
      title,
      dvidsId,
      release: [...releases][0],
      agency,
      agencyRaw: agency === undefined && agencyRaw !== "" ? agencyRaw : undefined,
      incidentDate: at("Incident Date") || undefined,
      incidentLocation: at("Incident Location") || undefined,
      blurb: at("Description Blurb"),
      pdfPairing: parsePairingCell(at("PDF Pairing"), agency),
    });
  });
  return { rows: out, skipped };
}

export interface PortalJoin {
  index: Map<string, RawIndexEntry>; // keyed by the ON-DISK filename
  unmatchedDocs: string[]; // document/image rows with no file on disk
  unmappedAgencies: string[]; // portal agency names not in AGENCY_CODES
}

// Join this release's portal rows to the files actually on disk. Case-insensitive on
// filename (the export's URL casing drifts from the bundle's); the on-disk name is
// canonical. Document/image rows outrank video/audio rows pointing at the same file;
// first among equals wins (the export lists the primary row first).
export function joinPortalRows(
  rows: PortalRow[],
  releaseId: string,
  onDiskNames: string[],
): PortalJoin {
  const diskByLower = new Map(onDiskNames.map((n) => [n.toLowerCase(), n]));
  const chosen = new Map<string, PortalRow>(); // disk name -> best row
  const unmatchedDocs = new Set<string>();
  const unmappedAgencies = new Set<string>();

  for (const row of rows) {
    if (row.release !== releaseId) continue;
    // Logged whether or not the row joins to disk — the curator list must be complete.
    if (row.agencyRaw !== undefined) unmappedAgencies.add(row.agencyRaw);
    const disk = diskByLower.get(row.file.toLowerCase());
    if (!disk) {
      if (DOCUMENT_TYPES.has(row.type)) unmatchedDocs.add(row.file);
      continue;
    }
    const prior = chosen.get(disk);
    const priorIsDoc = prior !== undefined && DOCUMENT_TYPES.has(prior.type);
    const rowIsDoc = DOCUMENT_TYPES.has(row.type);
    if (prior === undefined || (rowIsDoc && !priorIsDoc)) chosen.set(disk, row);
  }

  const index = new Map<string, RawIndexEntry>();
  for (const [disk, row] of chosen) {
    index.set(disk, {
      file: disk,
      agency: row.agency,
      incidentDate: row.incidentDate,
      incidentLocation: row.incidentLocation,
      sourceUrl: row.sourceUrl,
    });
  }
  return {
    index,
    unmatchedDocs: [...unmatchedDocs].sort(),
    unmappedAgencies: [...unmappedAgencies].sort(),
  };
}
