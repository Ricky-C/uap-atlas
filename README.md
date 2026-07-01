# uap-atlas

An interactive globe and structured dataset built from the U.S. government's public UAP declassification releases (the PURSUE program, published at war.gov/ufo since May 2026).

The government released the files as a rolling stream of scanned documents, images, and videos with unstructured location descriptions. This project turns that into a clean, geocoded, machine-readable dataset — and renders it as a dark, instrument-style globe where you can scrub through time, see where each unresolved case occurred, and open the underlying declassified document.

It is an evidence-first public-records explorer. It makes no claims about extraterrestrial life, renders geographic uncertainty honestly, and links every case back to its official source.

## How it works

A build-time script ingests each release bundle, extracts and enriches each case into a shared `UAPRecord` schema, geocodes the location, and emits a static `records.json`. A static Vite/React app reads that file and renders the globe. There is no backend, database, or server — the "backend" is a script plus a git commit.

See `ARCHITECTURE.md` for the full design, `DATA.md` for the data sources and schema, and `DESIGN.md` for the visual system.

## Data sources

- **PURSUE / war.gov (primary)** — declassified U.S. government UAP records. Public domain (17 U.S.C. § 105); the Department of War explicitly invites private-sector analysis.
- **Project Blue Book (historical layer)** — declassified USAF case files, 1947–1969. Public domain via the National Archives.
- **NASA Black Marble** — night-lights globe texture. Public domain.

## Status

Early development. See `PLAN.md` for the phased roadmap (v0 functional loop → enrichment → historical layer → analysis features → visual design pass).

## Stack

TypeScript · Vite · React · react-globe.gl (three.js) · Anthropic API (offline enrichment) · static hosting.

## License / attribution

Government source records are public domain. This project is not affiliated with or endorsed by any U.S. government agency. Redacted information in the source records is preserved as redacted; no attempt is made to recover it.
