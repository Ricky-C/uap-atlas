import type { UAPRecord } from "../schema";

// The side index: every case that can't honestly be plotted (geoPrecision
// "unknown") lives here instead of being faked onto the globe (DESIGN.md).
// Until the portal-index geocoding pass lands, that's the whole corpus.

interface CaseIndexProps {
  records: UAPRecord[]; // unplotted records
  plottedCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CaseIndex({ records, plottedCount, selectedId, onSelect }: CaseIndexProps) {
  return (
    <section className="case-index" aria-label="Case index">
      <header className="case-index-header">
        <span className="mono-label">case index</span>
        <span className="case-index-count">
          {records.length} unplotted · {plottedCount} on globe
        </span>
      </header>
      <ul className="case-index-list">
        {records.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={r.id === selectedId ? "case-row case-row-active" : "case-row"}
              onClick={() => onSelect(r.id)}
            >
              <span className="case-row-id">
                {r.sourceAgency} · {r.docType}
              </span>
              <span className="case-row-meta">
                <span className="case-row-class">{r.objectClass}</span>
                <span className="case-row-release">rel {r.release || "—"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
