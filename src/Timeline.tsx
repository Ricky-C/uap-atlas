import { useEffect, useMemo, useRef, useState } from "react";
import type { UAPRecord } from "../schema";
import { incidentYear } from "./data";
import { tokenNumber, prefersReducedMotion } from "./theme";

// A scrubber over incidentDate: show cases up to the chosen year, with a play
// control that sweeps the full range (the globe tweens points in as it runs).
// The track is a per-year density histogram (TICKETS.md T5) — empty years stay
// empty so clustering is visible; years inside the active range render brighter.
// Undated cases are never hidden by the scrubber — hiding them would imply the
// scrubber knows when they happened.

interface TimelineProps {
  records: UAPRecord[];
  maxYear: number | null; // null = no filter
  onChange: (year: number | null) => void;
}

export function Timeline({ records, maxYear, onChange }: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  // The interval callback reads the latest cutoff through a ref so the sweep
  // advances from wherever the user last scrubbed, without re-arming the timer.
  const yearRef = useRef(maxYear);
  useEffect(() => {
    yearRef.current = maxYear;
  }, [maxYear]);

  const { years, undatedCount } = useMemo(() => {
    const ys = records
      .map(incidentYear)
      .filter((y): y is number => y !== null)
      .sort((a, b) => a - b);
    return { years: ys, undatedCount: records.length - ys.length };
  }, [records]);

  const minYear = years[0];
  const lastYear = years[years.length - 1];

  // One bar per calendar year over the continuous range — zero-count years
  // render as gaps, which is what makes the clustering legible.
  const { bars, peak } = useMemo(() => {
    if (years.length === 0) return { bars: [], peak: 0 };
    const counts = new Map<number, number>();
    for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1);
    const out: { year: number; count: number }[] = [];
    let max = 0;
    for (let y = years[0]; y <= years[years.length - 1]; y++) {
      const count = counts.get(y) ?? 0;
      if (count > max) max = count;
      out.push({ year: y, count });
    }
    return { bars: out, peak: max };
  }, [years]);

  useEffect(() => {
    if (!playing || minYear === undefined) return;
    // Under reduced motion the globe tween is off, so a fast sweep would strobe
    // points in and out — slow the cadence to keep the sweep calm.
    const step = prefersReducedMotion()
      ? tokenNumber("--timeline-play-step-ms-reduced", 700)
      : tokenNumber("--timeline-play-step-ms", 180);
    const id = window.setInterval(() => {
      // Advance the ref here too — waiting for the prop round-trip alone would
      // stall a year whenever a render outlasts the step interval.
      const next = (yearRef.current ?? minYear - 1) + 1;
      if (next >= lastYear) {
        yearRef.current = null;
        onChange(null); // sweep complete — back to "everything"
        setPlaying(false);
      } else {
        yearRef.current = next;
        onChange(next);
      }
    }, step);
    return () => window.clearInterval(id);
  }, [playing, minYear, lastYear, onChange]);

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

  const value = maxYear ?? lastYear;
  const shown = years.filter((y) => y <= value).length;

  return (
    <footer className="timeline">
      <span className="mono-label">timeline</span>
      <button
        type="button"
        className="timeline-play"
        onClick={() => {
          if (!playing && maxYear === null) onChange(minYear); // sweep from the start
          setPlaying(!playing);
        }}
        aria-label={playing ? "Pause the year sweep" : "Play the year sweep"}
      >
        {playing ? "pause" : "play"}
      </button>
      <span className="timeline-year">{minYear}</span>
      <div className="timeline-track">
        <div className="timeline-hist" aria-hidden="true">
          {bars.map((b) => (
            <span
              key={b.year}
              className={[
                "timeline-bar",
                b.count > 0 ? "timeline-bar-solid" : "",
                b.year <= value ? "timeline-bar-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              // Height is data (count/peak), not styling — rounded per rule 7.
              style={{ height: b.count === 0 ? 0 : `${Math.round((b.count / peak) * 100)}%` }}
            />
          ))}
        </div>
        <input
          className="timeline-scrubber"
          type="range"
          min={minYear}
          max={lastYear}
          value={value}
          onChange={(e) => {
            setPlaying(false); // a manual scrub takes the wheel
            const y = Number(e.target.value);
            onChange(y >= lastYear ? null : y);
          }}
          aria-label="Show cases up to year"
        />
      </div>
      <span className="timeline-year timeline-year-active">{value}</span>
      <span className="timeline-count">
        {shown} dated shown · {undatedCount} undated always shown
      </span>
    </footer>
  );
}
