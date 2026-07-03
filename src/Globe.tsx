import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GlobeGL, { type GlobeMethods } from "react-globe.gl";
import { Color, Mesh, MeshLambertMaterial, SphereGeometry, type Object3D } from "three";
import type { UAPRecord } from "../schema";
import { isBasemap, incidentYear } from "./data";
import { token, tokenNumber, prefersReducedMotion } from "./theme";
import { pointColorFor, pointRadiusFor, readPrecisionTheme } from "./precision";

// The observatory instrument: NASA Black Marble night lights, a soft signal-dim
// rim glow, one point per plottable record shaped by geoPrecision (DESIGN.md).
// Records with unknown precision never reach this component — the App filters
// them into the CaseIndex instead of faking certainty here.
// Point color/radius come from the shared precision→style map (precision.ts),
// which the legend also draws from — the two can't drift.

interface GlobeProps {
  records: UAPRecord[]; // ALL plottable hero records (PURSUE) — year filter applied here
  basemap: UAPRecord[]; // ALL plottable Blue Book records — low emphasis, minimal case card on click
  lunar: UAPRecord[]; // lunar/cislunar cases — anchored to the symbolic moon marker
  maxYear: number | null; // timeline cutoff; null = everything
  // The case-index filters, as the ids that survived them; null = no filter.
  // Non-matching PURSUE points tween to radius 0 exactly like the year scrub.
  // The Blue Book basemap is context, never filtered.
  filteredIds: ReadonlySet<string> | null;
  selectedId: string | null;
  hoveredId: string | null; // linked hover from either the list or the globe (T4)
  rotationOn: boolean; // user intent from the rotation toggle (T6)
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

// Objects-layer data: the moon itself plus one marker per lunar case, ringed
// around it so each stays individually clickable.
type MoonObj =
  | { kind: "moon"; lat: number; lng: number; alt: number }
  | { kind: "case"; record: UAPRecord; lat: number; lng: number; alt: number };

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

export function Globe({
  records,
  basemap,
  lunar,
  maxYear,
  filteredIds,
  selectedId,
  hoveredId,
  rotationOn,
  onSelect,
  onHover,
}: GlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { w, h } = useWindowSize();
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  // Tokens are static per page load; read once.
  const theme = useMemo(
    () => ({
      void: token("--bg-void"),
      signal: token("--signal"),
      signalDim: token("--signal-dim"),
      atmosphereAlt: tokenNumber("--globe-atmosphere-alt", 0.12),
      rotateSpeed: tokenNumber("--globe-rotate-speed", 0.35),
      pointAlt: tokenNumber("--globe-point-alt", 0.01),
      ringPeriodMs: tokenNumber("--globe-ring-period-ms", 1800),
      ringMaxRadius: tokenNumber("--globe-ring-max-radius", 5),
      ringPropagationSpeed: tokenNumber("--globe-ring-propagation-speed", 1),
      pointsTransitionMs: tokenNumber("--globe-points-transition-ms", 600),
      basemapAltFactor: tokenNumber("--globe-basemap-alt-factor", 0.5),
      focusAltitude: tokenNumber("--globe-focus-altitude", 1.8),
      focusMs: tokenNumber("--globe-focus-ms", 1000),
      rotateResumeMs: tokenNumber("--globe-rotate-resume-ms", 4000),
      moonLat: tokenNumber("--globe-moon-lat", 18),
      moonLng: tokenNumber("--globe-moon-lng", -152),
      moonAlt: tokenNumber("--globe-moon-alt", 2.4),
      moonRadius: tokenNumber("--globe-moon-radius", 9),
      moonColor: token("--globe-moon-color"),
      moonCaseRadius: tokenNumber("--globe-moon-case-radius", 1.6),
      moonCaseSpread: tokenNumber("--globe-moon-case-spread", 3.4),
      moonFocusAltitude: tokenNumber("--globe-moon-focus-altitude", 4.6),
      moonEmissive: tokenNumber("--globe-moon-emissive", 0.25),
      markerEmissive: tokenNumber("--globe-marker-emissive", 0.4),
      markerEmissiveActive: tokenNumber("--globe-marker-emissive-active", 1),
    }),
    [],
  );
  const precisionTheme = useMemo(() => readPrecisionTheme(), []);

  // ── auto-rotation state machine (T6) ────────────────────────────────────
  // autoRotate is on iff: the user toggle is on, nothing is selected, the user
  // isn't dragging, and the post-interaction cooldown has elapsed. Pauses take
  // effect immediately; resumes go through a delay timer. The timer callback
  // reads the latest toggle/selection through refs so it is never stale.
  const rotationOnRef = useRef(rotationOn);
  const selectedIdRef = useRef(selectedId);
  const interactingRef = useRef(false);
  const resumeTimerRef = useRef<number | null>(null);

  const applyRotation = useCallback(() => {
    // Reduced-motion isn't checked here by design: it sets the DEFAULT of the
    // rotationOn toggle in App.tsx, and an explicit user toggle may opt in.
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate =
      rotationOnRef.current && selectedIdRef.current === null && !interactingRef.current;
  }, []);

  const pauseRotation = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    const controls = globeRef.current?.controls();
    if (controls) controls.autoRotate = false;
  }, []);

  const armResume = useCallback(() => {
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      applyRotation();
    }, theme.rotateResumeMs);
  }, [applyRotation, theme.rotateResumeMs]);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotateSpeed = theme.rotateSpeed;
    // OrbitControls "start"/"end" fire on user interaction only, not on the
    // auto-rotation itself — exactly the "pause while dragging" hook we need.
    const onStart = () => {
      interactingRef.current = true;
      pauseRotation();
    };
    const onEnd = () => {
      interactingRef.current = false;
      armResume();
    };
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);
    applyRotation();
    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    };
  }, [theme.rotateSpeed, applyRotation, pauseRotation, armResume]);

  useEffect(() => {
    rotationOnRef.current = rotationOn;
    // The explicit toggle applies immediately in both directions.
    if (rotationOn) applyRotation();
    else pauseRotation();
  }, [rotationOn, applyRotation, pauseRotation]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    // A selected case pins the globe — it must not drift off the file being
    // read. Deselecting resumes only after the idle delay, never with a snap
    // (and only when the user's toggle is on — no pointless timers otherwise).
    if (selectedId !== null) pauseRotation();
    else if (rotationOnRef.current) armResume();
  }, [selectedId, pauseRotation, armResume]);

  // ── fly-to on select (T7) ───────────────────────────────────────────────
  // Centers the camera on the case from either entry point (globe click or
  // list click — both share selectedId). Region/theater center on the stored
  // centroid; unplotted records never get here (lat/lon guard). Under reduced
  // motion the camera jumps instead of flying.
  // Basemap first so hero points draw over it at equal lat/lng.
  const points = useMemo(() => [...basemap, ...records], [basemap, records]);

  // ── the moon and its lunar cases (objects layer) ────────────────────────
  // A symbolic marker in "orbit" (not to scale — the legend says so). Each
  // lunar case is a small sphere ringed around the moon so it can be hovered
  // and clicked individually. The timeline cutoff applies like everywhere else.
  const moonObjects = useMemo<MoonObj[]>(() => {
    const objs: MoonObj[] = [
      { kind: "moon", lat: theme.moonLat, lng: theme.moonLng, alt: theme.moonAlt },
    ];
    const shown = lunar.filter((r) => {
      // No isBasemap exemption here (unlike visibleAt): lunar is built from
      // RECORDS only — Blue Book never anchors to the moon.
      if (filteredIds !== null && !filteredIds.has(r.id)) return false;
      if (maxYear === null) return true;
      const y = incidentYear(r);
      return y === null || y <= maxYear;
    });
    shown.forEach((record, i) => {
      const a = (2 * Math.PI * i) / shown.length;
      objs.push({
        kind: "case",
        record,
        lat: theme.moonLat + theme.moonCaseSpread * Math.sin(a),
        lng: theme.moonLng + theme.moonCaseSpread * Math.cos(a),
        alt: theme.moonAlt,
      });
    });
    return objs;
  }, [lunar, maxYear, filteredIds, theme]);

  // Marker materials by record id, so selection/hover emphasis can mutate the
  // existing meshes instead of rebuilding the objects layer.
  const markerMats = useRef(new Map<string, MeshLambertMaterial>());
  const moonObjectFor = (d: MoonObj): Object3D => {
    if (d.kind === "moon") {
      const mat = new MeshLambertMaterial({ color: new Color(theme.moonColor) });
      mat.emissive = new Color(theme.moonColor);
      mat.emissiveIntensity = theme.moonEmissive;
      return new Mesh(new SphereGeometry(theme.moonRadius, 32, 32), mat);
    }
    const mat = new MeshLambertMaterial({ color: new Color(theme.signal) });
    mat.emissive = new Color(theme.signal);
    mat.emissiveIntensity = theme.markerEmissive;
    markerMats.current.set(d.record.id, mat);
    return new Mesh(new SphereGeometry(theme.moonCaseRadius, 16, 16), mat);
  };

  useEffect(() => {
    for (const [id, mat] of markerMats.current) {
      mat.emissiveIntensity =
        id === selectedId || id === hoveredId ? theme.markerEmissiveActive : theme.markerEmissive;
    }
  }, [selectedId, hoveredId, theme.markerEmissiveActive, theme.markerEmissive]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || selectedId === null) return;
    const r = points.find((x) => x.id === selectedId);
    if (r && r.lat !== null && r.lon !== null) {
      globe.pointOfView(
        { lat: r.lat, lng: r.lon, altitude: theme.focusAltitude },
        reducedMotion ? 0 : theme.focusMs,
      );
      return;
    }
    // A lunar case centers the camera on the moon anchor instead.
    if (lunar.some((x) => x.id === selectedId)) {
      globe.pointOfView(
        { lat: theme.moonLat, lng: theme.moonLng, altitude: theme.moonFocusAltitude },
        reducedMotion ? 0 : theme.focusMs,
      );
    }
  }, [selectedId, points, lunar, theme, reducedMotion]);

  // Visibility gate for points, rings, and click/hover targets. Two cuts, both
  // tweened (points stay mounted; radius animates to 0, never a hard cut):
  //   - the timeline cutoff: dated records past it hide; undated always show —
  //     hiding them would imply we know when they were;
  //   - the case-index filters: a PURSUE point outside the filtered set hides;
  //     the basemap is context and never filtered.
  const visibleAt = (r: UAPRecord): boolean => {
    if (filteredIds !== null && !isBasemap(r) && !filteredIds.has(r.id)) return false;
    if (maxYear === null) return true;
    const y = incidentYear(r);
    return y === null || y <= maxYear;
  };

  // A single "ping" ripple on the selected case (skipped under reduced motion,
  // and when the timeline has scrubbed the selected case out of view). It also
  // marks fly-to arrival — the ripple is already running when the camera lands.
  const selected = points.find((r) => r.id === selectedId);
  const ringsData = !reducedMotion && selected && visibleAt(selected) ? [selected] : [];

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
        // These accessor closures must stay unmemoized: react-globe.gl only
        // re-evaluates radius/color (and tweens the change) when the accessor
        // prop's identity changes — a useCallback here would freeze the scrub
        // (and the hover/selection emphasis, which ride the same tween).
        pointColor={(d) => {
          const r = d as UAPRecord;
          return pointColorFor(r, precisionTheme, { selectedId, hoveredId, visible: visibleAt(r) });
        }}
        pointRadius={(d) => {
          const r = d as UAPRecord;
          return pointRadiusFor(r, precisionTheme, {
            selectedId,
            hoveredId,
            visible: visibleAt(r),
          });
        }}
        // Hero cases render a hair above the basemap: where a PURSUE point and a
        // Blue Book dot share coordinates, the raycast hits the higher cap first,
        // so the case with a real document always wins the click. Both layers are
        // interactive — a basemap dot opens its minimal catalog card.
        pointAltitude={(d) =>
          isBasemap(d as UAPRecord) ? theme.pointAlt * theme.basemapAltFactor : theme.pointAlt
        }
        pointsTransitionDuration={reducedMotion ? 0 : theme.pointsTransitionMs}
        onPointClick={(d) => {
          const r = d as UAPRecord;
          // A scrubbed-out (radius 0) point isn't a target.
          if (visibleAt(r)) onSelect(r.id);
        }}
        onPointHover={(d) => {
          const r = d as UAPRecord | null;
          onHover(r && visibleAt(r) ? r.id : null);
        }}
        ringsData={ringsData}
        ringLat={(d) => (d as UAPRecord).lat ?? 0}
        ringLng={(d) => (d as UAPRecord).lon ?? 0}
        ringColor={() => theme.signal}
        ringMaxRadius={theme.ringMaxRadius}
        ringPropagationSpeed={theme.ringPropagationSpeed}
        ringRepeatPeriod={theme.ringPeriodMs}
        objectsData={moonObjects}
        objectLat={(d) => (d as MoonObj).lat}
        objectLng={(d) => (d as MoonObj).lng}
        objectAltitude={(d) => (d as MoonObj).alt}
        objectThreeObject={(d) => moonObjectFor(d as MoonObj)}
        onObjectClick={(d) => {
          const o = d as MoonObj;
          if (o.kind === "case") onSelect(o.record.id);
          // Clicking the moon itself frames it — a viewport for the lunar cases.
          else
            globeRef.current?.pointOfView(
              { lat: theme.moonLat, lng: theme.moonLng, altitude: theme.moonFocusAltitude },
              reducedMotion ? 0 : theme.focusMs,
            );
        }}
        onObjectHover={(d) => {
          const o = d as MoonObj | null;
          onHover(o && o.kind === "case" ? o.record.id : null);
        }}
      />
    </div>
  );
}
