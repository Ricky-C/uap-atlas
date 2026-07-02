import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import type { UAPRecord } from "../schema";
import { Drawer } from "./Drawer";
import { Timeline } from "./Timeline";
import { CaseIndex } from "./CaseIndex";
import { Redaction } from "./Redaction";
import { Legend } from "./Legend";
import { Header } from "./Header";
import { Onboarding } from "./Onboarding";
import { About } from "./About";
import { RotationControl } from "./RotationControl";
import {
  RECORDS,
  BLUEBOOK,
  EMPTY_FILTERS,
  filterForIndex,
  isPlottable,
  isLunar,
  incidentYear,
  sortForIndex,
  type IndexFilters,
} from "./data";
import { prefersReducedMotion } from "./theme";
import { useLocalStorageFlag } from "./useLocalStorageFlag";
import type { HoverState } from "./selection";

// The globe carries three.js + react-globe.gl (~600 KB gz) — split it into an
// async chunk so the chrome paints first; the void shows through until it lands.
const Globe = lazy(() => import("./Globe").then((m) => ({ default: m.Globe })));

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
  // Mobile only: the bottom sheet's tap-to-raise state (no drag physics).
  // Desktop ignores it — the sheet wrapper is display:contents there.
  const [sheetExpanded, setSheetExpanded] = useState(false);
  // Case-index quick filters live here, not in CaseIndex — the INDEX↔ANALYSIS
  // toggle unmounts the panel and a user's filters must survive the round trip.
  const [indexFilters, setIndexFilters] = useState<IndexFilters>(EMPTY_FILTERS);
  // Rotation is user intent (T6): on by default, off under reduced motion —
  // but the explicit toggle can still opt in.
  const [rotationOn, setRotationOn] = useState(() => !prefersReducedMotion());
  const [onboardingDismissed, dismissOnboarding] = useLocalStorageFlag(
    "uap-atlas:onboarding-dismissed",
  );

  // The globe's onPointHover floods identical/null values while the pointer
  // moves; this guard keeps them from becoming re-renders (T4).
  const setHoverGuarded = useCallback((next: HoverState | null) => {
    setHover((prev) => (prev?.id === next?.id && prev?.source === next?.source ? prev : next));
  }, []);

  // The Globe receives the FULL plottable sets plus the cutoff — points past the
  // cutoff tween to radius 0 there rather than unmounting, so scrubbing animates.
  const plotted = useMemo(() => RECORDS.filter(isPlottable), []);
  const basemap = useMemo(() => BLUEBOOK.filter(isPlottable), []);
  // Lunar/cislunar cases anchor to the moon marker instead of an Earth point.
  const lunar = useMemo(() => RECORDS.filter(isLunar), []);

  // The case index is a list, not a canvas — it filters the ordinary way. It
  // carries the whole corpus (plotted and unplotted), newest incidents first;
  // the quick filters then narrow that year-scoped list, and the panel's
  // counts describe what survived BOTH cuts.
  const indexRecords = useMemo(() => sortForIndex(upToYear(RECORDS, maxYear)), [maxYear]);
  const filteredRecords = useMemo(
    () => filterForIndex(indexRecords, indexFilters),
    [indexRecords, indexFilters],
  );
  const plottedShown = useMemo(() => filteredRecords.filter(isPlottable).length, [filteredRecords]);
  const lunarShown = useMemo(
    () => filteredRecords.filter((r) => !isPlottable(r) && isLunar(r)).length,
    [filteredRecords],
  );
  const unplottedShown = filteredRecords.length - plottedShown - lunarShown;
  // Deliberately not cleared when the timeline scrubs the selected case out of
  // view: the open case file stays readable; only its globe point recedes.
  // Blue Book basemap dots are selectable too (they open a minimal catalog
  // card), so the lookup spans both corpora.
  const selected = selectedId
    ? (RECORDS.find((r) => r.id === selectedId) ??
      BLUEBOOK.find((r) => r.id === selectedId) ??
      null)
    : null;
  const timelineRecords = useMemo(() => [...RECORDS, ...BLUEBOOK], []);

  return (
    // data-selected lets the mobile CSS swap the sheet's contents (index ↔
    // case file) without a resize listener; desktop selectors ignore it.
    <main className="app" data-selected={selected !== null || undefined}>
      <Suspense fallback={null}>
        <Globe
          records={plotted}
          basemap={basemap}
          lunar={lunar}
          maxYear={maxYear}
          selectedId={selectedId}
          hoveredId={hover?.id ?? null}
          rotationOn={rotationOn}
          onSelect={setSelectedId}
          onHover={(id) => setHoverGuarded(id ? { id, source: "globe" } : null)}
        />
      </Suspense>
      <Header onOpenAbout={() => setAboutOpen(true)} />
      {/* The sheet is a layout ghost on desktop (display:contents) and the
          glass bottom sheet on mobile — same children either way. */}
      <div className={sheetExpanded ? "sheet sheet-expanded" : "sheet"}>
        <button
          type="button"
          className="sheet-handle"
          onClick={() => setSheetExpanded((v) => !v)}
          aria-label={sheetExpanded ? "Collapse the case sheet" : "Expand the case sheet"}
          aria-expanded={sheetExpanded}
        >
          <span className="sheet-handle-bar" aria-hidden="true" />
        </button>
        {panel === "cases" ? (
          <CaseIndex
            records={filteredRecords}
            totalRecords={indexRecords}
            filters={indexFilters}
            onFiltersChange={setIndexFilters}
            plottedCount={plottedShown}
            lunarCount={lunarShown}
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
      </div>
      <RotationControl on={rotationOn} onToggle={() => setRotationOn((v) => !v)} />
      <Timeline records={timelineRecords} maxYear={maxYear} onChange={setMaxYear} />
      {!onboardingDismissed && <Onboarding onDismiss={dismissOnboarding} />}
      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
    </main>
  );
}
