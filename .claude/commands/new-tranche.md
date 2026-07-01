---
description: Ingest a new PURSUE release tranche end to end and prepare the commit
argument-hint: [release number, e.g. 04]
---

A new PURSUE release has dropped. Ingest it into the atlas. Release number: $ARGUMENTS

Do the following in order, stopping to report if any step surprises you:

1. Confirm the release bundle URLs on war.gov/ufo for release $ARGUMENTS (documents ZIP and videos ZIP). If you can't confirm them, stop and ask.
1. Run the ingest for this release (`pnpm ingest:release $ARGUMENTS`). It should:
  - download and defensively unzip the bundle (idempotent — skip anything already fetched),
  - parse filenames into partial records,
  - run the Claude enrichment pass, using the cache so nothing already processed is re-billed,
  - geocode against `data/locations.json`.
1. If ingest flags any `locationRaw` values not in `data/locations.json`, list them and propose accurate `{lat, lon, geoPrecision}` entries for a human to confirm before continuing. Do not guess coordinates silently.
1. Show the `data/records.json` diff: how many new records, from which agencies, and any changed fields on existing records (e.g. reduced redaction).
1. Spot-check 3–5 of the new summaries for neutrality and accuracy against their source documents. Flag anything sensational or wrong.
1. Stage the changes (`data/records.json`, `data/cache/`, any `data/locations.json` additions) and propose a Conventional Commit message (e.g. `feat(data): ingest PURSUE release $ARGUMENTS`). Do not commit until the human approves the message.

Guardrails: never de-anonymize redacted content; keep summaries neutral; do not modify the schema or app code as part of a tranche ingest.
