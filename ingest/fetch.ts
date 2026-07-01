// Acquire a release's source files and the curated geocode table. Input-side disk
// IO lives here; output IO (records.json) lives in emit.ts.
//
// PURSUE ships each release as a ZIP bundle from war.gov plus a filterable index
// (Agency, Release, Incident Date, Incident Location, Type). We reproduce that
// shape locally: a release directory holds a `files/` folder and an `index.json`
// that mirrors the portal's index. Filenames alone do NOT carry incident date or
// location — those come from the index — so parse.ts reads both (see parse.ts).
//
// Source resolution, newest first:
//   releases/<id>/            real bundle the user dropped in (gitignored)
//   ingest/fixtures/release-<id>/   committed synthetic fixture
//
// When the real Release_1 arrives, extract it into releases/01/ (with the same
// files/ + index.json layout) and this same code path ingests it unchanged. The
// index is untrusted external data, so it is validated at the edge and file entries
// are constrained to bare, non-symlink regular files inside files/.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { readJson } from "./io";
import { parseLocationTable, type LocationTable } from "./geocode";

export type MediaType = "document" | "image" | "video";

export interface RawIndexEntry {
  file: string; // filename inside files/, e.g. "DOW-UAP-D001_Nimitz-Encounter-Report.pdf"
  agency?: string; // FBI | CIA | NASA | DOW ...; when omitted, derived from the filename
  mediaType: MediaType;
  docType?: string; // optional override; else derived from the filename
  docId?: string; // optional override; else derived from the filename
  incidentDate?: string | null; // raw from the portal; may be fuzzy — normalized in parse.ts
  incidentLocation: string; // free text, city through combatant-command AOR
  sourceUrl: string; // link back to the government record
}

export interface FetchedFile {
  file: string;
  relPath: string; // path from repo root, stored on the record's media field
  sha256: string; // content hash — the record id is derived from this
  raw: RawIndexEntry;
}

export interface FetchedRelease {
  releaseId: string;
  dir: string;
  fromFixture: boolean;
  files: FetchedFile[];
}

const REAL_DIR = "releases";
const FIXTURE_DIR = join("ingest", "fixtures");

function fixturePath(releaseId: string): string {
  return join(FIXTURE_DIR, `release-${releaseId}`);
}

function realPath(releaseId: string): string {
  return join(REAL_DIR, releaseId);
}

// Highest release id that has an index.json, checking real bundles then fixtures.
export function detectNewestRelease(): string {
  const ids = new Set<string>();
  for (const [base, pattern] of [
    [REAL_DIR, /^(\d{2})$/],
    [FIXTURE_DIR, /^release-(\d{2})$/],
  ] as const) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const m = pattern.exec(name);
      if (m && existsSync(join(base, m[0], "index.json"))) ids.add(m[1]);
    }
  }
  const sorted = [...ids].sort();
  const newest = sorted.at(-1);
  if (!newest) {
    throw new Error(
      `ingest/fetch: no releases found. Add a bundle under ${REAL_DIR}/<id>/ or a fixture under ${FIXTURE_DIR}/release-<id>/`,
    );
  }
  return newest;
}

function resolveDir(releaseId: string): { dir: string; fromFixture: boolean } {
  const real = realPath(releaseId);
  if (existsSync(real)) {
    // A bare .zip with no extracted files is a common half-step — fail loud with guidance.
    if (!existsSync(join(real, "index.json"))) {
      throw new Error(
        `ingest/fetch: ${real} exists but has no index.json. Extract the war.gov bundle into ${real}/ so it contains files/ and index.json.`,
      );
    }
    return { dir: real, fromFixture: false };
  }
  const fixture = fixturePath(releaseId);
  if (existsSync(join(fixture, "index.json"))) {
    return { dir: fixture, fromFixture: true };
  }
  throw new Error(
    `ingest/fetch: release ${releaseId} not found (looked in ${real}/ and ${fixture}/)`,
  );
}

const MEDIA_TYPES: readonly MediaType[] = ["document", "image", "video"];

// The index is untrusted external data; a `file` value must be a bare filename so it
// can never escape the release's files/ directory (path-traversal guard). This matters
// most for the real war.gov bundle, whose index we don't author.
function safeName(where: string, name: string): string {
  if (
    name.length === 0 ||
    name !== basename(name) ||
    name === "." ||
    name === ".." ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(`ingest/fetch: ${where}.file "${name}" must be a bare filename (no path segments)`);
  }
  return name;
}

// Trust nothing from the index file: validate at the edge, fail loud naming the offender.
function validateIndex(dir: string, value: unknown): RawIndexEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`ingest/fetch: ${join(dir, "index.json")} must be a JSON array`);
  }
  return value.map((entry, i) => {
    const where = `${join(dir, "index.json")}[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`ingest/fetch: ${where} is not an object`);
    }
    const e = entry as Record<string, unknown>;
    const str = (key: string): string => {
      const v = e[key];
      if (typeof v !== "string" || v.length === 0) {
        throw new Error(`ingest/fetch: ${where}.${key} must be a non-empty string`);
      }
      return v;
    };
    const optStr = (key: string): string | undefined => {
      const v = e[key];
      if (v === undefined) return undefined;
      if (typeof v !== "string") throw new Error(`ingest/fetch: ${where}.${key} must be a string`);
      return v;
    };
    const mediaType = str("mediaType");
    if (!MEDIA_TYPES.includes(mediaType as MediaType)) {
      throw new Error(
        `ingest/fetch: ${where}.mediaType "${mediaType}" is not one of ${MEDIA_TYPES.join(", ")}`,
      );
    }
    const incidentDate =
      e.incidentDate === undefined || e.incidentDate === null
        ? null
        : typeof e.incidentDate === "string"
          ? e.incidentDate
          : (() => {
              throw new Error(`ingest/fetch: ${where}.incidentDate must be a string or null`);
            })();
    return {
      file: safeName(where, str("file")),
      agency: optStr("agency"),
      mediaType: mediaType as MediaType,
      docType: optStr("docType"),
      docId: optStr("docId"),
      incidentDate,
      incidentLocation: str("incidentLocation"),
      sourceUrl: str("sourceUrl"),
    };
  });
}

export function fetchRelease(releaseId: string): FetchedRelease {
  const { dir, fromFixture } = resolveDir(releaseId);
  const index = validateIndex(dir, readJson(join(dir, "index.json")));

  const files = index.map((raw): FetchedFile => {
    const relPath = join(dir, "files", raw.file);
    if (!existsSync(relPath)) {
      throw new Error(`ingest/fetch: ${join(dir, "index.json")} references missing file ${relPath}`);
    }
    // lstat (not stat): a symlink resolves to isSymbolicLink, so this rejects any
    // entry that would let readFileSync follow a link out of the release directory.
    if (!lstatSync(relPath).isFile()) {
      throw new Error(
        `ingest/fetch: ${relPath} is not a regular file (symlinks and special files are rejected)`,
      );
    }
    const sha256 = createHash("sha256").update(readFileSync(relPath)).digest("hex");
    return { file: raw.file, relPath, sha256, raw };
  });

  return { releaseId, dir, fromFixture, files };
}

// The hand-curated geocode table is input, so its read lives here too (not in run.ts).
export function fetchLocationTable(path: string): LocationTable {
  if (!existsSync(path)) {
    throw new Error(`ingest/fetch: missing ${path} (the hand-curated geocode table)`);
  }
  return parseLocationTable(path, readJson(path));
}
