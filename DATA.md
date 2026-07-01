# Data

Everything about where the data comes from, its shape, how it's geocoded, and the legal/ethical rules around it.

## The schema (UAPRecord)

This is the contract (see `ARCHITECTURE.md`). It lives in `schema.ts` at the repo root and is imported by both `ingest/` and `src/`.

```ts
export type GeoPrecision = "point" | "city" | "region" | "theater" | "unknown";
export type ObjectClass =
  | "orb" | "disc" | "fireball" | "light" | "triangle" | "craft" | "other" | "unknown";
export interface UAPRecord {
  id: string;                 // stable, content-addressed (hash of source file)
  release: string;            // "01" | "02" | "03" ...
  sourceAgency: string;       // FBI | CIA | NASA | DOW | ICA ...
  docType: string;            // FD-1057 | FD-302 | rendering | video-still | study ...
  incidentDate: string | null;// ISO 8601; null when the source is fuzzy ("1949", "2022")
  locationRaw: string;        // "Colorado Springs" | "Northeastern US" | "INDOPACOM AOR"
  lat: number | null;
  lon: number | null;
  geoPrecision: GeoPrecision;
  objectClass: ObjectClass;
  resolved: boolean;          // always false for this corpus; keep the field
  redactionPct: number | null;// % of page area redacted (0–100)
  summary: string;            // neutral, LLM-generated, non-sensational
  sourceUrl: string;          // link back to the government record
  media: {
    docImage?: string;
    video?: string;
    rendering?: string;
  };
}
```

Notes:

- `id` is a hash of the source file, which is what makes ingest idempotent and enrichment cacheable.
- `incidentDate` is nullable because many source dates are a bare year or a range. Don't fabricate precision.
- `resolved` is always `false` here (PURSUE archives only unresolved cases) but the field stays so the same schema can later absorb resolved cases or other datasets.
- `summary` must be neutral. No "mysterious," no "alien," no editorializing. Describe what the document reports.

## Sources

### PURSUE / war.gov (primary)

Declassified U.S. government UAP records, published at war.gov/ufo since 8 May 2026 as rolling tranches every few weeks. Delivered as per-release ZIP bundles (documents + videos) plus a filterable index (Agency, Release, Incident Date, Incident Location, Type). Filenames encode structured metadata. Every case in the archive is **unresolved** by design; resolved cases are reported separately by statute.

Legal: works of the U.S. federal government are not subject to copyright (17 U.S.C. § 105), so these records are public domain. The Department of War explicitly welcomes private-sector analysis of the material. No terms of service restrict reuse. Edge case: a federal release occasionally contains third-party material (a civilian photo, a foreign cable) that is not itself a federal work — rare, but why we don't assert "everything here is public domain" as an absolute in user-facing copy.

### Project Blue Book (historical layer, v2+)

Declassified USAF UAP case files, 1947–1969, public domain via the National Archives (and mirrors such as The Black Vault). Used as the dense historical basemap beneath PURSUE cases. Clean provenance, no restrictions.

### NUFORC — DO NOT USE

The National UFO Reporting Center database (~100k geocoded civilian reports) is tempting for density, but NUFORC is a private organization whose terms explicitly forbid scraping and redistribution. The derived CSVs on Kaggle/GitHub were created against those terms. Raw facts (date, city, shape) aren't copyrightable under *Feist*, but the report text plausibly is, and the ToS is contract law independent of copyright. For a clean-provenance portfolio project, **skip NUFORC entirely** and use Blue Book for the historical layer. If density from NUFORC is ever genuinely needed, the only clean path is sanctioned access requested from NUFORC directly — not the mirrors.

### NASA Black Marble (globe texture)

Earth-at-night imagery for the globe surface. Public domain. Thematically apt (watching the dark side for signals) and it makes the globe look expensive for free.

## Ingesting a release (the manual drop)

war.gov 403-blocks automated clients, so **downloading a release is a manual human step** — the ingest pipeline never touches the network. `ingest/fetch.ts` reads a bundle you have already downloaded and extracted onto disk; there is no fetch-over-HTTP path, and neither the script nor Claude can pull the bundle for you.

To ingest a real release:

1. From war.gov/ufo, download the release's ZIP bundle(s) — documents and videos — yourself.
1. Extract them into `releases/<id>/` (e.g. `releases/01/`) so the directory contains a `files/` folder and an `index.json`. `releases/` is gitignored (real bundles are large binaries); the committed synthetic fixture under `ingest/fixtures/release-<id>/` is the fallback the same code path ingests unchanged.
1. Author `index.json` to mirror the portal's index columns — a JSON array whose entries are `{ file, mediaType, incidentLocation, sourceUrl, agency?, docType?, docId?, incidentDate? }`. Filenames alone don't carry incident date or location, so those come from the index.
1. Run `pnpm ingest:release <id>` (or `pnpm ingest` for the newest local release).

Source resolution is newest-first: a real bundle in `releases/<id>/` takes precedence over the fixture. `index.json` is untrusted external data — it's validated at the edge, and `file` entries are constrained to bare, non-symlink regular files inside `files/` (a path-traversal guard, since we don't author the real war.gov index). Ingest is idempotent: record ids are content-addressed (a hash of the source file), so re-running never rewrites unchanged records — and, once enrichment lands, never re-bills already-processed files.

If you drop a bare `.zip` without extracting it (a common half-step), ingest fails loud: *"`releases/01` exists but has no index.json. Extract the war.gov bundle into `releases/01/` so it contains files/ and index.json."*

Note: the Claude enrichment pass (`summary`, `objectClass`, `redactionPct`) is deferred to Phase 2 and is not wired into the ingest run yet. Phase 1 records carry empty summaries and `unknown` object classes by design.

## Geocoding

`locationRaw` ranges from a precise city to a whole combatant-command area of responsibility. We geocode into **precision tiers** and store the tier so the UI can render uncertainty honestly rather than faking pinpoints:

| **Tier** | **Meaning** | **Render** |
| --- | --- | --- |
| `point` | exact coordinates given | crisp point |
| `city` | resolved to a city/town | crisp point |
| `region` | a state or multi-state area | soft blob at centroid |
| `theater` | a military theater/AOR, ocean, etc. | low-confidence large area |
| `unknown` | not resolvable | not plotted; listed only |

Geocoding is a hand-curated `data/locations.json` lookup, not a geocoding service. The corpus has only a few dozen distinct locations, and a human-curated table is both cheaper and more accurate than an automated geocoder guessing at "Northeastern US." When ingest hits a `locationRaw` not in the table, it flags it for a human to add — it does not guess.

## Hard rules

1. **Never de-anonymize.** The government redacted witness identities and sensitive facility locations deliberately. Do not attempt to recover, infer, or cross-reference them. Preserve redactions as redactions.
1. **Never imply government affiliation.** The UI must be clearly independent.
1. **Neutral framing only.** Summaries and labels describe; they do not sensationalize or conclude.
1. **Cite the source.** Every record carries a `sourceUrl` back to the official record.
