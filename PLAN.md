# Plan

The build roadmap. Each phase is independently demoable and additive — nothing later forces a rewrite of anything earlier, because the schema is stable and styling is theme-thin from day one. Build structurally clean, defer visual polish to the Claude Design pass at the end.

Work top to bottom. Don't start a phase until the previous one's acceptance criteria pass. Read `CLAUDE.md`, `ARCHITECTURE.md`, `DATA.md`, and `DESIGN.md` before starting.

## Phase 0 — Scaffold

Goal: an empty but correct skeleton that both sides of the app can build against.

- Init repo: pnpm, TypeScript `strict: true`, ESLint, Prettier, Vite + React.
- Create `schema.ts` at the root exactly as specified in `DATA.md`. This is the contract; get it right first.
- Create `src/tokens.css` with the tokens from `DESIGN.md` (placeholder-but-real values). Wire it as the single source of style values.
- Create empty stubs for `ingest/{run,fetch,parse,enrich,geocode,emit}.ts` and `src/{Globe,Drawer,Timeline}.tsx`.
- `.gitignore` (node_modules, `.env`, build output — but NOT `data/`), `.env.example` with `ANTHROPIC_API_KEY=`.
- Wire `package.json` scripts: `dev`, `build`, `typecheck`, `lint`.

Acceptance: `pnpm typecheck` and `pnpm lint` pass on an empty project; `pnpm dev` serves a blank page.

## Phase 1 — v0: the loop, end to end (no Claude yet)

Goal: prove the entire pipeline on real data using only what's free from filenames. A working, clickable globe by the end of this phase.

**Ingest (filenames only):**

- `fetch.ts` — download and unzip one PURSUE release bundle from war.gov. Defensive extraction (path-traversal + zip-bomb guards). Idempotent: skip if already present (hash check).
- `parse.ts` — regex the filenames into partial `UAPRecord`s (agency, docType, docId, locationRaw, year → incidentDate). No document contents read yet.
- `geocode.ts` — seed `data/locations.json` by hand with the ~dozen locations in release 01; resolve `locationRaw` → `{lat, lon, geoPrecision}`. Flag misses, don't guess.
- `emit.ts` — write `data/records.json`; print the diff.
- `run.ts` — orchestrate the above idempotently. Wire `pnpm ingest`.

**App:**

- `Globe.tsx` — render `react-globe.gl` with the NASA Black Marble texture and one point per record, colored/shaped by `geoPrecision` (see `DESIGN.md`).
- `Drawer.tsx` — click a point → open the case-file panel (agency, case ID, `unresolved` tag, metadata grid, source link). No document image or summary yet (those come in v1).
- `Timeline.tsx` — a basic scrubber over `incidentDate`.

Acceptance: run `pnpm ingest` on release 01, then `pnpm dev`, and see real cases plotted on the globe; clicking one opens a populated drawer; the timeline filters by date. All styling via tokens. `design-guardian` passes.

## Phase 2 — v1: Claude enrichment

Goal: real records — summaries, object classes, redaction estimates — from the document images.

- `enrich.ts` — send each document image to Claude (`claude-sonnet-5`, multimodal) for a neutral `summary`, `objectClass`, and `redactionPct`. Prompt for neutrality explicitly (no sensationalism, no conclusions).
- Cache by source-file hash in `data/cache/`; a cached doc is never re-billed. Cache committed.
- Use the Batch API for the offline run (50% cheaper; this is not latency-sensitive).
- Extend the drawer to show the document image, the summary, and the redaction %.

Acceptance: re-running ingest doesn't re-bill cached docs; drawers show neutral summaries and object classes; a spot-check of 5 records confirms the summaries are accurate and non-sensational. Run `security-reviewer` (network + key handling) and `code-reviewer`.

Cost note: the entire corpus to date is a few hundred docs; a full enrichment run is roughly $2 (Haiku) to $5 (Sonnet), halved with Batch, and cached thereafter. Each new tranche adds cents. There is no recurring infrastructure cost — hosting is static and effectively free.

## Phase 3 — v2: historical layer + timeline polish

Goal: depth and texture.

- Ingest Project Blue Book (public domain) into the same `UAPRecord` schema as a dense historical basemap.
- Render Blue Book as a low-emphasis heat/point layer beneath the PURSUE hero cases.
- Polish the timeline: smooth animation of cases in/out across the full date range (1940s → present), clear handling of null/fuzzy dates.

Acceptance: the globe shows a century of texture with PURSUE cases standing out as the interactive hero layer; scrubbing time animates both layers cleanly.

## Phase 4 — v3: analysis features

Goal: the features that make this more than a map. Each is additive and lives in or beside the drawer.

- **Redaction analysis** — quantify and visualize redaction: % per page, which agencies redact hardest, how redaction shifts across tranches.
- **Skeptic layer** ("can we explain this?") — per case, cross-reference time/location against prosaic candidates: launch logs (SpaceX), satellite passes (N2YO), ADS-B aircraft, astronomical ephemerides. Present candidates neutrally; never assert.
- **Release diff view** — surface what each tranche added, using the git history of `records.json`.

Acceptance: at least the redaction analysis and one skeptic-layer cross-reference ship; both stay strictly neutral and cite their inputs.

## Phase 5 — the Claude Design visual pass

Goal: take the working, real-data product to Claude Design and apply the finished phosphor-green aesthetic.

- Hand Claude Design the running app plus `DESIGN.md`. The brief is "restyle these real screens in this system," not "design from scratch."
- Refine token values into a finished phosphor-green system; push the classified-file drawer treatment further; tune globe parameters (atmosphere, point size, pulse) live.
- Guardrail: no hardcoded values introduced; green never moves into body text; the roles in `DESIGN.md` stay fixed.

Acceptance: the visual pass changes tokens and component styling only — no structural rewrites — and `design-guardian` still passes.

## Ongoing operation (after v1)

When a new PURSUE tranche drops, run the `/new-tranche` command: download the new bundle, `pnpm ingest`, review the `records.json` diff, commit. That's the entire maintenance loop.

## Guardrails that apply to every phase

- Schema changes happen in `schema.ts`; both sides update together.
- Styling is tokens-only; no hardcoded values.
- Never de-anonymize; never imply government affiliation; keep framing neutral.
- `pnpm typecheck` + `pnpm lint` pass before every commit; the relevant subagent reviews UI or ingest changes.
