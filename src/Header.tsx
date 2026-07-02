// Persistent header (TICKETS.md T3): title + one-line "what this is" so a cold
// visitor orients immediately. "UAP·ATLAS" styles the internal working title —
// the public brand is undecided (CLAUDE.md); swap the string when it lands.

import { RECORDS, RELEASE_COUNT } from "./data";

interface HeaderProps {
  onOpenAbout: () => void;
}

export function Header({ onOpenAbout }: HeaderProps) {
  return (
    <header className="app-header">
      <span className="header-live" aria-hidden="true" />
      <span className="app-header-title">uap·atlas</span>
      <span className="header-divider" aria-hidden="true" />
      <span className="app-header-tagline">
        an independent atlas of the U.S. government&apos;s declassified UAP records
      </span>
      <span className="app-header-count">
        {RECORDS.length} cases · {String(RELEASE_COUNT).padStart(2, "0")} releases
      </span>
      <button type="button" className="header-about" onClick={onOpenAbout}>
        about
      </button>
    </header>
  );
}
