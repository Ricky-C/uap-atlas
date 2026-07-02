// The left panel's segmented view switch: INDEX ↔ ANALYSIS. The active chip
// wears signal green with dark ink (--text-on-signal) — the one place text
// sits ON green, sanctioned because it's a control state, not body copy.

interface PanelSwitchProps {
  active: "cases" | "analysis";
  onSwitch: (view: "cases" | "analysis") => void;
}

const VIEWS = [
  { key: "cases", label: "index" },
  { key: "analysis", label: "analysis" },
] as const;

export function PanelSwitch({ active, onSwitch }: PanelSwitchProps) {
  return (
    <div className="panel-switch" role="group" aria-label="Panel view">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          className={
            v.key === active ? "panel-switch-chip panel-switch-chip-active" : "panel-switch-chip"
          }
          aria-pressed={v.key === active}
          onClick={() => {
            if (v.key !== active) onSwitch(v.key);
          }}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
