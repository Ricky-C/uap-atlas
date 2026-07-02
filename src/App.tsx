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

  const visible = useMemo(() => upToYear(RECORDS, maxYear), [maxYear]);
  const basemap = useMemo(() => upToYear(BLUEBOOK, maxYear).filter(isPlottable), [maxYear]);

  const plotted = useMemo(() => visible.filter(isPlottable), [visible]);
  const unplotted = useMemo(() => visible.filter((r) => !isPlottable(r)), [visible]);
  const selected = selectedId ? (RECORDS.find((r) => r.id === selectedId) ?? null) : null;
  const timelineRecords = useMemo(() => [...RECORDS, ...BLUEBOOK], []);

  return (
    <main className="app">
      <Globe
        records={plotted}
        basemap={basemap}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <CaseIndex
        records={unplotted}
        plottedCount={plotted.length}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <Drawer record={selected} onClose={() => setSelectedId(null)} />
      <Timeline records={timelineRecords} maxYear={maxYear} onChange={setMaxYear} />
    </main>
  );
}
