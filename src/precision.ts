// The single precision→style map, shared by the globe accessors AND the legend
// swatches (TICKETS.md T1): if the legend read its own values it would drift
// from what the globe actually draws. Pure functions; token reads happen once
// in readPrecisionTheme() and the result is passed in.

import type { GeoPrecision, UAPRecord } from "../schema";
import { isBasemap } from "./data";
import { token, tokenNumber } from "./theme";

export interface PrecisionTheme {
  signal: string;
  colorRegion: string;
  colorTheater: string;
  colorBasemap: string;
  colorBasemapRegion: string;
  colorBasemapTheater: string;
  radiusCrisp: number;
  radiusRegion: number;
  radiusTheater: number;
  emphasisBasemap: number;
  hoverScale: number;
}

export function readPrecisionTheme(): PrecisionTheme {
  return {
    signal: token("--signal"),
    colorRegion: token("--globe-color-region"),
    colorTheater: token("--globe-color-theater"),
    colorBasemap: token("--globe-color-basemap"),
    colorBasemapRegion: token("--globe-color-basemap-region"),
    colorBasemapTheater: token("--globe-color-basemap-theater"),
    radiusCrisp: tokenNumber("--globe-radius-crisp", 0.4),
    radiusRegion: tokenNumber("--globe-radius-region", 1.2),
    radiusTheater: tokenNumber("--globe-radius-theater", 2.4),
    emphasisBasemap: tokenNumber("--globe-emphasis-basemap", 0.55),
    hoverScale: tokenNumber("--globe-hover-scale", 1.5),
  };
}

export interface PointContext {
  selectedId: string | null;
  hoveredId: string | null;
  visible: boolean; // false when the timeline has scrubbed the record out
}

// The basemap keeps the same precision-tier shape hierarchy as the hero layer
// (crisp point / soft blob / faint area — the honesty rule applies to both),
// just uniformly de-emphasized.
export function pointColorFor(r: UAPRecord, t: PrecisionTheme, ctx: PointContext): string {
  // Active state wins for BOTH layers: a hovered/selected Blue Book dot lights
  // up like any case — it opens a (minimal) case card, so it earns the signal.
  if (r.id === ctx.selectedId || r.id === ctx.hoveredId) return t.signal;
  if (isBasemap(r)) {
    switch (r.geoPrecision) {
      case "region":
        return t.colorBasemapRegion;
      case "theater":
        return t.colorBasemapTheater;
      default:
        return t.colorBasemap;
    }
  }
  switch (r.geoPrecision) {
    case "region":
      return t.colorRegion;
    case "theater":
      return t.colorTheater;
    default: // point | city — crisp, full signal
      return t.signal;
  }
}

export function pointRadiusFor(r: UAPRecord, t: PrecisionTheme, ctx: PointContext): number {
  if (!ctx.visible) return 0;
  const tier =
    r.geoPrecision === "region"
      ? t.radiusRegion
      : r.geoPrecision === "theater"
        ? t.radiusTheater
        : t.radiusCrisp;
  const base = isBasemap(r) ? tier * t.emphasisBasemap : tier;
  return r.id === ctx.hoveredId ? base * t.hoverScale : base;
}

// Legend-facing descriptors: one entry per mark the globe can draw, in the
// order a reader should learn them. color/radius null = "not drawn at all".
export interface LegendTier {
  key: string;
  precision: readonly GeoPrecision[];
  label: string;
  note: string;
  color: string | null;
  radius: number | null; // globe-radius units; the legend scales via --legend-swatch-unit
}

export function legendTiers(t: PrecisionTheme): LegendTier[] {
  return [
    {
      key: "crisp",
      precision: ["point", "city"],
      label: "point / city",
      note: "location known to a point or city — crisp dot",
      color: t.signal,
      radius: t.radiusCrisp,
    },
    {
      key: "region",
      precision: ["region"],
      label: "region",
      note: "regional centroid only — soft blob",
      color: t.colorRegion,
      radius: t.radiusRegion,
    },
    {
      key: "theater",
      precision: ["theater"],
      label: "theater",
      note: "broad operational area — large faint mark",
      color: t.colorTheater,
      radius: t.radiusTheater,
    },
    {
      key: "unknown",
      precision: ["unknown"],
      label: "unknown",
      note: "no honest location — not plotted; case index only",
      color: null,
      radius: null,
    },
    {
      key: "basemap",
      precision: ["point", "city", "region", "theater"],
      label: "blue book basemap",
      note: "historical USAF unknowns (1947–1969) — dim; click for the catalog entry",
      color: t.colorBasemap,
      radius: t.radiusCrisp * t.emphasisBasemap,
    },
  ];
}
