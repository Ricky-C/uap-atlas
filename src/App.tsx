import { useMemo, useState } from "react";
import { Globe } from "./Globe";
import { Drawer } from "./Drawer";
import { Timeline } from "./Timeline";
import { CaseIndex } from "./CaseIndex";
import { RECORDS, isPlottable, incidentYear } from "./data";

export function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [maxYear, setMaxYear] = useState<number | null>(null);

  // The timeline hides dated cases after the cutoff; undated cases always show.
  const visible = useMemo(() => {
    if (maxYear === null) return RECORDS;
    return RECORDS.filter((r) => {
      const y = incidentYear(r);
      return y === null || y <= maxYear;
    });
  }, [maxYear]);

  const plotted = useMemo(() => visible.filter(isPlottable), [visible]);
  const unplotted = useMemo(() => visible.filter((r) => !isPlottable(r)), [visible]);
  const selected = selectedId ? (RECORDS.find((r) => r.id === selectedId) ?? null) : null;

  return (
    <main className="app">
      <Globe records={plotted} selectedId={selectedId} onSelect={setSelectedId} />
      <CaseIndex
        records={unplotted}
        plottedCount={plotted.length}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <Drawer record={selected} onClose={() => setSelectedId(null)} />
      <Timeline records={RECORDS} maxYear={maxYear} onChange={setMaxYear} />
    </main>
  );
}
