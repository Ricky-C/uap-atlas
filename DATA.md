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
1. Extract them into `data/raw/release_NN/` (e.g. `data/raw/release_01/`) as a **flat folder** — the files sit directly in the directory, exactly as the bundle ships them. `data/raw/` is gitignored (real bundles run to gigabytes); the committed synthetic fixture under `ingest/fixtures/release-NN/` (which uses a `files/` subfolder) is the fallback the same code path ingests unchanged.
1. Run `pnpm ingest:release NN` (or `pnpm ingest` for the newest local release).

That alone produces records: `mediaType` is derived from the file extension, and `sourceAgency` / `docType` from the filename convention (`DOW-UAP-D001`, `CIA-UAP-002`, `FBI-Photo-B10`, …). Files with no PURSUE code in the name — the National Archives record-group scans (`65_…`, `341_…`) and redaction-only names (`Serial-3_Redacted.pdf`) — get `sourceAgency: "unknown"`; we never guess it. Incident **date and location are not read from the filename** even when present there, because they aren't reliably encoded across every convention — they come from the index below.

### The release index (optional, authoritative for date/location/URL)

Incident date, incident location, and the source URL live in war.gov's separate filterable index, which ships separately from the file bundle. Ingest joins it from either of two sources; a hand-authored `index.json` wins when both exist:

1. **`data/csv/*.csv` — the portal's own CSV export (the normal path).** Export war.gov's filterable index as CSV and drop it in `data/csv/` (committed); one export covers every release. `ingest/portal.ts` parses it (columns used: Type, Agency, Incident Date, Incident Location, PDF | Image Link), derives the release and filename from each row's link, and joins case-insensitively to the files on disk — the export's URL casing drifts from the bundle's, so the on-disk name is canonical. Video/audio rows are skipped (excluded from the corpus by project decision); when a document row and its paired video rows share a link, the document row wins. Portal agency names map to the short codes the schema uses (`Department of War` → `DOW`, `Department of State` → `DOS`, …) via `AGENCY_CODES` in `ingest/portal.ts`; an unmapped name is logged for a curator, never guessed.
1. **`data/raw/release_NN/index.json` — hand-authored (the override path).** A JSON array keyed by `file`; its fields **override** the derived values. Only `file` is required — every other field is optional and fills a gap when present:

```jsonc
[
  {
    "file": "DOW-UAP-D001_Nimitz-Encounter-Report.pdf", // required — bare filename, must match a file on disk
    "agency": "DOW",                 // overrides the filename-derived agency
    "mediaType": "document",         // "document" | "image" | "video"; else derived from extension
    "docType": "report",             // overrides the filename-derived docType
    "docId": "DOW-UAP-D001",         // the portal's document id (not persisted yet — no schema field)
    "incidentDate": "2004-11-14",    // free text OK — normalized per "Incident dates" below
    "incidentLocation": "off San Diego, California", // free text; drives geocoding via data/locations.json
    "sourceUrl": "https://www.war.gov/..."           // link back to the official record
  }
]
```

Source resolution is newest-first and real-wins: `data/raw/release_NN/` takes precedence over `releases/NN/` (legacy) over the fixture. The index — CSV or JSON — is untrusted external data: it's validated at the edge (https-only source links, bare filenames), and both index-referenced and on-disk files are constrained to bare, non-symlink regular files inside the release directory (a path-traversal guard, since we don't author the real war.gov index). Index rows whose file isn't on disk are logged and skipped (partial download or export mismatch), not fatal. Ingest is idempotent: record ids are content-addressed (a hash of the source file), so re-running never rewrites unchanged records — and enrichment never re-bills already-processed files.

**Re-ingesting resets the enriched fields** (`summary`, `objectClass`, `redactionPct`) to their defaults in `records.json` — that's by design (incoming wins, one merge rule). Run `pnpm enrich` afterwards: it restores every already-processed document from the committed cache at zero API cost, and the ingest→enrich pair is byte-identical on a clean re-run.

### Web media assets (`pnpm media`)

The app can't serve `data/raw/` (gigabytes, gitignored), so `pnpm media` renders one preview JPEG per record — a PDF's first page via pdftoppm, or the downscaled native image — into **`public/media/<id>.jpg`** (committed, ~27 MB for the current corpus; 1200px long edge, q80). The id is the source file's content hash, so an existing asset is by definition current: re-runs skip it (`--force` re-renders after a knob change, `--limit N` for trials). `records.json` is not rewritten — its `media.*` paths remain raw-source provenance; the app finds assets by the `media/<id>.jpg` convention and falls back to a placeholder if one is missing. No API cost; a record whose source file is absent from `data/raw` fails the run loudly at the end rather than shipping a silently partial asset set.

### Incident dates (normalization policy)

The portal's Incident Date column is free text: `12/30/47`, `July, 2008`, `2022`, `June 3-7, 1965`, `1952-1953`, `1970s`, `N/A`. We normalize (in `ingest/parse.ts`) to **ISO 8601 at the precision the source actually has** — `1947-12-30`, `2008-07`, `2022` — rather than fabricating a full date or discarding a real year to null. Rules: ranges and decades collapse to their **start** (`1952-1953` → `1952`, `June 3-7, 1965` → `1965-06-03`, `1970s` → `1970`); qualifiers keep only the year (`Late 2025` → `2025`); 2-digit years pivot at 30 (`47` → 1947, `26` → 2026 — the corpus spans the 1940s to the present, so nothing predates 1930); `N/A`/unparseable → `null`. The UI consumes at year granularity, so reduced precision renders honestly.

If a release directory exists but is empty (e.g. a bare `.zip` dropped in without extracting), ingest fails loud: *"`data/raw/release_01` exists but has no ingestable files. Extract the war.gov bundle so the release directory contains the documents directly."*

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

Table conventions: keys are the portal's location strings **verbatim** (including its typos — `"Westen United States"` is a faithful alias next to the correct spelling, because `locationRaw` stays faithful to source). A key mapped to **`null`** means a curator ruled it unplottable on an Earth globe (`"Moon"`, `"Low Earth Orbit"`, `"Cislunar Space"`): the record stays honestly unresolved and side-index-only, without reappearing in the miss list every run. One curation judgment worth recording: `"Georgia"` is the country (the corpus row is a Tbilisi embassy cable) — if a future tranche means the U.S. state, that row's `locationRaw` will need a distinguishing key.

## Hard rules

1. **Never de-anonymize.** The government redacted witness identities and sensitive facility locations deliberately. Do not attempt to recover, infer, or cross-reference them. Preserve redactions as redactions.
1. **Never imply government affiliation.** The UI must be clearly independent.
1. **Neutral framing only.** Summaries and labels describe; they do not sensationalize or conclude.
1. **Cite the source.** Every record carries a `sourceUrl` back to the official record.
