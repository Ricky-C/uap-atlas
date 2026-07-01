// Acquire a release's source files and the curated geocode table. Input-side disk
// IO lives here; output IO (records.json) lives in emit.ts.
//
// PURSUE ships each release as a ZIP bundle from war.gov. war.gov 403-blocks
// automation, so the user downloads and extracts a bundle themselves; ingest only
// reads what is already on disk. Source directories, newest layout first:
//
//   data/raw/release_<id>/       real bundle the user extracted (gitignored, FLAT)
//   releases/<id>/               legacy real-bundle location (files/ + index.json)
//   ingest/fixtures/release-<id>/  committed synthetic fixture (files/ + index.json)
//
// The real bundles are a FLAT folder of files with NO index. war.gov's filterable
// index (Agency · Incident Date · Incident Location · Type · link) is the authoritative
// home for those fields, but it ships separately. So the index is OPTIONAL here: when a
// curator exports it into <dir>/index.json (a JSON array, keyed by `file`), its fields
// OVERRIDE the filename-derived values; without it, mediaType is derived from the file
// extension and the index-only fields (agency where absent, incidentDate, location,
// sourceUrl) stay at honest defaults until a re-run with the index fills them.
//
// The index is untrusted external data (we don't author the real one): it is validated
// at the edge, and every file — index-referenced or discovered on disk — is constrained
// to a bare, non-symlink regular file inside the release directory. Symlinked path
// components (a `files` symlink, a symlinked release dir) are refused too, and a realpath
// containment check keeps every read inside the source root (path-traversal guard).

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";

import { readJson } from "./io";
import { parseLocationTable, type LocationTable } from "./geocode";

export type MediaType = "document" | "image" | "video";

// One row of a release index. Only `file` is required; every other field, when present,
// OVERRIDES the value ingest would otherwise derive from the filename/extension.
export interface RawIndexEntry {
  file: string; // bare filename inside the release, e.g. "DOW-UAP-D001_Nimitz.pdf"
  agency?: string; // FBI | CIA | NASA | DOW ...; else derived from the filename
  mediaType?: MediaType; // else derived from the file extension
  docType?: string; // else derived from the filename
  docId?: string; // the source's document id; not persisted unless schema.ts gains a field
  incidentDate?: string | null; // raw from the portal; may be fuzzy — normalized in parse.ts
  incidentLocation?: string; // free text, city through combatant-command AOR
  sourceUrl?: string; // link back to the government record (http(s) only)
}

export interface FetchedFile {
  file: string;
  relPath: string; // path from repo root, stored on the record's media field
  sha256: string; // content hash — the record id is derived from this
  mediaType: MediaType; // resolved: index override, else extension-derived
  entry: RawIndexEntry | null; // the matching index row, if the release has an index
}

export interface FetchedRelease {
  releaseId: string;
  dir: string;
  fromFixture: boolean;
  files: FetchedFile[];
  orphanIndex: string[]; // index rows whose file isn't on disk (partial download/export)
}

// Source roots in precedence order: a real extracted bundle wins over the fixture.
const SOURCES = [
  { base: join("data", "raw"), dirFor: (id: string) => `release_${id}`, fixture: false },
  { base: "releases", dirFor: (id: string) => id, fixture: false },
  { base: join("ingest", "fixtures"), dirFor: (id: string) => `release-${id}`, fixture: true },
] as const;

const INDEX_FILENAME = "index.json";

function mediaTypeForExt(file: string): MediaType {
  switch (extname(file).toLowerCase()) {
    case ".mp4":
    case ".mov":
    case ".m4v":
      return "video";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".tif":
    case ".tiff":
      return "image";
    default:
      return "document"; // .pdf and anything else
  }
}

// Where a release's files live: a `files/` subdir (fixture / legacy layout) or, for the
// real flat bundles, the release directory itself. lstat (not stat): a symlink named
// `files` must NOT be adopted as the base — that would let a malicious bundle redirect
// every subsequent read outside the release directory.
function filesBase(dir: string): string {
  const sub = join(dir, "files");
  return existsSync(sub) && lstatSync(sub).isDirectory() ? sub : dir;
}

// Bare, non-symlink regular files only. Excludes the index and any dotfiles/subdirs so a
// flat release directory yields just its documents.
function listSourceFiles(base: string): string[] {
  return readdirSync(base)
    .filter((name) => !name.startsWith("."))
    .filter((name) => name.toLowerCase() !== INDEX_FILENAME)
    .filter((name) => lstatSync(join(base, name)).isFile())
    .sort();
}

// Does this release directory hold at least one ingestable file? lstat(dir).isDirectory()
// is false for a symlink-to-dir, so a symlinked release dir is never traversed (both
// detectNewestRelease and resolveRelease rely on this).
function hasFiles(dir: string): boolean {
  return existsSync(dir) && lstatSync(dir).isDirectory() && listSourceFiles(filesBase(dir)).length > 0;
}

// Defense in depth against symlinked path components in a malicious bundle (a `files`
// symlink or a symlinked release dir). The lstat checks above already reject a symlink as
// the FINAL path component; this rejects a symlinked ANCESTOR by requiring the fully
// resolved base to stay inside the fully resolved source root.
function assertContained(base: string, root: string): void {
  const rel = relative(realpathSync(root), realpathSync(base));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`ingest/fetch: ${base} resolves outside ${root} — refusing to read (symlink escape)`);
  }
}

// Highest release id present across all source roots, checked in precedence order.
export function detectNewestRelease(): string {
  const ids = new Set<string>();
  for (const src of SOURCES) {
    if (!existsSync(src.base)) continue;
    for (const name of readdirSync(src.base)) {
      const m = /(\d{2})$/.exec(name);
      if (m && name === src.dirFor(m[1]) && hasFiles(join(src.base, name))) ids.add(m[1]);
    }
  }
  const newest = [...ids].sort().at(-1);
  if (!newest) {
    throw new Error(
      `ingest/fetch: no releases found. Extract a bundle into data/raw/release_<id>/ ` +
        `(or add a fixture under ingest/fixtures/release-<id>/).`,
    );
  }
  return newest;
}

