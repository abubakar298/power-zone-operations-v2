import {hasUnsavedChanges} from '../hooks/useUnsavedChanges.js';

// After a release, the previous build's screen files are gone. A tab opened before the release then
// fails to load any screen it has not opened yet. Vite reports that as "vite:preloadError". The page
// asks the server which version is live; only if it differs from the one this tab runs does the page
// reload itself (once), unless someone has unsaved typing. A failed load on the same version (for
// example a network hiccup) is left to the screen's own error handling, exactly as before.
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

/** The build name in a page, e.g. "index-C8nt2Oos.js" from its main script tag. */
export function buildName(html: string): string | undefined {
  return html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
}

/** True only when the server's live page names a different build from the one this tab runs. */
export function newReleaseLive(currentBuild: string | undefined, livePage: string): boolean {
  const live = buildName(livePage);
  return Boolean(currentBuild && live && live !== currentBuild);
}

function lastReload(): number | undefined {
  try {
    const value = Number(sessionStorage.getItem(storageKey));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

let checking = false;
async function recover() {
  if (checking) return;
  checking = true;
  try {
    const currentBuild = buildName(document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? '');
    const response = await fetch('/', {cache: 'no-store', credentials: 'same-origin'});
    if (!response.ok || !newReleaseLive(currentBuild, await response.text())) return;
    const now = Date.now();
    const decision = releaseReloadDecision({now, lastReloadAt: lastReload(), unsaved: hasUnsavedChanges()});
    if (decision === 'ask') {
      window.dispatchEvent(new CustomEvent('pz:workflow-completed', {detail: {message: releaseReloadMessage}}));
      return;
    }
    if (decision === 'skip') return;
    try { sessionStorage.setItem(storageKey, String(now)); } catch { /* reload anyway; the gap check then cannot run */ }
    window.location.reload();
  } catch {
    // Offline or the check failed: keep today's behaviour (the screen's own error message).
  } finally {
    checking = false;
  }
}

export function installReleaseReload() {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', () => { void recover(); });
}
