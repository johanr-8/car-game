/**
 * src/core/DevMode.ts
 * ─────────────────────────────────────────────────────────────
 * Dev mode detection. Controls visibility and keybindings for F3 / F4 panels.
 * ─────────────────────────────────────────────────────────────
 */

export function isDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  const isViteDev = Boolean((import.meta as any).env?.DEV);
  const hasDevQuery = window.location.search.includes('dev=1');
  return isViteDev || hasDevQuery;
}
