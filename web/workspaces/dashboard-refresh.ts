// Management dashboard background checks (agreed with the user, 16 Nov 2026, "option B").
// The quotation approval list keeps its 30-second check but skips hidden tabs. The other
// dashboard lists check every 2 minutes, and the full coordination list (one of the
// heaviest requests) at most every 5 minutes. Returning to the tab refreshes only when the
// last check is at least a minute old. Saving, approving or reopening the dashboard
// still refreshes at once.
export const approvalsRefreshIntervalMs = 30_000;
export const dashboardRefreshIntervalMs = 120_000;
export const dashboardReturnGapMs = 60_000;
export const coordinationListMinAgeMs = 300_000;

/** True when a background check may run now: the tab is on screen, no check is on its way,
 * and the last one started at least `minGapMs` ago. */
export function dashboardCheckDue({hidden, inFlight, lastStartedAt, now, minGapMs}: {
  hidden: boolean;
  inFlight: boolean;
  lastStartedAt: number | undefined;
  now: number;
  minGapMs: number;
}): boolean {
  if (hidden || inFlight) return false;
  return lastStartedAt === undefined || now - lastStartedAt >= minGapMs;
}

/** True when the full coordination list should be fetched again with this check. */
export function coordinationListDue({force, loadedAt, now}: {force: boolean; loadedAt: number | undefined; now: number}): boolean {
  return force || loadedAt === undefined || now - loadedAt >= coordinationListMinAgeMs;
}
