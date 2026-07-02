# Design

The aesthetic spec. This is both the brief the v0 build codes against and the brief handed to Claude Design later for the visual pass. Nothing here is decorative for its own sake.

## Thesis

The high-quality version of "mysterious UFO / sci-fi" is not little green men, glowing saucers, or X-Files display fonts — that road ends in cheese. It's the intersection of two aesthetics that are both real and both serious:

1. **The declassified intelligence archive** — monospace, case numbers, redaction bars, status tags, document scans.
1. **The deep-space observatory instrument** — a dark void, luminous data points, thin graticules, a rim-lit earth.

Together: a dark terminal watching the night side of the planet for anomalies. It reads mysterious and expensive because it's restrained and authentic to the source, not costume. **Restraint is the quality signal. Every glow earns its place.**

## The build discipline: theme-thin + tokens

The v0 build is functional first and deliberately under-styled. Every color, spacing, radius, type, and motion value is a **token** defined once in `src/tokens.css`. Components reference tokens only — a hardcoded value anywhere is a bug (`design-guardian` enforces this). This is what lets the later Claude Design pass restyle by editing tokens and components, not by rewriting from scratch. Build structurally clean, not visually finished.

## Palette (phosphor green — chosen direction)

Near-black base, one luminous signal accent, one warm alert. Values below are the starting tokens; Claude Design may refine them, but the *roles* are fixed.

```css
:root {
  /* base — near-black indigo, not pure black (a hint of blue reads as "space") */
  --bg-void:        #070a12;   /* page background */
  --bg-surface:     #0a0e16;   /* panels, the terminal screen */
  --bg-raised:      #10151f;   /* lifted cards, drawer */
  /* hairlines — faint cool lines, instrument feel */
  --line:           rgba(130,165,205,0.14);
  --line-strong:    rgba(130,165,205,0.24);
  /* text — cool off-white, NEVER green at paragraph sizes */
  --text-primary:   #d6dde8;
  --text-secondary: #9aa6b6;
  --text-muted:     #6b7688;
  /* signal — phosphor green, SPARING. accents, active points, live cues, key data */
  --signal:         #5cf2a0;   /* bright, for active/hover/selected */
  --signal-dim:     #2f9d63;   /* lines, idle points, quiet accents */
  --signal-bg:      rgba(92,242,160,0.10); /* tint behind signal elements */
  /* alert — amber, RESERVED for unresolved status + redaction */
  --alert:          #e6b458;
  --alert-bg:       rgba(230,180,88,0.12);
  /* redaction — blacker than the surface */
  --redact:         #04060a;
  /* blue book — muted blue, RESERVED for the historical basemap layer
     (--globe-color-basemap*). Hover/selected basemap dots still switch to
     --signal: blue says "historical layer", green says "active". */
  /* moon — regolith gray (--globe-moon-color) for the symbolic lunar marker */
}
```

### The green rule (read this twice)

Green-on-black **vibrates** — it blooms and fatigues the eye at small sizes. So green is strictly a **signal** color: interactive elements, active/selected map points, the live-feed indicator, key data values, hover states. **Body text, summaries, and paragraphs are always** `--text-primary` **(cool off-white), never green.** Amber (`--alert`) is only for "unresolved" tags and redaction indicators. Hold this line and the vibe reads as high-end instrument; break it and it reads as eye strain.

## Typography

- **Data / metadata / coordinates / case IDs / agency codes → monospace.** IBM Plex Mono (consistent with the wider portfolio) or JetBrains Mono for a colder edge. This carries most of the sci-fi feel and is authentic to the archive.
- **Headings / UI chrome → a technical grotesk.** Space Grotesk (subtle character without costume) or Geist/Inter for a more austere read.
- **Body / summaries → the same grotesk at a readable size, cool off-white.**
- Body and prose stay sentence case; **mono labels render uppercase** (via `text-transform` on `.mono-label` — the strings themselves stay lowercase). Three weights (regular + medium + semibold; semibold is chrome-only: the wordmark, the active segmented chip, the mobile sheet title). No "alien" display faces, ever.
- The Orbital Glass pass (Claude Design, 2026-07) set the current token values: glass panels `--bg-panel`/`--bg-panel-raised` with blur tiers, radius tiers (`--radius-row/bar/panel/sheet`), scroll fade masks (`--fade-list/--fade-drawer`), and `--text-on-signal` — the one sanctioned dark-ink-on-green inversion, used only for the active chip of the segmented control.

## The globe

- **Texture:** NASA Black Marble night-lights (public domain) — city lights on black. Thematically perfect and expensive-looking for free.
- **Atmosphere:** a soft rim glow on the limb of the globe. This single detail separates a cheap globe from a real one. Color from `--signal-dim` at low intensity.
- **Graticule:** thin lat/long grid, `--line` opacity.
- **Points:** unresolved cases glow (`--signal`) and pulse slowly; selecting one emits a single "ping" ripple. Precision drives the shape (see below).
- **Motion:** minimal and slow. A gentle point pulse, a select ripple, an easy globe idle rotation. Nothing frantic. All motion wrapped in `prefers-reduced-motion: no-preference`.

## Precision rendering (honesty is a design feature)

The `geoPrecision` tier controls how a case is drawn, so the map never fakes certainty:

| **Tier** | **Render** |
| --- | --- |
| `point` | crisp 1–2px point, full `--signal` |
| `city` | crisp point |
| `region` | soft blob at the centroid, reduced opacity |
| `theater` | large low-confidence area, faint |
| `unknown` | not plotted on the globe; listed in a side index only |

## The case-file drawer (the mood centerpiece)

Treat each case like an opened classified file on a dark instrument screen:

- Monospace header: agency + case number, and a status pill (`unresolved`, amber).
- The document scan with its real redaction bars rendered as near-black bars (`--redact`).
- A neutral summary in cool off-white grotesk.
- A monospace metadata grid (incident date, location, geo precision, object class, redaction %, source link). The source link and the geo-precision value are `--signal`; the redaction % is `--alert`.

## For the Claude Design pass (later)

When this goes to Claude Design: the components already exist and reference tokens. The job is to (a) refine the token values above into a finished phosphor-green system, (b) push the classified-file treatment on the drawer further (the in-repo v0 keeps it restrained), and (c) tune globe parameters live. Do **not** introduce hardcoded values or move green into body text. The roles in this doc are fixed; the exact hex values are yours to refine.
