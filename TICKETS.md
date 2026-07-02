# Tickets — information architecture & interaction pass

This is the work block that closes the gap between "renders correctly" and "reads instantly," plus two requested globe interactions. It slots **after** the current build and the CSV geocoding step, and **before** the Claude Design visual pass (PLAN.md Phase 5). Do this in code first — these are information-architecture and interaction decisions (what to show, what links to what, how the globe behaves), and Claude Design polishes what exists rather than inventing structure.

## Guardrails (apply to every ticket)

- **Tokens only.** No hardcoded colors, spacing, type, or motion values — everything from `src/tokens.css` (see DESIGN.md). `design-guardian` must pass.
- **Honesty rendering.** Respect the `geoPrecision` tiers; never render a low-precision case as a crisp pinpoint. Keep the existing "N unplotted," "N undated always shown," "N excluded" cues — they're a strength, don't lose them.
- **Reduced motion.** Every new animation (rotation, camera transitions, ping) is wrapped in `prefers-reduced-motion: no-preference` with a sensible reduced fallback.
- **Neutral & independent.** No implication of government affiliation anywhere in new copy.
- **react-globe.gl API note.** Method names below (`pointOfView`, `controls().autoRotate`, `onPointClick`, `onPointHover`, `ringsData`) are the stable surface, but confirm signatures against your installed version and capture the confirmed-working patterns into the `globe-rendering` skill as you go.

## Data-vs-design split

Some of these are fully buildable now; some populate as geocoding lands. Each ticket tags which. The empty-looking globe is a data gap, not a reason to change layout — build the structure now and it fills in.

---

## T1 — Encoding legend (priority: high, buildable now)

**Goal.** A first-time viewer can decode the marks in five seconds. This is the single biggest missing piece and it's table-stakes for the genre.

**Build.** A legend explaining every mark on the globe:
- Precision tiers with swatches that match the real marks: crisp dot (`point`/`city`), soft blob (`region`), large faint area (`theater`), and a note that `unknown` cases aren't plotted and live in the index only.
- Color meaning: green = a case / active signal; amber = redaction and the `unresolved` status.
- Place it in the right-hand column so it fills the dead space when no case is selected; collapse it to a small toggle when the drawer opens (drawer and legend share that column). On mobile, a collapsible sheet.

**Wiring.** Static content driven by the `GeoPrecision` enum and tokens. Critically, pull the swatch styles from the *same* precision→style map the globe uses to draw points — don't duplicate the values, or the legend will drift from reality.

**Acceptance.** Every mark type on the globe is explained; swatches visually match the actual globe marks because they share the style map; legend occupies the empty right side when nothing is selected and yields to the drawer when a case is open; tokens only.

---

## T2 — Distinguishable case-index rows (priority: medium; structure now, content with geocoding)

**Goal.** Rows are scannable and tell cases apart. Today every row reads "FBI · document / disc / rel 01" — the least distinguishing fields.

**Build.** Promote identifying info: primary line = **location + incident date**; secondary, de-emphasized line = agency · object class. Drop doc-type and release to tertiary. Graceful fallbacks: "location unknown," "undated." Default sort by incident date (newest first) with undated grouped at the end. Rows get hover and selected states (see T4).

**Wiring.** Reads `locationRaw` (or a cleaned display location once geocoding provides it), `incidentDate`, `sourceAgency`, `objectClass` from `UAPRecord`.

**Depends on.** Row structure is buildable now; the location/date values become meaningful once the geocoding step populates them.

**Acceptance.** Two otherwise-similar cases are distinguishable at a glance; undated/unlocated rows render cleanly with no empty gaps; default sort is sensible; tokens only.

---

## T3 — First-load orientation & about/source (priority: high, buildable now)

**Goal.** A cold visitor — and a recruiter opening the link — understands what this is immediately, and can see where the data comes from. This is the credibility layer the whole project rests on.

**Build.**
1. A persistent header: project title + a one-line "what this is."
2. A dismissible first-load onboarding card: what the globe shows, the encoding (or "see legend"), the data source, and the neutrality stance. Persist dismissal in `localStorage` (fine in the real app — that restriction only applies to sandboxed artifacts).
3. An about / methodology panel or route covering: data from the war.gov PURSUE releases (public domain; the government invites private analysis), what "unresolved" means, an independence disclaimer (not affiliated with any government agency), the neutral-framing stance, and a high-level note on how enrichment and geocoding work. Include source links.

**Wiring.** Mostly static; pull live counts from the dataset for a "N cases across M releases" line so it stays current as tranches land.

**Acceptance.** A first-time visitor grasps what they're looking at within seconds without clicking; the about panel covers source, "unresolved," independence, and neutrality; onboarding is dismissible and stays dismissed; nothing implies government affiliation.

---

## T4 — Link the list and the globe (priority: high, buildable now)

**Goal.** One coherent instrument instead of three separate panels (brushing-and-linking).

**Build.** Shared selection/hover state keyed by `UAPRecord.id`:
- Hover a list row → its globe point is emphasized (enlarge / ring / brighten).
- Hover a globe point → its row highlights and scrolls into view.
- Click either → select the case: open the drawer **and** center the globe (T7).
- Distinct selected state in both list and globe.
- Unplotted cases (no coordinates): the row shows but indicates "not on globe," and its center action is disabled.

