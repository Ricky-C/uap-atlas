import { useEffect, useRef } from "react";
import type { UAPRecord } from "../schema";
import { isPlottable } from "./data";
import { prefersReducedMotion } from "./theme";
import type { HoverState } from "./selection";

// The case index: the FULL corpus, plotted and unplotted alike (TICKETS.md T2).
// Rows lead with what tells cases apart — location and incident date — and
// fall back honestly ("location unknown", "undated") rather than leaving gaps.
// Cases that can't honestly be plotted (geoPrecision "unknown") are tagged
// "not on globe" instead of being faked onto it (DESIGN.md).

interface CaseIndexProps {
  records: UAPRecord[]; // year-filtered, index-sorted corpus
  plottedCount: number;
  unplottedCount: number;
  selectedId: string | null;
  hover: HoverState | null;
  onSelect: (id: string) => void;
  onHover: (h: HoverState | null) => void;
  onShowAnalysis: () => void;
}

function rowClass(r: UAPRecord, selectedId: string | null, hover: HoverState | null): string {
  let cls = "case-row";
  if (r.id === selectedId) cls += " case-row-active";
  // Only globe-originated hover paints the row — list-side hover is the
  // row's own :hover, and echoing it back would double-highlight.
  if (hover?.id === r.id && hover.source === "globe") cls += " case-row-hovered";
  return cls;
}

export function CaseIndex({
  records,
  plottedCount,
  unplottedCount,
  selectedId,
  hover,
  onSelect,
  onHover,
  onShowAnalysis,
}: CaseIndexProps) {
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  // Hovering a globe point brings its row into view. "nearest" keeps the list
  // still when the row is already visible — no scroll thrash while sweeping
  // the pointer across points.
  useEffect(() => {
    if (hover?.source !== "globe") return;
    rowRefs.current.get(hover.id)?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [hover]);

  // Selecting from the globe likewise reveals the row — the list mirrors the
  // fly-to (T7): both sides center on the same case.
  useEffect(() => {
    if (selectedId === null) return;
    rowRefs.current.get(selectedId)?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [selectedId]);

  return (
    <section className="case-index" aria-label="Case index">
      <header className="case-index-header">
        <span className="mono-label">case index</span>
        <span className="case-index-count">
          {plottedCount} on globe · {unplottedCount} unplotted
        </span>
        <button type="button" className="panel-toggle" onClick={onShowAnalysis}>
          analysis
        </button>
      </header>
      <ul className="case-index-list">
        {records.map((r) => {
          const plotted = isPlottable(r);
          // Unplotted rows emit no hover — there is no globe point to emphasize.
          const hoverIn = plotted ? () => onHover({ id: r.id, source: "list" }) : undefined;
          const hoverOut = plotted ? () => onHover(null) : undefined;
          return (
            <li
              key={r.id}
              ref={(el) => {
                if (el) rowRefs.current.set(r.id, el);
                else rowRefs.current.delete(r.id);
              }}
            >
              <button
                type="button"
                className={rowClass(r, selectedId, hover)}
                onClick={() => onSelect(r.id)}
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
                onFocus={hoverIn}
                onBlur={hoverOut}
              >
                <span className="case-row-primary">
                  <span className="case-row-location">{r.locationRaw || "location unknown"}</span>
                  <span className="case-row-date">{r.incidentDate ?? "undated"}</span>
                </span>
                <span className="case-row-meta">
                  <span className="case-row-class">
                    {r.sourceAgency} · {r.objectClass}
                  </span>
                  {!plotted && <span className="case-row-tag">not on globe</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
