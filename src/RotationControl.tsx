// Explicit globe-rotation toggle (TICKETS.md T6). Deliberately NOT in the
// timeline bar and not styled like its "play" control — that button drives
// temporal playback; this one drives spin. The label says "rotation" so the
// two can't be confused. The toggle records user intent: auto-pauses (drag,
// open case file) never flip it.

interface RotationControlProps {
  on: boolean;
  onToggle: () => void;
}

export function RotationControl({ on, onToggle }: RotationControlProps) {
  return (
    <button
      type="button"
      className={on ? "rotation-control rotation-control-on" : "rotation-control"}
      onClick={onToggle}
      aria-pressed={on}
      aria-label="Toggle globe auto-rotation"
    >
      <span aria-hidden="true">{on ? "↻" : "⊘"}</span> rotation {on ? "on" : "off"}
    </button>
  );
}
