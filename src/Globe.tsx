import { useEffect, useMemo, useRef, useState } from "react";
import GlobeGL, { type GlobeMethods } from "react-globe.gl";
import type { UAPRecord } from "../schema";
import { isBasemap } from "./data";
import { token, tokenNumber, prefersReducedMotion } from "./theme";

// The observatory instrument: NASA Black Marble night lights, a soft signal-dim
// rim glow, one point per plottable record shaped by geoPrecision (DESIGN.md).
// Records with unknown precision never reach this component — the App filters
// them into the CaseIndex instead of faking certainty here.

interface GlobeProps {
  records: UAPRecord[]; // plottable hero records (PURSUE)
  basemap: UAPRecord[]; // plottable Blue Book historical layer — low emphasis, not clickable
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

export function Globe({ records, basemap, selectedId, onSelect }: GlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { w, h } = useWindowSize();
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  // Tokens are static per page load; read once.
  const theme = useMemo(
    () => ({
      void: token("--bg-void"),
      signal: token("--signal"),
      signalDim: token("--signal-dim"),
      colorRegion: token("--globe-color-region"),
      colorTheater: token("--globe-color-theater"),
      atmosphereAlt: tokenNumber("--globe-atmosphere-alt", 0.12),
      rotateSpeed: tokenNumber("--globe-rotate-speed", 0.35),
      pointAlt: tokenNumber("--globe-point-alt", 0.01),
      radiusCrisp: tokenNumber("--globe-radius-crisp", 0.4),
      radiusRegion: tokenNumber("--globe-radius-region", 1.2),
      radiusTheater: tokenNumber("--globe-radius-theater", 2.4),
      ringPeriodMs: tokenNumber("--globe-ring-period-ms", 1800),
      ringMaxRadius: tokenNumber("--globe-ring-max-radius", 5),
      ringPropagationSpeed: tokenNumber("--globe-ring-propagation-speed", 1),
      emphasisBasemap: tokenNumber("--globe-emphasis-basemap", 0.55),
      colorBasemap: token("--globe-color-basemap"),
      colorBasemapRegion: token("--globe-color-basemap-region"),
      colorBasemapTheater: token("--globe-color-basemap-theater"),
    }),
    [],
  );

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = theme.rotateSpeed;
  }, [reducedMotion, theme.rotateSpeed]);

  // The basemap keeps the same precision-tier shape hierarchy as the hero layer
  // (crisp point / soft blob / faint area — the honesty rule applies to both),
  // just uniformly de-emphasized.
  const pointColor = (r: UAPRecord): string => {
    if (isBasemap(r)) {
      switch (r.geoPrecision) {
        case "region":
          return theme.colorBasemapRegion;
        case "theater":
          return theme.colorBasemapTheater;
        default:
          return theme.colorBasemap;
      }
    }
    if (r.id === selectedId) return theme.signal;
    switch (r.geoPrecision) {
      case "region":
        return theme.colorRegion;
      case "theater":
        return theme.colorTheater;
      default: // point | city — crisp, full signal
        return theme.signal;
    }
  };

  const pointRadius = (r: UAPRecord): number => {
    const tier =
      r.geoPrecision === "region"
        ? theme.radiusRegion
        : r.geoPrecision === "theater"
          ? theme.radiusTheater
          : theme.radiusCrisp;
    return isBasemap(r) ? tier * theme.emphasisBasemap : tier;
  };

  // A single "ping" ripple on the selected case (skipped under reduced motion).
  const selected = records.find((r) => r.id === selectedId);
  const ringsData = !reducedMotion && selected ? [selected] : [];

  // Basemap first so hero points draw over it at equal altitude.
  const points = useMemo(() => [...basemap, ...records], [basemap, records]);

  return (
    <div className="globe-layer" aria-hidden="true">
      <GlobeGL
        ref={globeRef}
        width={w}
        height={h}
        globeImageUrl="/earth-night.jpg"
        backgroundColor={theme.void}
        atmosphereColor={theme.signalDim}
        atmosphereAltitude={theme.atmosphereAlt}
        pointsData={points}
        pointLat={(d) => (d as UAPRecord).lat ?? 0}
        pointLng={(d) => (d as UAPRecord).lon ?? 0}
        pointColor={(d) => pointColor(d as UAPRecord)}
        pointRadius={(d) => pointRadius(d as UAPRecord)}
        pointAltitude={theme.pointAlt}
        onPointClick={(d) => {
          const r = d as UAPRecord;
          if (!isBasemap(r)) onSelect(r.id); // the basemap is texture, not UI
        }}
        ringsData={ringsData}
        ringLat={(d) => (d as UAPRecord).lat ?? 0}
        ringLng={(d) => (d as UAPRecord).lon ?? 0}
        ringColor={() => theme.signal}
        ringMaxRadius={theme.ringMaxRadius}
        ringPropagationSpeed={theme.ringPropagationSpeed}
        ringRepeatPeriod={theme.ringPeriodMs}
      />
    </div>
  );
}
