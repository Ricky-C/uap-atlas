---
description: Ingest a new PURSUE release tranche end to end and prepare the commit
argument-hint: [release number, e.g. 04]
---

A new PURSUE release has dropped. Ingest it into the atlas. Release number: $ARGUMENTS

war.gov 403-blocks automation, so acquiring the bundle is a **manual human step** — the ingest never downloads. It reads a bundle the user has already extracted onto disk (see `ingest/fetch.ts` and DATA.md → "Ingesting a release").

Do the following in order, stopping to report if any step surprises you:

1. Confirm the bundle for release $ARGUMENTS is extracted at `data/raw/release_$ARGUMENTS/` as a flat folder of files. If that directory is missing, stop and tell the user to download and extract the war.gov bundle there — do NOT try to fetch it yourself. If the directory exists but is empty (a bare `.zip` dropped in unextracted), the ingest fails loud with guidance; relay that message. If the user has also exported war.gov's filterable index, confirm it's at `data/raw/release_$ARGUMENTS/index.json` (optional; it fills incident date, location, and source URL — see DATA.md for the shape).
1. Run the ingest for this release (`pnpm ingest:release $ARGUMENTS`). It will:
  - read the extracted flat bundle from `data/raw/release_$ARGUMENTS/` (a real bundle there takes precedence over the committed fixture; any `index.json` is untrusted and validated at the edge),
  - derive agency/docType from filenames and mediaType from extension; join the optional index (its fields override) for date/location/source URL,
  - geocode against `data/locations.json`,
  - merge into `data/records.json` (idempotent — record ids are content-addressed, so nothing already processed is rewritten).
  Note: the Claude enrichment pass (`summary`, `objectClass`, `redactionPct`) is deferred to Phase 2 and is **not** run yet — Phase 1 records carry empty summaries and `unknown` object classes by design. When enrichment lands it runs in this step, cache-backed so nothing already processed is re-billed.
1. If ingest flags any `locationRaw` values not in `data/locations.json`, list them and propose accurate `{lat, lon, geoPrecision}` entries for a human to confirm before continuing. Do not guess coordinates silently.
1. Show the `data/records.json` diff: how many new records, from which agencies, and any changed fields on existing records (e.g. reduced redaction).
1. Once Phase 2 enrichment is wired in, spot-check 3–5 of the new summaries for neutrality and accuracy against their source documents, flagging anything sensational or wrong. In Phase 1 there are no generated summaries yet — skip this step and say so.
1. Stage the changes (`data/records.json`, any `data/locations.json` additions, and `data/cache/` once enrichment exists) and propose a Conventional Commit message (e.g. `feat(data): ingest PURSUE release $ARGUMENTS`). Do not commit until the human approves the message.

Guardrails: never de-anonymize redacted content; keep summaries neutral; do not modify the schema or app code as part of a tranche ingest.
