// war.gov portal CSV -> per-release index entries. Pure: no IO (fetch.ts reads the
// file and passes text in). The portal's filterable index exports as one CSV covering
// every release (Featured, Redaction, Release Date, Title, Type, ..., Agency,
// Incident Date, Incident Location, PDF | Image Link, ...). This module parses it,
// keeps the document/image rows (video/audio are excluded from the corpus by project
// decision), and joins them to on-disk filenames so their fields can override the
// filename-derived values exactly like a hand-authored index.json row would.
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

// Document/image rows carry the file we ingest; video/audio rows are excluded from
// the corpus (project decision) and only ever share a link with their paired document.
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
    const file = safeName(`ingest/portal: ${where}`, decodeURIComponent(url.split("/").at(-1) ?? ""));

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
    });
  });
  return out;
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
