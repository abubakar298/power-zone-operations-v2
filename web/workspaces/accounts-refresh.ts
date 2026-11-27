// Accounts dashboard counts (16 Nov 2026, from Render's slow-request log): coming back to the browser
// window re-checks the work counts only when the last check is at least a minute old, so switching to
// Peachtree or Excel and back does not run the heavy checks again each time. Opening the dashboard (or
// its My Workspace tab) still checks at once.
export const accountsReturnGapMs = 60_000;

export function accountsReturnCheckDue(lastStartedAt: number | undefined, now: number): boolean {
  return lastStartedAt === undefined || now - lastStartedAt >= accountsReturnGapMs;
}
