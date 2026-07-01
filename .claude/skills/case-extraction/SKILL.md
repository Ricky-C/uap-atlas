---
name: case-extraction
description: Extracts the read-the-document fields of a UAPRecord — a neutral summary, an object class, and a redaction estimate — from a PURSUE document image. Use this whenever working on the enrichment pass (ingest/enrich.ts), writing or tuning the extraction prompt, spot-checking or reviewing generated case summaries for neutrality or accuracy, deciding or disambiguating an object class, or ingesting a new PURSUE tranche. Consult it even if the task only mentions summaries, object classification, redaction estimates, or reviewing ingested records — do not skip it just because the request sounds simple.
---

# Case extraction

Turns one PURSUE document (a scanned page, photograph, rendering, or video still) into the enrichment fields of a `UAPRecord`. It covers only the fields that require *reading* the document — `summary`, `objectClass`, and `redactionPct`. The rest of a record (agency, doc type, location, date) comes from filename parsing and geocoding and is out of scope here. See `DATA.md` for the full schema.

## When this applies

- Writing or changing `ingest/enrich.ts`.
- Tuning the extraction prompt — this skill is the source of truth for it (see `references/prompt.md`).
- Spot-checking generated summaries for neutrality and accuracy (e.g. during the `/new-tranche` flow).
- Choosing or disambiguating an object class, or adding a new one.

## How enrichment runs

- Each document image goes to `claude-sonnet-5` (multimodal — the model reads the image directly, no separate OCR step) using the canonical prompt in `references/prompt.md`.
- The offline batch run uses the Batch API (50% cheaper; this is not latency-sensitive).
- Results are cached by source-file hash in `data/cache/`. A cached document is never re-sent or re-billed — this is what keeps ingest idempotent.
- `enrich.ts` uses the prompt in `references/prompt.md` as its source of truth. If the prompt needs to change, change it there first, then update the code to match. The prompt does not live in two places.

## Output contract

The model returns strict JSON, no preamble:

```json
{
  "summary": "one or two neutral sentences describing what the document reports",
  "objectClass": "orb | disc | fireball | light | triangle | craft | other | unknown",
  "redactionPct": 0,
  "reviewFlags": []
}
```

- `summary`, `objectClass`, and `redactionPct` map to the `UAPRecord` fields of the same name.
- `redactionPct` is an integer 0–100 (percent of page area obscured by redaction bars), or `null` when the media is not a page scan.
- `reviewFlags` is **not** persisted to the record — ingest surfaces it so a human can check flagged cases. Values like `"illegible"`, `"ambiguous-object"`, `"non-document-media"`, `"heavily-redacted"`.
- When a value can't be determined, use `unknown`/`null` and add a flag. Never invent one.

## Hard rules

1. **Neutral, factual summaries only.** Describe what the document reports, in your own words. No "alien," "mysterious," "otherworldly"; no conclusions about origin or threat; no dramatization. Sentence case. See the good-versus-bad contrast in `references/examples.md`.
1. **Never de-anonymize.** Do not transcribe, infer, or reconstruct anything the government redacted. A redaction bar is an area to *measure* for `redactionPct`, never text to recover. Witness names and facility locations that were withheld stay withheld.
1. **Flag, don't guess.** Illegible, ambiguous, or non-document media gets `unknown`/`null` plus a review flag — not a confident fabrication.
1. **Classify from the taxonomy.** Object class comes from `references/object-taxonomy.md`. Don't invent classes, and don't over-specify beyond what the document actually describes — reports are subjective observations, so classify what's *described*, not what it "must have been."

## Reference files

Read these as the task requires, not all upfront:

- `references/prompt.md` — the canonical extraction prompt. Source of truth; `enrich.ts` mirrors it. Read when writing or tuning enrichment.
- `references/object-taxonomy.md` — object-class definitions, government-term mappings, and disambiguation rules. Read when classifying or adding a class.
- `references/examples.md` — few-shot good/bad summaries and edge cases. Read when tuning the prompt or judging whether a summary is neutral.
