// Runtime bridge from tokens.css into WebGL land. react-globe.gl paints on a
// canvas, so it can't consume var(--token) directly — these helpers read the
// computed token values so tokens.css stays the single source of truth.

export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function tokenNumber(name: string, fallback: number): number {
  const n = Number.parseFloat(token(name));
  return Number.isFinite(n) ? n : fallback;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
