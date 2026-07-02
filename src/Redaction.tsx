import { useMemo } from "react";
import type { UAPRecord } from "../schema";
import { PanelSwitch } from "./PanelSwitch";

// Redaction analysis (Phase 4): who redacts hardest, and how redaction shifts
// across tranches. One measure (mean % of page area redacted) across categories,
// so the marks are a single hue — amber, the reserved redaction color. Identity
// and values live in text tokens; amber appears only in the bars and the % values
// (the drawer's existing redaction convention). Bars share a fixed 0-100% domain
// so widths are comparable across sections; every row is directly labeled.

interface RedactionProps {
  records: UAPRecord[]; // the PURSUE corpus (basemap records carry no estimates)
  onShowCases: () => void;
}

interface Group {
  key: string;
  mean: number;
  count: number;
}

function groupMeans(records: UAPRecord[], keyOf: (r: UAPRecord) => string): Group[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const r of records) {
    if (r.redactionPct === null) continue;
    const key = keyOf(r);
    const s = sums.get(key) ?? { total: 0, count: 0 };
    s.total += r.redactionPct;
    s.count++;
    sums.set(key, s);
  }
  return [...sums]
    .map(([key, s]) => ({ key, mean: s.total / s.count, count: s.count }))
    .sort((a, b) => b.mean - a.mean);
}

function BarRow({ group }: { group: Group }) {
  const pct = Math.round(group.mean);
  return (
    <li className="redaction-row">
      <span className="redaction-row-label">{group.key}</span>
      <span
        className="redaction-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${group.key}: mean redaction ${pct}%, ${group.count} documents`}
      >
        <span className="redaction-bar" style={{ width: `${pct}%` }} />
      </span>
      <span className="redaction-row-value">
        <span className="redaction-pct">{pct}%</span>
        <span className="redaction-n">n={group.count}</span>
      </span>
    </li>
  );
}

export function Redaction({ records, onShowCases }: RedactionProps) {
  const { byAgency, byRelease, overall, estimated, unestimated } = useMemo(() => {
    const withPct = records.filter((r) => r.redactionPct !== null);
    const total = withPct.reduce((s, r) => s + (r.redactionPct ?? 0), 0);
    return {
      byAgency: groupMeans(records, (r) => r.sourceAgency),
      byRelease: groupMeans(records, (r) => `release ${r.release}`),
      overall: withPct.length > 0 ? total / withPct.length : 0,
      estimated: withPct.length,
      unestimated: records.length - withPct.length,
    };
  }, [records]);

  return (
    <section className="case-index" aria-label="Redaction analysis">
      <header className="case-index-header">
        <span className="mono-label">redaction</span>
        <PanelSwitch active="analysis" onSwitch={(v) => v === "cases" && onShowCases()} />
      </header>
      <div className="redaction-body">
        <div className="redaction-hero">
          {/* "0%" with no data would read as "no redaction" — an em dash is honest */}
          <span className="redaction-hero-value">
            {estimated > 0 ? `${Math.round(overall)}%` : "—"}
          </span>
          <span className="redaction-hero-caption">
            mean page area redacted · {estimated} documents estimated
          </span>
        </div>

        <span className="mono-label redaction-section">by agency</span>
        <ul className="redaction-list">
          {byAgency.map((g) => (
            <BarRow key={g.key} group={g} />
          ))}
        </ul>

        <span className="mono-label redaction-section">by release</span>
        <ul className="redaction-list">
          {byRelease.map((g) => (
            <BarRow key={g.key} group={g} />
          ))}
        </ul>

        <p className="redaction-note">
          Model-estimated share of page area under redaction bars, first pages of each document.
          Bars share a fixed 0–100% scale.
          {unestimated > 0 ? ` ${unestimated} records have no estimate and are excluded.` : ""}
        </p>
      </div>
    </section>
  );
}
