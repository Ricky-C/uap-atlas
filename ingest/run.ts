// Idempotent orchestrator: fetch -> parse -> geocode -> emit. Run via `pnpm ingest`
// (newest local release) or `pnpm ingest:release 01` (a specific one). This module
// does no disk IO of its own — reads live in fetch.ts, writes in emit.ts.
//
// The Claude enrichment pass (summary, objectClass, redactionPct) is a separate step
// (`pnpm enrich`): re-ingesting resets those fields and enrich restores them from the
// committed cache at zero cost (see DATA.md). Ingest fails loud: any bad input stops
// the run and names the file.

import { join } from "node:path";

import { detectNewestRelease, fetchLocationTable, fetchRelease } from "./fetch";
import { geocodeRecords } from "./geocode";
import { parseRelease } from "./parse";
import { emitRecords } from "./emit";

const RECORDS_PATH = join("data", "records.json");
const LOCATIONS_PATH = join("data", "locations.json");

export function run(releaseArg?: string): void {
  const releaseId = releaseArg ?? detectNewestRelease();

  const fetched = fetchRelease(releaseId);
  const source = fetched.fromFixture ? `${fetched.dir} (synthetic fixture)` : fetched.dir;
  console.log(`ingest: release ${releaseId} from ${source} — ${fetched.files.length} files`);
  console.log(
    fetched.indexSource
      ? `ingest: index joined from ${fetched.indexSource}`
      : "ingest: no index found (index.json or data/csv export) — date/location/sourceUrl stay at defaults",
  );

  if (fetched.unmappedAgencies.length > 0) {
    console.warn(
      `\n  ${fetched.unmappedAgencies.length} portal agency name(s) have no short code yet ` +
        `(add to AGENCY_CODES in ingest/portal.ts) — filename-derived agency kept:`,
    );
    for (const a of fetched.unmappedAgencies) console.warn(`    · ${a}`);
    console.warn("");
  }

  if (fetched.orphanIndex.length > 0) {
    console.warn(
      `\n  ${fetched.orphanIndex.length} index row(s) reference files not on disk ` +
        `(partial download or export mismatch) — skipped:`,
    );
    for (const f of fetched.orphanIndex) console.warn(`    · ${f}`);
    console.warn("");
  }

  const parsed = parseRelease(fetched);
  const { records, misses, redacted } = geocodeRecords(parsed, fetchLocationTable(LOCATIONS_PATH));

  if (redacted.length > 0) {
    console.log(
      `\n  ${redacted.length} location(s) withheld at source — kept unresolved, never geocoded:`,
    );
    for (const r of redacted) console.log(`    · ${r}`);
  }
  if (misses.length > 0) {
    console.warn(
      `\n  ${misses.length} location(s) not in ${LOCATIONS_PATH} — plotted as "unknown" until added:`,
    );
    for (const m of misses) console.warn(`    · ${m}`);
  }
  if (redacted.length > 0 || misses.length > 0) console.log("");

  const diff = emitRecords(releaseId, records, RECORDS_PATH);
  console.log(
    `ingest: ${diff.added.length} added, ${diff.changed.length} changed, ` +
      `${diff.removed.length} removed, ${diff.unchanged} unchanged — ${diff.total} total`,
  );
  console.log(
    diff.wrote
      ? `ingest: wrote ${RECORDS_PATH}`
      : `ingest: ${RECORDS_PATH} already up to date (no write)`,
  );
  console.log(
    "ingest: run `pnpm enrich` to restore/fill summary, object class, redaction % " +
      "(cached documents re-bill nothing)",
  );
}

// argv: [node, run.ts, <releaseId?>]. A release id is two digits, e.g. "01".
const releaseArg = process.argv[2];
if (releaseArg !== undefined && !/^\d{2}$/.test(releaseArg)) {
  throw new Error(`ingest/run: release id must be two digits (e.g. 01), got "${releaseArg}"`);
}
run(releaseArg);
