import { useMemo } from "react";
import type { UAPRecord } from "../schema";
import { incidentYear } from "./data";

// A basic scrubber over incidentDate: show cases up to the chosen year.
// Undated cases are never hidden by the scrubber — hiding them would imply the
// scrubber knows when they happened. With the current corpus (all dates null,
// pending the portal-index join) the scrubber reports that state honestly.

interface TimelineProps {
  records: UAPRecord[];
  maxYear: number | null; // null = no filter
  onChange: (year: number | null) => void;
}

export function Timeline({ records, maxYear, onChange }: TimelineProps) {
  const { years, undatedCount } = useMemo(() => {
    const ys = records
      .map(incidentYear)
      .filter((y): y is number => y !== null)
      .sort((a, b) => a - b);
    return { years: ys, undatedCount: records.length - ys.length };
  }, [records]);

  if (years.length === 0) {
    return (
      <footer className="timeline">
        <span className="mono-label">timeline</span>
        <span className="timeline-empty">
          no dated cases yet — incident dates arrive with the portal-index join ·{" "}
          {undatedCount} undated
        </span>
      </footer>
    );
  }

  const min = years[0];
  const max = years[years.length - 1];
  const value = maxYear ?? max;
  const shown = years.filter((y) => y <= value).length;

  return (
    <footer className="timeline">
      <span className="mono-label">timeline</span>
      <span className="timeline-year">{min}</span>
      <input
        className="timeline-scrubber"
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const y = Number(e.target.value);
          onChange(y >= max ? null : y);
        }}
        aria-label="Show cases up to year"
      />
      <span className="timeline-year timeline-year-active">{value}</span>
      <span className="timeline-count">
        {shown} dated shown · {undatedCount} undated always shown
      </span>
    </footer>
  );
}