function resolveRelease(releaseId: string): { dir: string; root: string; fromFixture: boolean } {
  const checked: string[] = [];
  for (const src of SOURCES) {
    const dir = join(src.base, src.dirFor(releaseId));
    checked.push(dir);
    if (!existsSync(dir)) continue;
    if (!lstatSync(dir).isDirectory()) {
      throw new Error(`ingest/fetch: ${dir} is not a real directory (symlinks are refused)`);
    }
    if (!hasFiles(dir)) {
      // A bare .zip dropped in without extracting is a common half-step — name it.
      throw new Error(
        `ingest/fetch: ${dir} exists but has no ingestable files. Extract the war.gov ` +
          `bundle so the release directory contains the documents directly.`,
      );
    }
    return { dir, root: src.base, fromFixture: src.fixture };
  }
  throw new Error(`ingest/fetch: release ${releaseId} not found (looked in ${checked.join(", ")})`);
}

// A file value from the index must be a bare filename so it can never escape the release
// directory (path-traversal guard). Matters most for the real war.gov index we don't author.
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

const MEDIA_TYPES: readonly MediaType[] = ["document", "image", "video"];

// Load the optional release index into a map keyed by filename. Trust nothing: validate at
// the edge, fail loud naming the offender. Absent index -> empty map (all fields derived).
function loadIndex(dir: string): Map<string, RawIndexEntry> {
  const path = join(dir, INDEX_FILENAME);
  const map = new Map<string, RawIndexEntry>();
  if (!existsSync(path)) return map;

  const value = readJson(path);
  if (!Array.isArray(value)) {
    throw new Error(`ingest/fetch: ${path} must be a JSON array`);
  }
  value.forEach((entry, i) => {
    const where = `${path}[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`ingest/fetch: ${where} is not an object`);
    }
    const e = entry as Record<string, unknown>;
    const optStr = (key: string): string | undefined => {
      const v = e[key];
      if (v === undefined) return undefined;
      if (typeof v !== "string") throw new Error(`ingest/fetch: ${where}.${key} must be a string`);
      return v === "" ? undefined : v; // treat "" as absent so filename-derivation can fill it
    };
    const file = optStr("file");
    if (!file) throw new Error(`ingest/fetch: ${where}.file must be a non-empty string`);
    const name = safeName(where, file);
    if (map.has(name)) throw new Error(`ingest/fetch: ${where}.file "${name}" is listed twice`);

    let mediaType: MediaType | undefined;
    if (e.mediaType !== undefined) {
      if (typeof e.mediaType !== "string" || !MEDIA_TYPES.includes(e.mediaType as MediaType)) {
        throw new Error(
          `ingest/fetch: ${where}.mediaType "${String(e.mediaType)}" is not one of ${MEDIA_TYPES.join(", ")}`,
        );
      }
      mediaType = e.mediaType as MediaType;
    }
    let incidentDate: string | null | undefined;
    if (e.incidentDate === null) incidentDate = null;
    else if (e.incidentDate !== undefined) {
      if (typeof e.incidentDate !== "string") {
        throw new Error(`ingest/fetch: ${where}.incidentDate must be a string or null`);
      }
      incidentDate = e.incidentDate;
    }

    // sourceUrl is untrusted and ends up as an <a href> when the app renders records.json.
    // Allowlist http(s) at the edge so a non-http scheme (e.g. javascript:) can never ship.
    const sourceUrl = optStr("sourceUrl");
    if (sourceUrl !== undefined && !/^https?:\/\//i.test(sourceUrl)) {
      throw new Error(`ingest/fetch: ${where}.sourceUrl "${sourceUrl}" must be an http(s) URL`);
    }

    map.set(name, {
      file: name,
      agency: optStr("agency"),
      mediaType,
      docType: optStr("docType"),
      docId: optStr("docId"),
      incidentDate,
      incidentLocation: optStr("incidentLocation"),
      sourceUrl,
    });
  });
  return map;
}

export function fetchRelease(releaseId: string): FetchedRelease {
  const { dir, root, fromFixture } = resolveRelease(releaseId);
  const base = filesBase(dir);
  assertContained(base, root); // defense in depth: base must resolve inside the source root
  const index = loadIndex(dir);
  const names = listSourceFiles(base);

  const onDisk = new Set(names);
  const orphanIndex = [...index.keys()].filter((name) => !onDisk.has(name)).sort();

  const files = names.map((name): FetchedFile => {
    const relPath = join(base, name);
    // lstat (not stat): a symlink resolves to isSymbolicLink, so this rejects any entry
    // that would let readFileSync follow a link out of the release directory.
    if (!lstatSync(relPath).isFile()) {
      throw new Error(
        `ingest/fetch: ${relPath} is not a regular file (symlinks and special files are rejected)`,
      );
    }
    const entry = index.get(name) ?? null;
    const sha256 = createHash("sha256").update(readFileSync(relPath)).digest("hex");
    return { file: name, relPath, sha256, mediaType: entry?.mediaType ?? mediaTypeForExt(name), entry };
  });

  return { releaseId, dir, fromFixture, files, orphanIndex };
}

// The hand-curated geocode table is input, so its read lives here too (not in run.ts).
export function fetchLocationTable(path: string): LocationTable {
  if (!existsSync(path)) {
    throw new Error(`ingest/fetch: missing ${path} (the hand-curated geocode table)`);
  }
  return parseLocationTable(path, readJson(path));
}
