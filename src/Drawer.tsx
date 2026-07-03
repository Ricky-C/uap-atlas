import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UAPRecord } from "../schema";
import { incidentYear, isBasemap, skepticCandidates, SKEPTIC_SOURCE } from "./data";

// The case-file drawer: an opened classified file on a dark instrument screen
// (DESIGN.md). Monospace header, amber status pill, neutral off-white summary,
// mono metadata grid. Every missing field renders a placeholder, never a crash.

interface DrawerProps {
  record: UAPRecord | null;
  onClose: () => void;
}

const DASH = "—";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// Humanize the ISO incident date at its source precision: "1947-08-04" →
// "Aug 4, 1947"; "2008-07" → "Jul 2008"; "1948" stays "1948". Anything that
// doesn't parse falls back to the raw string — display-only, never a crash.
function formatDate(r: UAPRecord): string {
  const d = r.incidentDate;
  if (!d) return incidentYear(r) !== null ? String(incidentYear(r)) : "undated";
  const [y, m, day] = d.split("-");
  const month = m !== undefined ? MONTHS[Number(m) - 1] : undefined;
  if (!month) return y ?? d;
  return day !== undefined ? `${month} ${Number(day)}, ${y}` : `${month} ${y}`;
}

function formatCoords(r: UAPRecord): string {
  if (r.lat === null || r.lon === null) return DASH;
  // Golden rule 7: round everything that reaches the UI.
  return `${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`;
}

function isHttpUrl(u: string): boolean {
  return u.startsWith("https://") || u.startsWith("http://");
}

// Video records' official home is DVIDS (DoD's distribution service) — the
// source link label says what the reader will get.
function isDvidsUrl(u: string): boolean {
  return u.startsWith("https://www.dvidshub.net/");
}