**Wiring.** Lift selection/hover state (a small store or context) keyed by id. Globe uses `onPointHover`/`onPointClick`; the list keys off the same id; globe emphasis via `pointColor`/`pointRadius` or a ring matched by id.

**Depends on.** Works now for the plotted cases and scales automatically as more plot.

**Acceptance.** Hovering a plotted row visibly emphasizes its point and vice versa; selection stays in sync across list, globe, and drawer; unplotted rows clearly can't center; no flicker or desync.

---

## T5 — Timeline density histogram (priority: medium; structure now, meaning with geocoding)

**Goal.** Show the temporal shape of the data at a glance instead of a bare slider.

**Build.** Replace the flat track with a per-year (or bucketed) histogram of dated case counts, with the scrubber riding on top. Empty years render as gaps so clustering is obvious. Keep the existing "N undated always shown" note separate. Dragging the scrubber filters both globe and list; the active range renders brighter.

**Wiring.** Aggregate dated records by year from `incidentDate`; bars in `--signal-dim`, active range brighter.

**Depends on.** Component is buildable now; becomes informative once dates land.

**Acceptance.** Density is visible at a glance; scrubbing filters globe and list together; undated handling unchanged; tokens only.

---

## T6 — Clean globe-rotation control (priority: high, buildable now) — requested

**Goal.** A sensible way to pause and resume the slow auto-rotation. The important subtlety: you already have a **"play" button on the timeline** for temporal playback. A second "play" for globe spin would be confusing — these control different things and must look and read differently.

**Build.**
- Rotation on by default at a slow speed (`controls().autoRotate = true`, low `autoRotateSpeed` — tune to taste, ~0.3–0.5).
- **Auto-pause on engagement:** rotation pauses while the user drags the globe, while a case is selected (drawer open — you don't want the globe drifting off the case being read), and on pointer interaction with the globe. It auto-resumes after a few seconds of inactivity, and only when nothing is selected.
- **Explicit control:** a small, clearly labeled rotation toggle placed near the globe — **not** in the timeline bar, and not styled like the timeline's "play." Use a rotation-specific affordance (a ↻/⏸ icon and/or a "rotation" label) so it's unmistakably about spin, not time.
- Reduced motion: rotation off by default when `prefers-reduced-motion` is set.

**Wiring.** `globe.controls().autoRotate` and `autoRotateSpeed` (three.js OrbitControls under react-globe.gl). Auto-pause hooks into the same selection state as T4 (selected → paused). Verify against your installed version.

**Acceptance.** Rotation pauses when a case is open and while interacting, and resumes sensibly only when idle and nothing is selected; the explicit toggle works and cannot be confused with the timeline's play control; reduced-motion respected; any control styling uses tokens.

---

## T7 — Click a node to center the globe on it (priority: high, buildable now) — requested

**Goal.** Selecting a case smoothly rotates the globe to center it.

**Build.**
- On select (from a globe click *or* a list-row click — they share selection state from T4), animate the camera to center the case's coordinates: `globe.pointOfView({ lat, lng, altitude }, transitionMs)`. Keep `altitude` moderate (frame the point, don't zoom to the surface); transition ~800–1200ms, eased.
- For `region`/`theater` precision, center on the stored centroid (`lat`/`lon`). For `unknown`/unplotted, no centering (disabled per T4).
- Pairs with T6: while centering and while a case is selected, rotation stays paused; on deselect it may resume.
- Optional nicety that's already in DESIGN.md: a subtle ping/ring at the centered point on arrival (`ringsData`) — reuse the existing select ripple if present.
- Reduced motion: skip the animated fly-to (jump or use a very short transition) when `prefers-reduced-motion` is set.

**Wiring.** `pointOfView` on select; centroid straight from `lat`/`lon`; driven by the shared selection state so list-click and globe-click behave identically. Verify the `pointOfView` signature against your installed version.

**Acceptance.** Clicking a plotted point or its row smoothly re-centers the globe on it; low-precision cases center on their centroid; unplotted cases never attempt centering; the motion is eased and not jarring; reduced-motion path works.

---

## Suggested sequencing

1. **T1 + T3** first — highest legibility payoff, they fill the empty right-side void, and both are fully buildable now.
2. **T4 + T7 + T6** as one interaction pass — they share selection state and the globe interaction layer, so build them together.
3. **T2 + T5** — build the structure now; they become informative as the geocoding data populates.
4. Then hand the structurally-complete app to **Claude Design** for the visual pass: drawer mood, mark styling, metadata hierarchy, overall composition, and the minor drawer polish (click-to-enlarge the document scan, weighting location/date over administrative fields). Those are deliberately left for Design — don't spend code time hand-styling them now.

## Definition of done for this block

All seven tickets meet their acceptance criteria; `pnpm typecheck` and `pnpm lint` pass; `design-guardian` and `code-reviewer` pass on the changes; no hardcoded values; all new motion respects reduced-motion; the rotation control is unmistakably distinct from the timeline play.
