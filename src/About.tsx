import { useEffect, useMemo, useRef } from "react";
import { RECORDS, isPlottable } from "./data";

// About / methodology modal (TICKETS.md T3): the credibility layer — source,
// what "unresolved" means, independence, neutral framing, and how enrichment
// and geocoding work. Opened from the header; Esc or backdrop closes it.

interface AboutProps {
  onClose: () => void;
}

const PURSUE_URL = "https://www.war.gov/ufo";

export function About({ onClose }: AboutProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Move focus into the dialog; trap Tab inside it; restore focus on close.
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  const { total, plottable, releases } = useMemo(
    () => ({
      total: RECORDS.length,
      plottable: RECORDS.filter(isPlottable).length,
      releases: new Set(RECORDS.map((r) => r.release)).size,
    }),
    [],
  );

  return (
    <div
      className="about-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="about"
        role="dialog"
        aria-modal="true"
        aria-label="About this project"
        tabIndex={-1}
      >
        <header className="about-header">
          <span className="mono-label">about / methodology</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close about panel">
            ✕
          </button>
        </header>

        <div className="about-body">
          <h2 className="about-section">the data</h2>
          <p>
            Every record here comes from the U.S. government&apos;s PURSUE UAP declassification
            releases, published at{" "}
            <a className="meta-signal" href={PURSUE_URL} target="_blank" rel="noreferrer">
              war.gov/ufo ↗
            </a>
            . The documents are public domain, and the government explicitly invites private
            analysis of them. Currently: {total} records across {releases}{" "}
            {releases === 1 ? "release" : "releases"}, {plottable} with a plottable location. The
            historical basemap layer is Project Blue Book (USAF, 1947–1969).
          </p>

          <h2 className="about-section">what &quot;unresolved&quot; means</h2>
          <p>
            &quot;Unresolved&quot; is the government&apos;s own status for a record — the source
            agency did not close the case with an explanation. It is not this project&apos;s
            judgment, and it does not imply anything about what the phenomenon was.
          </p>

          <h2 className="about-section">independence</h2>
          <p>
            This is an independent public-records explorer. It is not affiliated with, endorsed
            by, or connected to any government agency.
          </p>

          <h2 className="about-section">neutral framing</h2>
          <p>
            The records are presented, not interpreted. Summaries are factual digests of what each
            document says; nothing here claims the phenomena are extraterrestrial or asserts an
            explanation. Uncertainty is rendered honestly — a case whose location is only known to
            a region is drawn as a soft regional mark, never a crisp pinpoint.
          </p>

          <h2 className="about-section">how enrichment &amp; geocoding work</h2>
          <p>
            A build-time pass reads each released document and extracts a neutral summary, an
            object classification, and an estimate of how much of the page is redacted. Locations
            come from a hand-curated lookup table keyed to the text of the release, each tagged
            with a precision tier (point, city, region, theater, or unknown). Redactions are left
            alone: identities and facility locations the government withheld are never recovered,
            cross-referenced, or inferred.
          </p>
        </div>
      </div>
    </div>
  );
}
