import { useCallback, useMemo, useState } from "react";
import type { UAPRecord } from "../schema";
import { Globe } from "./Globe";
import { Drawer } from "./Drawer";
import { Timeline } from "./Timeline";
import { CaseIndex } from "./CaseIndex";
import { Redaction } from "./Redaction";
import { Legend } from "./Legend";
import { Header } from "./Header";
import { Onboarding } from "./Onboarding";
import { About } from "./About";
import { RotationControl } from "./RotationControl";
import { RECORDS, BLUEBOOK, isPlottable, incidentYear, sortForIndex } from "./data";
import { prefersReducedMotion } from "./theme";
import { useLocalStorageFlag } from "./useLocalStorageFlag";
import type { HoverState } from "./selection";

// The timeline hides dated cases after the cutoff; undated cases always show —
// hiding them would imply we know when they happened.
function upToYear(records: UAPRecord[], maxYear: number | null): UAPRecord[] {
  if (maxYear === null) return records;
  return records.filter((r) => {
    const y = incidentYear(r);
    return y === null || y <= maxYear;
  });
}

export function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [maxYear, setMaxYear] = useState<number | null>(null);
  const [panel, setPanel] = useState<"cases" | "analysis">("cases");
  const [aboutOpen, setAboutOpen] = useState(false);
  // Rotation is user intent (T6): on by default, off under reduced motion —
  // but the explicit toggle can still opt in.
  const [rotationOn, setRotationOn] = useState(() => !prefersReducedMotion());
  const [onboardingDismissed, dismissOnboarding] = useLocalStorageFlag(
    "uap-atlas:onboarding-dismissed",
  );

  // The globe's onPointHover floods identical/null values while the pointer
  // moves; this guard keeps them from becoming re-renders (T4).
  const setHoverGuarded = useCallback((next: HoverState | null) => {
    setHover((prev) =>
      prev?.id === next?.id && prev?.source === next?.source ? prev : next,
    );
  }, []);

  // The Globe receives the FULL plottable sets plus the cutoff — points past the
  // cutoff tween to radius 0 there rather than unmounting, so scrubbing animates.
  const plotted = useMemo(() => RECORDS.filter(isPlottable), []);
  const basemap = useMemo(() => BLUEBOOK.filter(isPlottable), []);

  // The case index is a list, not a canvas — it filters the ordinary way. It
  // carries the whole corpus (plotted and unplotted), newest incidents first.
  const indexRecords = useMemo(() => sortForIndex(upToYear(RECORDS, maxYear)), [maxYear]);
  const plottedShown = useMemo(() => upToYear(plotted, maxYear).length, [plotted, maxYear]);
  const unplottedShown = indexRecords.length - plottedShown;
  // Deliberately not cleared when the timeline scrubs the selected case out of
  // view: the open case file stays readable; only its globe point recedes.
  const selected = selectedId ? (RECORDS.find((r) => r.id === selectedId) ?? null) : null;
  const timelineRecords = useMemo(() => [...RECORDS, ...BLUEBOOK], []);

  return (
    <main className="app">
      <Globe
        records={plotted}
        basemap={basemap}
        maxYear={maxYear}
        selectedId={selectedId}
        hoveredId={hover?.id ?? null}
        rotationOn={rotationOn}
        onSelect={setSelectedId}
        onHover={(id) => setHoverGuarded(id ? { id, source: "globe" } : null)}
      />
      <Header onOpenAbout={() => setAboutOpen(true)} />
      {panel === "cases" ? (
        <CaseIndex
          records={indexRecords}
          plottedCount={plottedShown}
          unplottedCount={unplottedShown}
          selectedId={selectedId}
          hover={hover}
          onSelect={setSelectedId}
          onHover={setHoverGuarded}
          onShowAnalysis={() => setPanel("analysis")}
        />
      ) : (
        <Redaction records={RECORDS} onShowCases={() => setPanel("cases")} />
      )}
      <div className="right-col">
        <Drawer record={selected} onClose={() => setSelectedId(null)} />
        <Legend collapsed={selected !== null} />
      </div>
      <RotationControl on={rotationOn} onToggle={() => setRotationOn((v) => !v)} />
      <Timeline records={timelineRecords} maxYear={maxYear} onChange={setMaxYear} />
      {!onboardingDismissed && <Onboarding onDismiss={dismissOnboarding} />}
      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
    </main>
  );
}
