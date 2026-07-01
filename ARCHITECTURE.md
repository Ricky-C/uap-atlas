# Architecture

The whole system is three parts, and two of them barely move: a build-time ingest script, a static data artifact in the middle, and a static runtime app. Data starts at war.gov and ends in a browser with no server in between.

```text
war.gov/ufo ──▶ ingest script ──▶ records.json ──▶ globe site ──▶ visitor
  (source)      (build time,        (committed        (static,        (browser)
                 run per tranche)    to git)           react-globe.gl)
                     ▲   ▲
              Claude API  locations.json
```

## The seam: schema.ts

The only coupling between the build side and the runtime side is a single shared type. The ingest script produces `UAPRecord[]`; the app consumes `UAPRecord[]`; TypeScript enforces that they agree. This is what lets "one script + one static site" stay coherent with no glue code. When the schema changes, the compiler flags every place on both sides that needs updating.

The canonical schema lives in `schema.ts` at the repo root. It is documented in `DATA.md`. Treat it as the source of truth for the shape of everything.

## Build layer (ingest/)

A single idempotent script, run locally whenever a new PURSUE tranche drops. It walks five stages:

1. **fetch** — download the release ZIP bundle(s) from war.gov, unzip to a working dir. Skips bundles already present (checked by content hash). Untrusted external archive: extract defensively (guard against path traversal and zip bombs — see `security-reviewer`).
1. **parse** — read filenames, which already encode agency, doc type, doc ID, location, and year (e.g. `FBI-UAP-D002_FD-1057_Unresolved-UAP-Report_ColoradoSprings_2022.jpg`). A regex pass fills most of each record for free.
1. **enrich** — send each document image to Claude (`claude-sonnet-5`, multimodal, no separate OCR) for a neutral summary, object class, and redaction estimate. Cached by source-file hash in `data/cache/`; a cached doc is never re-billed. Use the Batch API for the offline run.
1. **geocode** — resolve `location_raw` against `data/locations.json`, a hand-curated table of the few dozen distinct places in the corpus. Attaches `lat`, `lon`, and a precision tier. Unknown locations are flagged, not guessed.
1. **emit** — merge results into `data/records.json` and print the diff (what's new, what changed). Commit.

No server, queue, scheduler, or database. The recurring operation is a human running `pnpm ingest` and committing. See the `/new-tranche` command.

### Why a script and not a pipeline

The corpus is a few hundred curated documents across tranches that drop every few weeks. A distributed pipeline (Step Functions, Lambda, managed OCR, a database, an API) would be over-engineering — theater around a folder. The script is the right size. If the government's promised larger backlog (tens of millions of records over years) ever materializes and lands in this stream, the stage boundaries above are clean enough to lift into a real pipeline then — but not before.

## The artifact: data/

- `records.json` — the canonical dataset and the entire product surface. It's what the globe reads and a standalone deliverable in its own right (the structured PURSUE dataset that doesn't otherwise exist). Versioned in git, so every tranche yields a reviewable diff.
- `locations.json` — the hand-maintained geocode table (input to the geocode stage).
- `cache/` — per-file enrichment results, committed so the enrichment is reproducible and never re-billed.

## Runtime layer (src/)

A static Vite/React app. It fetches `records.json` (tens of KB — loads instantly), hands it to `react-globe.gl`, and renders:

- **Point layer** — one mark per case. Precision drives the render: `city` → crisp point, `region` → soft blob, `theater` → low-confidence area. Honesty is visible, not buried.
- **Drawer** — click a case to open the declassified-file panel (document image, neutral summary, agency, redaction %, source link).
- **Timeline** — a scrubber over `incident_date` that animates cases in and out.
- **Historical basemap (v2+)** — Project Blue Book as dense texture beneath the PURSUE hero cases.

All styling reads from `src/tokens.css`. No component hardcodes a value. The globe's look (atmosphere color, point size, pulse timing) is a set of `react-globe.gl` parameters tuned live, also sourced from tokens where practical — the one place where a value legitimately lives in code (a WebGL parameter) still reads its color/size from the token layer.

## What is deliberately absent

No backend. No database. No API server. No auth. No user data. No analytics beyond what the static host provides. This absence is the design, not a gap — it's what makes the project nearly free to run (see cost notes in `PLAN.md`) and trivially hostable next to an existing portfolio.
