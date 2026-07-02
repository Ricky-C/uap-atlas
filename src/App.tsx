import { useMemo, useState } from "react";
import type { UAPRecord } from "../schema";
import { Globe } from "./Globe";
import { Drawer } from "./Drawer";
import { Timeline } from "./Timeline";
import { CaseIndex } from "./CaseIndex";
import { RECORDS, BLUEBOOK, isPlottable, incidentYear } from "./data";

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
  const [maxYear, setMaxYear] = useState<number | null>(null);

  // The Globe receives the FULL plottable sets plus the cutoff — points past the
  // cutoff tween to radius 0 there rather than unmounting, so scrubbing animates.
  const plotted = useMemo(() => RECORDS.filter(isPlottable), []);
  const basemap = useMemo(() => BLUEBOOK.filter(isPlottable), []);

  // The case index is a list, not a canvas — it filters the ordinary way.
  const unplotted = useMemo(
    () => upToYear(RECORDS, maxYear).filter((r) => !isPlottable(r)),
    [maxYear],
  );
  const plottedShown = useMemo(() => upToYear(plotted, maxYear).length, [plotted, maxYear]);
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
        onSelect={setSelectedId}
      />
      <CaseIndex
        records={unplotted}
        plottedCount={plottedShown}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <Drawer record={selected} onClose={() => setSelectedId(null)} />
      <Timeline records={timelineRecords} maxYear={maxYear} onChange={setMaxYear} />
    </main>
  );
}