// A record's released videos, embedded from the official DVIDS player — but
// only after a tap: the facade keeps third-party requests out of a mere
// drawer-open (the standard embed privacy/performance pattern). The atlas
// never hosts video bytes.
//
// One component coordinates ALL of a record's videos so exactly one THEATER
// (the portaled center-screen lightbox — the drawer's backdrop-filter would
// otherwise clip a fixed descendant, same as DocScan's lightbox) can be open
// at a time: some records carry 2–3 videos, and independent modals could
// stack, with a single Escape closing all of them at once. Closing the
// theater returns that video inline to the drawer slot it came from, with an
// enlarge control to re-open. Keyed by record id at the call site, so
// switching case files resets everything to facades. Browser constraint,
// accepted: an iframe that moves between the theater and the panel remounts,
// so playback restarts on close.
function VideoList({ ids }: { ids: string[] }) {
  const [theater, setTheater] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const lightboxRef = useRef<HTMLDivElement>(null);
  const enlargeRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastTheater = useRef<string | null>(null);

  const openTheater = (id: string) => {
    setLoaded((prev) => new Set(prev).add(id));
    setTheater(id);
  };

  useEffect(() => {
    if (theater === null) return;
    lightboxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTheater(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theater]);

  // Closing the theater lands focus on that video's inline enlarge control —
  // the facade that originally held focus is gone by then.
  useEffect(() => {
    if (theater !== null) {
      lastTheater.current = theater;
      return;
    }
    if (lastTheater.current !== null) {
      enlargeRefs.current.get(lastTheater.current)?.focus();
      lastTheater.current = null;
    }
  }, [theater]);

  const player = (id: string) => (
    <iframe
      className="video-frame"
      src={`https://www.dvidshub.net/video/embed/${encodeURIComponent(id)}`}
      title={`Released video ${id} — official DVIDS player`}
      // Least privilege for the app's one cross-origin embed. No popups /
      // top-navigation: the meta grid's source link is the way out.
      sandbox="allow-scripts allow-same-origin allow-presentation"
      allowFullScreen
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  );

  return (
    <>
      {ids.map((id) => {
        if (theater === id) {
          // Hold the drawer slot while the theater is open — no layout jump,
          // and the panel says where the video went.
          return (
            <div key={id} className="video-embed">
              <div className="video-facade video-facade-placeholder">
                <span className="mono-label">playing in theater view</span>
              </div>
            </div>
          );
        }
        if (loaded.has(id)) {
          return (
            <div key={id} className="video-embed">
              {/* the iframe swallows pointer events, so the theater re-entry
                  affordance rides ON the frame — always visible over footage —
                  plus a labeled action in the caption row. The redundancy is
                  intentional (icon-first affordance + textual fallback); the
                  caption button is the canonical focus-return target. */}
              <div className="video-frame-wrap">
                {player(id)}
                <button
                  type="button"
                  className="video-theater-btn"
                  onClick={() => openTheater(id)}
                  aria-label="Reopen in theater view"
                >
                  <span aria-hidden="true">⤢</span>
                </button>
              </div>
              <div className="video-embed-actions">
                <span className="mono-label video-embed-caption">
                  official dvids player · public domain
                </span>
                <button
                  ref={(el) => {
                    if (el) enlargeRefs.current.set(id, el);
                    else enlargeRefs.current.delete(id);
                  }}
                  type="button"
                  className="index-clear"
                  onClick={() => openTheater(id)}
                >
                  theater ⤢
                </button>
              </div>
            </div>
          );
        }
        return (
          <div key={id} className="video-embed">
            <button
              type="button"
              className="video-facade"
              onClick={() => openTheater(id)}
              aria-label={`Play released video ${id} in the official player`}
            >
              <span className="video-facade-glyph" aria-hidden="true">
                ▶
              </span>
              <span className="mono-label">released video · play</span>
            </button>
          </div>
        );
      })}
      {theater !== null &&
        createPortal(
          <div
            ref={lightboxRef}
            className="video-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`Released video ${theater} — theater view`}
            tabIndex={-1}
            onClick={(e) => {
              if (e.target === e.currentTarget) setTheater(null);
            }}
          >
            <div className="video-lightbox-body">
              {player(theater)}
              <div className="video-lightbox-bar">
                <span className="mono-label">released video · official dvids player</span>
                <button
                  type="button"
                  className="drawer-close"
                  onClick={() => setTheater(null)}
                  aria-label="Close the theater and return the video to the case file"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// The document scan / rendering preview. Assets are generated by `pnpm media` into
// public/media/<id>.jpg (the id is the source-file content hash); a missing asset
// falls back to the placeholder block — fail soft, never a broken image.
// Clicking the scan opens it full-size in a lightbox (Esc or click closes).
function DocScan({ record }: { record: UAPRecord }) {
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = record.media.rendering !== undefined ? "digital rendering" : "document scan";

  useEffect(() => {
    if (!enlarged) return;
    // Focus follows the dialog in, and returns to the enlarge button on close.
    const trigger = triggerRef.current;
    lightboxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEnlarged(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [enlarged]);

  if (record.media.docImage === undefined && record.media.rendering === undefined) return null;

  if (failed) {
    return (
      <div className="doc-scan-placeholder">
        <span className="mono-label">{label} · asset not available</span>
      </div>
    );
  }
  const src = `${import.meta.env.BASE_URL}media/${record.id}.jpg`;
  return (
    <>
      <figure className="doc-scan">
        <button
          ref={triggerRef}
          type="button"
          className="doc-scan-btn"
          onClick={() => setEnlarged(true)}
          aria-label={`Enlarge ${label}`}
        >
          <img
            src={src}
            alt={`${label} for case ${record.id}`}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </button>
        <figcaption className="mono-label">{label} · click to enlarge</figcaption>
      </figure>
      {/* Portaled to <body>: the drawer's backdrop-filter makes it the
          containing block for fixed descendants — inside it, the "full-screen"
          lightbox would be clipped to the panel. */}
      {enlarged &&
        createPortal(
          <div
            ref={lightboxRef}
            className="scan-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`Enlarged ${label}`}
            tabIndex={-1}
            onClick={() => setEnlarged(false)}
          >
            <img src={src} alt={`${label} for case ${record.id}, enlarged`} />
          </div>,
          document.body,
        )}
    </>
  );
}

// Skeptic layer: orbital launches near the incident date, as neutral context.
// Three honest states: not checkable (no day-precision date), checked-and-empty,
// and a candidate list. Nothing here asserts an explanation.
const SKEPTIC_SHOWN = 5;

function SkepticSection({ record }: { record: UAPRecord }) {
  const candidates = skepticCandidates(record.id);
  return (
    <section className="skeptic">
      <span className="mono-label">prosaic context</span>
      {candidates === undefined ? (
        <p className="skeptic-empty">
          not cross-referenced — the incident date lacks day precision
        </p>
      ) : candidates.length === 0 ? (
        <p className="skeptic-empty">no orbital launches within ±1 day of the incident</p>
      ) : (
        <>
          <ul className="skeptic-list">
            {candidates.slice(0, SKEPTIC_SHOWN).map((c, i) => (
              <li key={`${c.date}-${i}`} className="skeptic-row">
                <span className="skeptic-date">{c.date}</span>
                <span className="skeptic-what">
                  {c.vehicle} · {c.payload}
                  {c.site ? ` · ${c.site}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {candidates.length > SKEPTIC_SHOWN && (
            <p className="skeptic-empty">+{candidates.length - SKEPTIC_SHOWN} more in window</p>
          )}
        </>
      )}
      <p className="skeptic-note">
        {SKEPTIC_SOURCE || "orbital launches near the incident date"}. Context only — no explanation
        is asserted.
      </p>
    </section>
  );
}

// The minimal card for a Blue Book basemap dot: these are catalog entries
// (date, location, precision, source), not released documents — the card shows
// exactly that much and says so, rather than dressing them up as case files.
function BluebookCard({ record: r, onClose }: { record: UAPRecord; onClose: () => void }) {
  return (
    <aside className="drawer" aria-label="Blue Book catalog entry">
      <header className="drawer-header">
        <div className="drawer-title">
          <span className="mono-label">{r.sourceAgency} · project blue book</span>
          <span className="drawer-case-id">unknown #{r.id}</span>
        </div>
        <div className="drawer-header-actions">
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close catalog entry"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="drawer-body">
        <dl className="meta-grid drawer-meta-solo">
          <dt>incident date</dt>
          <dd>{formatDate(r)}</dd>
          <dt>location</dt>
          <dd>{r.locationRaw || DASH}</dd>
          <dt>coordinates</dt>
          <dd>{formatCoords(r)}</dd>
          <dt>geo precision</dt>
          <dd className="meta-signal">{r.geoPrecision}</dd>
          <dt>source</dt>
          <dd>
            {isHttpUrl(r.sourceUrl) ? (
              <a className="meta-signal" href={r.sourceUrl} target="_blank" rel="noreferrer">
                unknowns catalog ↗
              </a>
            ) : (
              DASH
            )}
          </dd>
        </dl>

        <p className="drawer-note">
          A USAF Project Blue Book case (1947–1969) the Air Force closed as
          &quot;unidentified.&quot; It is part of the historical basemap: the catalog records only
          the date and place — no released document accompanies it in the PURSUE archive.
        </p>
      </div>
    </aside>
  );
}

export function Drawer({ record, onClose }: DrawerProps) {
  if (!record) return null;
  if (isBasemap(record)) return <BluebookCard record={record} onClose={onClose} />;
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
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close case file"
          >
            ✕
          </button>
        </div>
      </header>

      {/* the body is the inner scroller — the fade mask lives here so the
          panel's glass and border stay crisp while long content dissolves */}
      <div className="drawer-body">
        {/* Both reset per case file via record-scoped keys — PREFIXED, because
            they are siblings and React requires sibling keys to be unique
            across component types too. A bare shared r.id here corrupted
            reconciliation (duplicated/omitted children, dead handlers). */}
        <DocScan key={`scan-${r.id}`} record={r} />
        {(r.media.videos?.length ?? 0) > 0 && (
          <VideoList key={`videos-${r.id}`} ids={r.media.videos ?? []} />
        )}

        <p className="drawer-summary">{r.summary || "No summary available for this record."}</p>

        {/* where & when lead the file (Phase 5 weighting) — the administrative
          fields answer follow-up questions and read quieter */}
        <dl className="meta-grid">
          <dt>incident date</dt>
          <dd className="meta-primary">{formatDate(r)}</dd>
          <dt>location</dt>
          <dd className="meta-primary">{r.locationRaw || DASH}</dd>
          <dt>coordinates</dt>
          <dd className="meta-quiet">{formatCoords(r)}</dd>
          <dt>geo precision</dt>
          <dd className="meta-signal">{r.geoPrecision}</dd>
          <dt>object class</dt>
          <dd>{r.objectClass}</dd>
          <dt>redaction</dt>
          <dd className="meta-alert">
            {r.redactionPct === null ? DASH : `${Math.round(r.redactionPct)}%`}
          </dd>
          <dt>release</dt>
          <dd className="meta-quiet">{r.release || DASH}</dd>
          <dt>source</dt>
          <dd>
            {isHttpUrl(r.sourceUrl) ? (
              <a className="meta-signal" href={r.sourceUrl} target="_blank" rel="noreferrer">
                {isDvidsUrl(r.sourceUrl) ? "official video ↗" : "government record ↗"}
              </a>
            ) : (
              DASH
            )}
          </dd>
        </dl>

        <SkepticSection record={r} />
      </div>
    </aside>
  );
}
