---
name: globe-rendering
description: Confirmed-working react-globe.gl patterns for this repo (v2.38.0) — point styling via the shared precision map, camera fly-to, auto-rotation control, hover/click wiring, rings, and the reduced-motion rules. Consult before touching src/Globe.tsx or any globe interaction (rotation, pointOfView, hover, rings, point accessors).
---

# Globe rendering (react-globe.gl 2.38.0)

Patterns below are confirmed against the installed version (`react-globe.gl@2.38.0`,
`globe.gl@2.46.1`, three 0.185). Re-verify signatures in
`node_modules/react-globe.gl/dist/react-globe.gl.d.ts` after any upgrade.

## The two golden rules of this component

1. **Point accessors stay unmemoized.** react-globe.gl only re-evaluates
   `pointColor`/`pointRadius` (and tweens the change) when the accessor prop's
   *identity* changes. A `useCallback` freezes the timeline scrub and the
   hover/selection emphasis. The fresh-closure-per-render pattern in
   `src/Globe.tsx` is intentional — there is a comment on it; keep both.
2. **Styling comes from the shared precision map.** `src/precision.ts` holds
   `pointColorFor` / `pointRadiusFor` / `legendTiers`, consumed by both the
   globe accessors and the Legend swatches. Never inline precision styling in
   Globe.tsx again — the legend would silently drift from the marks.

## Imperative surface (via `ref: GlobeMethods`)

```ts
const globeRef = useRef<GlobeMethods | undefined>(undefined);
<GlobeGL ref={globeRef} ... />
```

- `globeRef.current` is `undefined` on the first render — guard every use.
- **Fly-to:** `globe.pointOfView({ lat, lng, altitude }, transitionMs)`.
  Partial POV objects are fine (only the given axes move). `transitionMs: 0`
  jumps instantly — that is the reduced-motion path. Altitude ~1.8
  (`--globe-focus-altitude`) frames a point without zooming to the surface.
- **Controls:** `globe.controls()` returns a three.js `OrbitControls`.
  - `controls.autoRotate: boolean`, `controls.autoRotateSpeed: number`
    (~0.35 = slow idle spin; token `--globe-rotate-speed`).
  - `controls.addEventListener("start" | "end", fn)` fires on **user**
    interaction only (drag/zoom), not on auto-rotation — the correct hook for
    "pause while dragging, resume after idle". Remove listeners on cleanup.
  - Auto-rotation resume should go through a delay timer whose callback reads
    the latest state via refs (see the rotation machine in Globe.tsx).

## Props that are confirmed working

- `onPointClick(point, event, coords)` / `onPointHover(point | null, prevPoint | null)`.
  Hover emits `null` floods while the pointer roams — guard the state setter
  for identity before it becomes a re-render (see `setHoverGuarded` in App).
- Scrubbed-out (radius 0) points must be excluded in BOTH `onPointClick` and
  `onPointHover` — an ignored point can still be a raycast target.
- **Click priority between overlapping layers = altitude separation.** At equal
  `pointAltitude`, whichever point the raycast hits first wins arbitrarily — a
  basemap dot sharing coordinates with a hero point SWALLOWED the hero's click
  (verified: 6/6 dead clicks). Render the priority layer slightly higher
  (`pointAltitude` accessor, hero at `--globe-point-alt`, basemap at
  `× --globe-basemap-alt-factor`): the ray hits the higher cap first, so the
  hero always wins where they overlap while both layers stay clickable.
- **`pointerEventsFilter={(obj, data) => boolean}`** is the tool when a layer
  must be truly inert: handler-level ignoring leaves it in the raycast, showing
  a lying pointer cursor (globe.gl marks every hoverable point `.clickable`).
  Return `false` and the ray passes through entirely. Keep `data === undefined`
  returning `true` so the globe itself stays interactive. (Used here while the
  basemap was non-interactive; replaced by altitude separation when it gained
  its minimal catalog card.)
- `pointsTransitionDuration` — the grow/shrink tween for scrub/hover/selection;
  `0` under reduced motion.
- Rings layer (select ping): `ringsData`, `ringLat/ringLng`, `ringColor`
  (function accessor), `ringMaxRadius`, `ringPropagationSpeed`,
  `ringRepeatPeriod`. One ring on the selected record; `[]` under reduced
  motion or when the selection is scrubbed out.

## Token bridge

The canvas can't read `var(--token)` — `src/theme.ts` (`token`, `tokenNumber`,
`prefersReducedMotion`) reads computed values once per mount. Every tunable
globe number is a `--globe-*` token in `src/tokens.css`; never a literal in TSX.

## Reduced-motion checklist for any new globe motion

- `pointsTransitionDuration: 0`
- `pointOfView(..., 0)` (jump, don't fly)
- `ringsData: []`
- `autoRotate` defaults off (the explicit toggle may still opt in)
