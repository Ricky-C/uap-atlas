// Web media asset pass: one preview image per record, rendered from the raw source
// in data/raw/ into public/media/<id>.jpg so the app can actually show document
// scans and renderings (data/raw is 2+ GB and gitignored; public/media ships).
//
// Run via `pnpm media` after ingest. Zero API cost — pdftoppm/magick only (reuses
// ingest/render.ts, including its content-sniffing hardening). Idempotent by
// construction: a record's id IS the content hash of its source file, so an existing
// public/media/<id>.jpg is already the right render — skip it. `--force` re-renders
// (e.g. after changing MEDIA_PX/MEDIA_QUALITY below), `--limit N` for a trial run.
//
// The app locates assets by convention (media/<id>.jpg) and falls back to a
// placeholder when one is missing — records.json is NOT rewritten here; its media
// paths stay pointing at the raw source files as provenance.
//
// Videos are excluded from the corpus (project decision); a record whose only media
// is video is skipped and counted, not an error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { UAPRecord } from "../schema";
import { renderDocToImages } from "./render";

const RECORDS_PATH = join("data", "records.json");
const OUT_DIR = join("public", "media");

// Web preview knobs: long edge 1200px reads comfortably in the drawer at 2x DPR;
// q80 keeps the committed corpus in the tens of MB, not hundreds.
const MEDIA_PX = 1200;
const MEDIA_QUALITY = 80;

function loadRecords(): UAPRecord[] {
  if (!existsSync(RECORDS_PATH)) {
    throw new Error(`ingest/media: missing ${RECORDS_PATH} — run \`pnpm ingest\` first`);
  }
  const value = JSON.parse(readFileSync(RECORDS_PATH, "utf8")) as unknown;
  if (!Array.isArray(value)) {
    throw new Error(`ingest/media: ${RECORDS_PATH} is not a JSON array`);
  }
  return value as UAPRecord[];
}

export function run(args: string[]): void {
  const force = args.includes("--force");
  const limitArg = args.indexOf("--limit");
  // --limit bounds only the RENDER count (skips are free); the missing-source
  // fail-loud check at the end still covers every record visited, so a limited
  // trial is not a scoped dry run on a machine without data/raw.
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  if (limitArg >= 0 && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("ingest/media: --limit needs a positive integer");
  }
  const known = new Set(["--force", "--limit", ...(limitArg >= 0 ? [args[limitArg + 1]] : [])]);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    throw new Error(`ingest/media: unknown flag(s): ${unknown.join(", ")}`);
  }

  const records = loadRecords();
  mkdirSync(OUT_DIR, { recursive: true });

  let rendered = 0;
  let skipped = 0;
  let noStillMedia = 0; // video-only records, or (future) records with no media at all
  const missingSources: string[] = [];

  for (const r of records) {
    if (rendered >= limit) break;
    const source = r.media.docImage ?? r.media.rendering;
    if (source === undefined) {
      noStillMedia++;
      continue;
    }
    const outPath = join(OUT_DIR, `${r.id}.jpg`);
    if (!force && existsSync(outPath)) {
      skipped++;
      continue;
    }
    if (!existsSync(source)) {
      // The raw bundle lives outside git; on a machine without it there is nothing
      // to render. Collect and report rather than dying on the first record, then
      // fail loud at the end — a partial asset set must not look like success.
      missingSources.push(`${r.id} <- ${source}`);
      continue;
    }
    const { images } = renderDocToImages(source, {
      renderPx: MEDIA_PX,
      maxPages: 1,
      jpegQuality: MEDIA_QUALITY,
    });
    writeFileSync(outPath, Buffer.from(images[0].data, "base64"));
    rendered++;
    if (rendered % 25 === 0) console.log(`media: ${rendered} rendered...`);
  }

  console.log(
    `media: ${rendered} rendered, ${skipped} already present, ${noStillMedia} without still media ` +
      `— assets in ${OUT_DIR}/`,
  );
  if (missingSources.length > 0) {
    console.error(`\n  ${missingSources.length} source file(s) missing from data/raw:`);
    for (const m of missingSources) console.error(`    · ${m}`);
    throw new Error(
      `ingest/media: ${missingSources.length} record(s) have no source on disk — ` +
        `re-download the release bundle(s) into data/raw/ and re-run`,
    );
  }
}

run(process.argv.slice(2));
