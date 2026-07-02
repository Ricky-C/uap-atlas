import { useEffect, useMemo, useRef, useState } from "react";
import type { UAPRecord } from "../schema";
import { incidentYear, isLunar, isPlottable } from "./data";
import { prefersReducedMotion } from "./theme";
import { PanelSwitch } from "./PanelSwitch";
import type { HoverState } from "./selection";

// The case index: the FULL corpus, plotted and unplotted alike (TICKETS.md T2).
// Rows lead with what tells cases apart — location and incident date — and
// fall back honestly ("location unknown", "undated") rather than leaving gaps.
// Cases that can't honestly be plotted (geoPrecision "unknown") are tagged
// "not on globe" instead of being faked onto it (DESIGN.md).
//
// The list is grouped by decade under sticky, collapsible headers — 199 rows
// as one flat scroll was a wall; the decades give it the same temporal shape
// the timeline already teaches. Undated cases keep their own group at the end.

interface CaseIndexProps {
  records: UAPRecord[]; // year-filtered, index-sorted corpus
  plottedCount: number;
  lunarCount: number;
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

function decadeKey(r: UAPRecord): string {
  const y = incidentYear(r);
  return y === null ? "undated" : `${Math.floor(y / 10) * 10}s`;
}

interface DecadeGroup {
  key: string;
  records: UAPRecord[];
}

// records arrive sorted (dated newest-first, undated last), so one sequential
// pass yields groups already in display order — no re-sort. The adjacent-only
// check assumes that sort AND schema-valid incidentDate strings; if either
// loosens, a decade could split into duplicate groups here.
function groupByDecade(records: UAPRecord[]): DecadeGroup[] {
  const groups: DecadeGroup[] = [];
  for (const r of records) {
    const key = decadeKey(r);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.records.push(r);
    else groups.push({ key, records: [r] });
  }
  return groups;
}

export function CaseIndex({
  records,
  plottedCount,
  lunarCount,
  unplottedCount,
  selectedId,
  hover,
  onSelect,
  onHover,
  onShowAnalysis,
}: CaseIndexProps) {
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => groupByDecade(records), [records]);

  // Refs mirror props/state the selection effect needs without re-running on
  // every scrub or collapse toggle (its only trigger is the selection itself).
  // Synced in an effect declared FIRST, so same-commit consumers read fresh.
  const recordsRef = useRef(records);
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    recordsRef.current = records;
    collapsedRef.current = collapsed;
  });
  // A selection whose group was collapsed scrolls after the expansion render.
  const pendingScrollId = useRef<string | null>(null);

  const scrollToRow = (id: string) => {
    rowRefs.current.get(id)?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  // Hovering a globe point brings its row into view. "nearest" keeps the list
  // still when the row is already visible — no scroll thrash while sweeping
  // the pointer across points. A row inside a collapsed group isn't rendered,
  // so the lookup no-ops — hover never yanks groups open.
  useEffect(() => {
    if (hover?.source !== "globe") return;
    scrollToRow(hover.id);
  }, [hover]);

  // Selecting from the globe likewise reveals the row — the list mirrors the
  // fly-to (T7): both sides center on the same case, expanding its decade if
  // the user had folded it away.
  useEffect(() => {
    // Every new selection (or deselection) invalidates any in-flight deferred
    // scroll — otherwise an earlier expansion could yank the list back to a
    // case that is no longer the selected one.
    pendingScrollId.current = null;
    if (selectedId === null) return;
    const rec = recordsRef.current.find((r) => r.id === selectedId);
    const key = rec === undefined ? null : decadeKey(rec);
    if (key !== null && collapsedRef.current.has(key)) {
      pendingScrollId.current = selectedId;
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return; // the row doesn't exist yet — scroll after the expansion render
    }
    scrollToRow(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (pendingScrollId.current === null) return;
    scrollToRow(pendingScrollId.current);
    pendingScrollId.current = null;
  }, [collapsed]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="case-index" aria-label="Case index">
      <header className="case-index-header">
        <span className="mono-label">case index</span>
        <PanelSwitch active="cases" onSwitch={(v) => v === "analysis" && onShowAnalysis()} />
      </header>
      <div className="case-index-count">
        {plottedCount} on globe{lunarCount > 0 ? ` · ${lunarCount} lunar` : ""} · {unplottedCount}{" "}
        unplotted
      </div>
      <ul className="case-index-list">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          return (
            <li key={g.key} className="index-group">
              <button
                type="button"
                className="mono-label index-group-header"
                aria-expanded={!isCollapsed}
                aria-label={`${g.key}, ${g.records.length} cases`}
                onClick={() => toggleGroup(g.key)}
              >
                <span className="index-group-caret" aria-hidden="true">
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span className="index-group-label">{g.key}</span>
                <span className="index-group-count">{g.records.length}</span>
              </button>
              {!isCollapsed && (
                <ul className="index-group-list">
                  {g.records.map((r) => {
                    const plotted = isPlottable(r);
                    const lunar = !plotted && isLunar(r);
                    // Rows with a mark on the globe (Earth point or moon marker)
                    // emit hover; truly unplotted rows have nothing to emphasize.
                    const hoverIn =
                      plotted || lunar ? () => onHover({ id: r.id, source: "list" }) : undefined;
                    const hoverOut = plotted || lunar ? () => onHover(null) : undefined;
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
                            <span className="case-row-location">
                              {r.locationRaw || "location unknown"}
                            </span>
                            <span className="case-row-date">{r.incidentDate ?? "undated"}</span>
                          </span>
                          <span className="case-row-meta">
                            <span className="case-row-class">
                              {r.sourceAgency} · {r.objectClass}
                            </span>
                            {lunar && <span className="case-row-tag">lunar</span>}
                            {!plotted && !lunar && (
                              <span className="case-row-tag">not on globe</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
