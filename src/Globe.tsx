import type { UAPRecord } from "../schema";

// Phase 0 placeholder. Phase 1 replaces this with react-globe.gl + the NASA Black
// Marble texture, plotting one point per record shaped by geoPrecision.
export function Globe({ records }: { records: UAPRecord[] }) {
  return (
    <section style={{ color: "var(--text-muted)" }}>
      globe placeholder — {records.length} records
    </section>
  );
}
