// Sidebar bucket counts reuse the full department workflow list, which is one
// of the heaviest requests. Refresh it at most once a minute, only while the
// tab is on screen, and never twice within a short gap (focus and visibility
// events often fire together when a user returns to the tab).
export const sidebarRefreshIntervalMs = 60_000;
export const sidebarMinRefreshGapMs = 15_000;

export function shouldRefreshSidebar({hidden, inFlight, lastLoadedAt, now}: {
  hidden: boolean;
  inFlight: boolean;
  lastLoadedAt: number | undefined;
  now: number;
}): boolean {
  if (hidden || inFlight) return false;
  return lastLoadedAt === undefined || now - lastLoadedAt >= sidebarMinRefreshGapMs;
}
