import {hasUnsavedChanges} from '../hooks/useUnsavedChanges.js';

// After a release, the previous build's screen files are gone. A tab opened before the release then
// fails to load any screen it has not opened yet. Vite reports that as "vite:preloadError"; the
// page reloads itself once to pick up the new version, unless someone has unsaved typing.
export const releaseReloadGapMs = 5 * 60_000;
export const releaseReloadMessage = 'A new version of the portal is ready. Save your work, then reload the page.';
const storageKey = 'pz:release-reload-at';

export function releaseReloadDecision({now, lastReloadAt, unsaved}: {
  now: number;
  lastReloadAt: number | undefined;
  unsaved: boolean;
}): 'reload' | 'ask' | 'skip' {
  if (unsaved) return 'ask';
  // Never reload in a loop: if a reload a moment ago did not help, show the normal error instead.
  if (lastReloadAt !== undefined && now - lastReloadAt < releaseReloadGapMs) return 'skip';
  return 'reload';
}

function lastReload(): number | undefined {
  try {
    const value = Number(sessionStorage.getItem(storageKey));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function installReleaseReload() {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', () => {
    const now = Date.now();
    const decision = releaseReloadDecision({now, lastReloadAt: lastReload(), unsaved: hasUnsavedChanges()});
    if (decision === 'ask') {
      window.dispatchEvent(new CustomEvent('pz:workflow-completed', {detail: {message: releaseReloadMessage}}));
      return;
    }
    if (decision === 'skip') return;
    try { sessionStorage.setItem(storageKey, String(now)); } catch { /* reload anyway; the gap check then cannot run */ }
    window.location.reload();
  });
}
