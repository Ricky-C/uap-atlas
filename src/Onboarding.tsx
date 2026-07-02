import { useMemo } from "react";
import { RECORDS, isPlottable } from "./data";

// First-load orientation card (TICKETS.md T3): what the globe shows, where the
// data comes from, and the neutrality stance — dismissible, and the dismissal
// persists (App owns the localStorage flag). Counts are live so the copy stays
// current as new tranches land.

interface OnboardingProps {
  onDismiss: () => void;
}

export function Onboarding({ onDismiss }: OnboardingProps) {
  const { total, plottable, releases } = useMemo(
    () => ({
      total: RECORDS.length,
      plottable: RECORDS.filter(isPlottable).length,
      releases: new Set(RECORDS.map((r) => r.release)).size,
    }),
    [],
  );

  return (
    <section className="onboarding" aria-label="About this map">
      <span className="mono-label">what you&apos;re looking at</span>
      <p className="onboarding-body">
        {total} records from the U.S. government&apos;s PURSUE UAP declassification releases (
        {releases} {releases === 1 ? "release" : "releases"} so far), plotted where the documents
        place them — {plottable} have a usable location. Mark size and softness show how precise
        that location really is; see the legend. Cases with no honest location live in the case
        index only.
      </p>
      <p className="onboarding-body">
        Summaries are neutral digests of public-domain records. This is an independent project —
        not affiliated with any government agency — and it presents the records without asserting
        what the phenomena were.
      </p>
      <button type="button" className="panel-toggle" onClick={onDismiss}>
        got it
      </button>
    </section>
  );
}
