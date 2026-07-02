// Merge this release's records into data/records.json and report the diff. Output
// disk IO lives here (alongside fetch.ts for input). records.json holds every
// release. `id` is a content-addressed hash of the source file, so it is GLOBALLY
// unique per document: keying the merge by id (incoming wins) means a byte-identical
// document that recurs across tranches stays one record rather than duplicating.
// Idempotent: re-running with unchanged inputs writes nothing.

import { existsSync, renameSync, writeFileSync } from "node:fs";

import { readJson } from "./io";
import type { UAPRecord } from "../schema";

export interface EmitDiff {
  releaseId: string;
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
  total: number;
  wrote: boolean;
}

function readExisting(outPath: string): UAPRecord[] {
  if (!existsSync(outPath)) return [];
  const value = readJson(outPath);
  if (!Array.isArray(value)) {
    throw new Error(`ingest/emit: ${outPath} is not a JSON array`);
  }
  return value as UAPRecord[];
}

export function byReleaseThenId(a: UAPRecord, b: UAPRecord): number {
  return a.release === b.release ? a.id.localeCompare(b.id) : a.release.localeCompare(b.release);
}

// The one on-disk writer for records.json. Both the release merge (below) and
// the Phase-2 enrichment write-back (ingest/enrich.ts) go through here, so the
// byte layout — sort order, 2-space indent, trailing newline — is identical no
// matter which pass wrote last. A clean re-run therefore produces no spurious diff.
export function writeRecordsFile(records: UAPRecord[], outPath: string): void {
  const sorted = [...records].sort(byReleaseThenId);
  // Atomic (temp + rename): a killed process never leaves a truncated
  // records.json — same discipline as the enrichment cache writes.
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  renameSync(tmp, outPath);
}

export function emitRecords(releaseId: string, incoming: UAPRecord[], outPath: string): EmitDiff {
  const existing = readExisting(outPath);
  const existingById = new Map(existing.map((r) => [r.id, r]));
  const incomingIds = new Set(incoming.map((r) => r.id));

  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const r of incoming) {
    const prior = existingById.get(r.id);
    if (!prior) added.push(r.id);
    else if (JSON.stringify(prior) !== JSON.stringify(r)) changed.push(r.id);
    else unchanged++;
  }

  // Records currently attributed to this release that this run no longer produced
  // (source file dropped from the bundle).
  const removed = existing
    .filter((r) => r.release === releaseId && !incomingIds.has(r.id))
    .map((r) => r.id);

  // Upsert incoming into the global id-keyed set; drop what was removed. Guarantees
  // unique ids in the output (no cross-release duplicates). writeRecordsFile sorts.
  const mergedById = new Map(existing.map((r) => [r.id, r]));
  for (const id of removed) mergedById.delete(id);
  for (const r of incoming) mergedById.set(r.id, r);
  const merged = [...mergedById.values()];

  const wrote = added.length > 0 || changed.length > 0 || removed.length > 0;
  if (wrote) writeRecordsFile(merged, outPath);

  return {
    releaseId,
    added,
    changed,
    removed,
    unchanged,
    total: merged.length,
    wrote,
  };
}
