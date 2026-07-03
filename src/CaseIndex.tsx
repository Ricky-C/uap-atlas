import { useEffect, useMemo, useRef, useState } from "react";
import type { UAPRecord } from "../schema";
import {
  EMPTY_FILTERS,
  facetCounts,
  filtersActive,
  incidentYear,
  isLunar,
  isPlottable,
  type IndexFilters,
  type MediaKind,
} from "./data";
import { prefersReducedMotion } from "./theme";
import { PanelSwitch } from "./PanelSwitch";
import type { HoverState } from "./selection";

// The case index: the FULL corpus, plotted and unplotted alike (TICKETS.md T2).
// Rows lead with what tells cases apart — location and incident date — and
// fall back honestly ("location unknown", "undated") rather than leaving gaps.
// Cases that can't honestly be plotted (geoPrecision "unknown") are tagged
// "not on globe" instead of being faked onto it (DESIGN.md).
//
// Structure (user-feedback rounds 1+2): faceted quick filters + search narrow
// the list; decade groups under sticky, collapsible headers shape what's left.
// Unfiltered, the panel opens as an overview — newest decade expanded, the
// rest folded into a table of contents; any active filter expands everything
// that matches. Undated cases keep their own group at the end.

interface CaseIndexProps {
  records: UAPRecord[]; // year- AND filter-narrowed, index-sorted
  totalRecords: UAPRecord[]; // year-narrowed only — the filterable universe
  filters: IndexFilters;
  onFiltersChange: (f: IndexFilters) => void;
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

// The unfiltered overview: newest decade open, every other group folded.
function defaultCollapsed(groups: DecadeGroup[]): ReadonlySet<string> {
  return new Set(groups.slice(1).map((g) => g.key));
}

// The artifact-kind facet's one-tap chips. "all" clears the facet.
const KIND_CHIPS: { label: string; kind: MediaKind | null }[] = [
  { label: "all", kind: null },
  { label: "video", kind: "video" },
  { label: "report", kind: "report" },
  { label: "photo", kind: "photo" },
];

// Facet <select> options: sorted by how much they'd show, ties alphabetical.
// The active selection stays listed even at zero so the control never strands.
function facetOptions(counts: Map<string, number>, selected: string | null): [string, number][] {
  const entries = [...counts.entries()];
  if (selected !== null && !counts.has(selected)) entries.push([selected, 0]);
  return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function CaseIndex({
  records,
  totalRecords,
  filters,
  onFiltersChange,
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
  const groups = useMemo(() => groupByDecade(records), [records]);
  const active = filtersActive(filters);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    active ? new Set() : defaultCollapsed(groups),
  );

  // Any reshape of the visible groups re-derives the fold state
  // (adjust-state-during-render, the Legend peek pattern): activating a
  // filter shows every match expanded; clearing restores the overview; a
  // timeline scrub or facet change that alters the decade set resets to the
  // mode's default so a stale key can never leave the newest decade folded.
  // Manual folds survive anything that keeps the same groups.
  const groupsSignature = groups.map((g) => g.key).join("|");
  const [prevSignature, setPrevSignature] = useState(groupsSignature);
  const [prevActive, setPrevActive] = useState(active);
  if (prevSignature !== groupsSignature || prevActive !== active) {
    setPrevSignature(groupsSignature);
    setPrevActive(active);
    setCollapsed(active ? new Set() : defaultCollapsed(groups));
  }

  const agencyOptions = useMemo(
    () => facetOptions(facetCounts(totalRecords, filters, "agency"), filters.agency),
    [totalRecords, filters],
  );
  const classOptions = useMemo(
    () => facetOptions(facetCounts(totalRecords, filters, "objectClass"), filters.objectClass),
    [totalRecords, filters],
  );

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
  // the pointer across points. A row inside a collapsed group (or filtered
  // out) isn't rendered, so the lookup no-ops — hover never yanks groups open.
  useEffect(() => {
    if (hover?.source !== "globe") return;
    scrollToRow(hover.id);
  }, [hover]);

  // Selecting from the globe likewise reveals the row — the list mirrors the
  // fly-to (T7): both sides center on the same case, expanding its decade if
  // the user had folded it away. A case the filters exclude stays unlisted
  // (its file still opens in the drawer); filters are never changed silently.
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

  const clearFilters = () => onFiltersChange(EMPTY_FILTERS);

  return (
    <section className="case-index" aria-label="Case index">
      <header className="case-index-header">
        <span className="mono-label">case index</span>
        <PanelSwitch active="cases" onSwitch={(v) => v === "analysis" && onShowAnalysis()} />
      </header>

      <div className="index-controls">
        <input
          type="search"
          className="index-search"
          value={filters.query}
          onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
          placeholder="search location, agency, class…"
          aria-label="Search cases"
        />
        <div className="index-filter-row">
          <select
            className="index-filter"
            aria-label="Filter by agency"
            value={filters.agency ?? ""}
            onChange={(e) =>
              onFiltersChange({ ...filters, agency: e.target.value === "" ? null : e.target.value })
            }
          >
            <option value="">agency · all</option>
            {agencyOptions.map(([k, n]) => (
              <option key={k} value={k}>
                {k} ({n})
              </option>
            ))}
          </select>
          <select
            className="index-filter"
            aria-label="Filter by object class"
            value={filters.objectClass ?? ""}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                objectClass: e.target.value === "" ? null : e.target.value,
              })
            }
          >
            <option value="">class · all</option>
            {classOptions.map(([k, n]) => (
              <option key={k} value={k}>
                {k} ({n})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="index-filter-toggle"
            aria-pressed={filters.onGlobeOnly}
            onClick={() => onFiltersChange({ ...filters, onGlobeOnly: !filters.onGlobeOnly })}
          >
            on globe
          </button>
        </div>
        {/* artifact-kind facet — the marquee filter, one tap always visible */}
        <div
          className="panel-switch index-kind-row"
          role="group"
          aria-label="Filter by record type"
        >
          {KIND_CHIPS.map((c) => {
            const active = filters.mediaKind === c.kind;
            return (
              <button
                key={c.label}
                type="button"
                className={
                  active ? "panel-switch-chip panel-switch-chip-active" : "panel-switch-chip"
                }
                aria-pressed={active}
                onClick={() => {
                  if (!active) onFiltersChange({ ...filters, mediaKind: c.kind });
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* the live announcement is its own hidden status node — wrapping the
          interactive clear button in an aria-live region would re-announce
          the whole row on every keystroke */}
      <span className="visually-hidden" role="status">
        {active ? `${records.length} of ${totalRecords.length} cases match` : ""}
      </span>
      <div className="case-index-count">
        {active ? (
          <>
            <span>
              {records.length} of {totalRecords.length} match
            </span>
            <button type="button" className="index-clear" onClick={clearFilters}>
              clear
            </button>
          </>
        ) : (
          <span>
            {plottedCount} on globe{lunarCount > 0 ? ` · ${lunarCount} lunar` : ""} ·{" "}
            {unplottedCount} unplotted
          </span>
        )}
      </div>

      {records.length === 0 ? (
        <p className="index-empty">
          no cases match —{" "}
          <button type="button" className="index-clear" onClick={clearFilters}>
            clear filters
          </button>
        </p>
      ) : (
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
                              <span className="case-row-tags">
                                {(r.media.videos?.length ?? 0) > 0 && (
                                  <span className="case-row-tag">▶ video</span>
                                )}
                                {lunar && <span className="case-row-tag">lunar</span>}
                                {!plotted && !lunar && (
                                  <span className="case-row-tag">not on globe</span>
                                )}
                              </span>
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
      )}
    </section>
  );
}
