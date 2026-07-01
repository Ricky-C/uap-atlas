# CLAUDE.md

Operating manual for Claude Code in this repo. Read this first, then the docs it points to. Keep it accurate as the project evolves — a stale CLAUDE.md is worse than none.

## What this is

`uap-atlas` turns the U.S. government's PURSUE UAP declassification releases (published at war.gov/ufo) into a clean, structured, geocoded dataset and renders it on an interactive globe. A build-time script ingests each release; a static site displays it. There is no backend, no database, and no server.

The posture is evidence-first and neutral. This is a public-records explorer, not a believer site. Summaries are factual and non-sensational. The product never claims anomalous phenomena are extraterrestrial, and it renders uncertainty honestly rather than implying precision it doesn't have.

Working repo name is `uap-atlas`. The public title is undecided — candidates: a subtle "seeing-stone" reference (palantír), or something instrument-flavored (Nightwatch, Signal). Don't hardcode a public brand name anywhere yet; use `uap-atlas` internally.

## Golden rules (non-negotiable)

1. **The schema is the contract.** `schema.ts` defines `UAPRecord` and is imported by *both* the ingest script and the app. Never let the two sides drift. Change the schema in one place; the compiler enforces the rest.
1. **No hardcoded colors, spacing, type, or motion values — ever.** Everything reads from tokens (see `DESIGN.md`). This repo is built "theme-thin" so a later Claude Design pass can restyle by filling tokens, not rewriting components. A hardcoded `#0a0e16` is a bug.
1. **Green is signal only.** The phosphor-green accent marks active/interactive/live things. Body and paragraph text is cool off-white, never green (green-on-black vibrates at text sizes). Amber is reserved for "unresolved" and redaction. See `DESIGN.md`.
1. **Ingest is idempotent and cached.** Re-running the script must never re-download or re-bill work already done. Cache enrichment by source-file hash. Committing `data/records.json` is how output ships.
1. **Never de-anonymize.** The government redacted witness identities and facility locations on purpose. Do not attempt to recover them, cross-reference them, or infer them. Do not imply government affiliation anywhere in the UI.
1. **No secrets in the repo.** `ANTHROPIC_API_KEY` lives in `.env` (gitignored). Keep `.env.example` current. Never log keys.
1. **Round every number that reaches the UI.** Float math leaks artifacts; format on display.

## Tech stack

- Language: TypeScript everywhere, `strict: true`. No `any` without a written reason.
- App: Vite + React + `react-globe.gl` (three.js under the hood). Static build, no SSR.
- Ingest: Node + TypeScript, run locally per release. Uses the Anthropic SDK for the enrichment pass (model `claude-sonnet-5`, Batch API for the offline run).
- Data: static JSON committed to git. No DB, no API server.
- Hosting: static — Cloudflare Pages / Vercel / S3+CloudFront. Any of them; the build output is just files.
- Package manager: pnpm (fall back to npm if unavailable). Node 20+.

## Repo structure

```text
uap-atlas/
├── schema.ts              # THE CONTRACT — UAPRecord, imported by both sides
├── ingest/                # build-time script (fetch → parse → enrich → geocode → emit)
│   ├── run.ts             # idempotent orchestrator
│   ├── fetch.ts           # download + unzip release bundles from war.gov
│   ├── parse.ts           # filename → partial record (agency, doc type, location, year)
│   ├── enrich.ts          # Claude pass: summary, object class, redaction estimate
│   ├── geocode.ts         # location_raw → {lat, lon, precision} via lookup table
│   └── emit.ts            # merge into records.json, report the diff
├── data/
│   ├── records.json       # canonical dataset (committed output)
│   ├── locations.json     # hand-curated geocode table (committed input)
│   └── cache/             # per-file enrichment cache (committed)
├── src/                   # Vite/React globe app
│   ├── tokens.css         # design tokens — the ONLY place raw values live
│   ├── Globe.tsx
│   ├── Drawer.tsx         # the case-file panel
│   └── Timeline.tsx
├── public/                # NASA Black Marble texture, static assets
├── ARCHITECTURE.md
├── DATA.md
├── DESIGN.md
├── PLAN.md
└── .claude/
    ├── agents/            # code-reviewer, security-reviewer, design-guardian
    └── commands/            # /new-tranche
```

## Commands

```bash
pnpm install            # install deps
pnpm dev                # run the globe app locally (Vite dev server)
pnpm build              # produce the static site
pnpm typecheck          # tsc --noEmit — must pass before any commit
pnpm lint               # eslint — must pass before any commit
pnpm ingest             # run the ingest script for the newest local release bundle
pnpm ingest:release 01  # run ingest for a specific release
```

If a command above doesn't exist yet, wire it in `package.json` as part of the phase that introduces it (see `PLAN.md`) rather than inventing an alternative.

## Code conventions

- Functional React components, hooks only. No class components.
- Ingest is small pure functions with one clear job each; side effects (network, disk) isolated in `fetch.ts`/`emit.ts`.
- Prefer explicit types over inference at module boundaries. Parse external data (zip contents, JSON) at the edge; the interior trusts `UAPRecord`.
- Errors: fail loud in ingest (a bad record should stop the run and name the file), fail soft in the app (a missing field renders a placeholder, never a crash).
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Small, reviewable commits.

## Design & data guardrails

Design details live in `DESIGN.md`; data sources, the schema, geocode precision tiers, and legal/provenance rules live in `DATA.md`. The two guardrails worth repeating because they're easy to violate: tokens-only styling (rule 2) and never-de-anonymize (rule 5).

## Working with the agents

Three project subagents live in `.claude/agents/`:

- `design-guardian` — run before finishing any UI work. Catches hardcoded values and green-as-text violations.
- `security-reviewer` — run after touching `ingest/` (zip handling, network, secrets) or dependencies.
- `code-reviewer` — run after any non-trivial change.

Invoke them explicitly when in doubt (e.g. "use the design-guardian subagent on the Drawer component").

## Definition of done (per change)

`pnpm typecheck` and `pnpm lint` pass; no hardcoded style values; schema unchanged or changed in `schema.ts` with both sides updated; no secrets or de-anonymizing logic; the relevant subagent has reviewed UI or ingest changes.
