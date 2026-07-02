import { useMemo, useState } from "react";
import { legendTiers, readPrecisionTheme } from "./precision";
import { tokenNumber } from "./theme";

// The encoding legend (TICKETS.md T1): decodes every mark on the globe. It
// shares the right column with the drawer — full panel when nothing is
// selected, a small toggle when a case file is open.
//
// Swatch colors and proportions come from the SAME precision→style map the
// globe draws with (precision.ts), read via token() — inline styles here are
// token-derived, the sanctioned Globe pattern, not hardcoded values.

interface LegendProps {
  collapsed: boolean; // true while the drawer occupies the column
}

export function Legend({ collapsed }: LegendProps) {
  // Expanding while collapsed is a temporary peek; reset when the drawer
  // closes (adjust-state-during-render pattern — no effect, no extra pass).
  const [peek, setPeek] = useState(false);
  const [prevCollapsed, setPrevCollapsed] = useState(collapsed);
  if (prevCollapsed !== collapsed) {
    setPrevCollapsed(collapsed);
    if (!collapsed) setPeek(false);
  }

  const { tiers, swatchUnit, swatchMax } = useMemo(() => {
    const theme = readPrecisionTheme();
    return {
      tiers: legendTiers(theme),
      swatchUnit: tokenNumber("--legend-swatch-unit", 9),
      swatchMax: tokenNumber("--legend-swatch-max", 24),
    };
  }, []);

  const open = !collapsed || peek;

  if (!open) {
    return (
      <button
        type="button"
        className="panel-toggle legend-toggle"
        onClick={() => setPeek(true)}
        aria-expanded={false}
      >
        legend
      </button>
    );
  }

  return (
    <section className="legend" aria-label="Map legend">
      <header className="legend-header">
        <span className="mono-label">legend</span>
        {collapsed && (
          <button
            type="button"
            className="panel-toggle"
            onClick={() => setPeek(false)}
            aria-expanded={true}
          >
            hide
          </button>
        )}
      </header>

      <ul className="legend-list">
        {tiers.map((tier) => {
          // Round every number that reaches the UI (golden rule 7).
          const px =
            tier.radius === null ? null : Math.round(Math.min(tier.radius * swatchUnit, swatchMax));
          return (
            <li key={tier.key} className="legend-row">
              <span className="legend-swatch-cell" aria-hidden="true">
                {px !== null && tier.color !== null ? (
                  <span
                    className="legend-swatch"
                    style={{ width: px, height: px, background: tier.color }}
                  />
                ) : (
                  <span className="legend-swatch-none">—</span>
                )}
              </span>
              <span className="legend-tier-label">{tier.label}</span>
              <span className="legend-tier-note">{tier.note}</span>
            </li>
          );
        })}
      </ul>

      <div className="legend-colors">
        <span className="mono-label">color</span>
        <ul className="legend-list">
          <li className="legend-row">
            <span className="legend-swatch-cell" aria-hidden="true">
              <span className="legend-swatch legend-swatch-signal" />
            </span>
            <span className="legend-tier-label">green</span>
            <span className="legend-tier-note">a case — active, hovered, or selected</span>
          </li>
          <li className="legend-row">
            <span className="legend-swatch-cell" aria-hidden="true">
              <span className="legend-swatch legend-swatch-alert" />
            </span>
            <span className="legend-tier-label">amber</span>
            <span className="legend-tier-note">unresolved status · redaction</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
