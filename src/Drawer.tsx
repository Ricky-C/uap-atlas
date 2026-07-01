import type { UAPRecord } from "../schema";
import { incidentYear } from "./data";

// The case-file drawer: an opened classified file on a dark instrument screen
// (DESIGN.md). Monospace header, amber status pill, neutral off-white summary,
// mono metadata grid. Every missing field renders a placeholder, never a crash.

interface DrawerProps {
  record: UAPRecord | null;
  onClose: () => void;
}

const DASH = "—";

function formatDate(r: UAPRecord): string {
  if (r.incidentDate) return r.incidentDate;
  return incidentYear(r) !== null ? String(incidentYear(r)) : "undated";
}

function formatCoords(r: UAPRecord): string {
  if (r.lat === null || r.lon === null) return DASH;
  // Golden rule 7: round everything that reaches the UI.
  return `${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`;
}

function isHttpUrl(u: string): boolean {
  return u.startsWith("https://") || u.startsWith("http://");
}

export function Drawer({ record, onClose }: DrawerProps) {
  if (!record) return null;
  const r = record;

  return (
    <aside className="drawer" aria-label="Case file">
      <header className="drawer-header">
        <div className="drawer-title">
          <span className="mono-label">
            {r.sourceAgency} · {r.docType}
          </span>
          <span className="drawer-case-id">#{r.id}</span>
        </div>
        <div className="drawer-header-actions">
          {!r.resolved && <span className="status-pill">unresolved</span>}
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close case file">
            ✕
          </button>
        </div>
      </header>

      {r.media.docImage !== undefined && (
        // Real scans arrive with the media asset pipeline; the source files sit
        // in gitignored data/raw/ and aren't web-served yet.
        <div className="doc-scan-placeholder">
          <span className="mono-label">document scan · pending asset pipeline</span>
        </div>
      )}

      <p className="drawer-summary">{r.summary || "No summary available for this record."}</p>

      <dl className="meta-grid">
        <dt>incident date</dt>
        <dd>{formatDate(r)}</dd>
        <dt>location</dt>
        <dd>{r.locationRaw || DASH}</dd>
        <dt>coordinates</dt>
        <dd>{formatCoords(r)}</dd>
        <dt>geo precision</dt>
        <dd className="meta-signal">{r.geoPrecision}</dd>
        <dt>object class</dt>
        <dd>{r.objectClass}</dd>
        <dt>redaction</dt>
        <dd className="meta-alert">
          {r.redactionPct === null ? DASH : `${Math.round(r.redactionPct)}%`}
        </dd>
        <dt>release</dt>
        <dd>{r.release || DASH}</dd>
        <dt>source</dt>
        <dd>
          {isHttpUrl(r.sourceUrl) ? (
            <a className="meta-signal" href={r.sourceUrl} target="_blank" rel="noreferrer">
              government record ↗
            </a>
          ) : (
            DASH
          )}
        </dd>
      </dl>
    </aside>
  );
}
