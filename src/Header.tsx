// Persistent header (TICKETS.md T3): title + one-line "what this is" so a cold
// visitor orients immediately. "uap-atlas" is the internal working title — the
// public brand is undecided (CLAUDE.md); swap the string when it lands.

interface HeaderProps {
  onOpenAbout: () => void;
}

export function Header({ onOpenAbout }: HeaderProps) {
  return (
    <header className="app-header">
      <span className="app-header-title mono-label">uap-atlas</span>
      <span className="app-header-tagline">
        an independent atlas of the U.S. government&apos;s declassified UAP records
      </span>
      <button type="button" className="panel-toggle" onClick={onOpenAbout}>
        about
      </button>
    </header>
  );
}
