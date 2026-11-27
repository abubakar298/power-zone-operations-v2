/**
 * Standing exception: "Attach customer PO" (customer PO received later) on an IPO issued as "Customer PO".
 *
 * What it fixes: at Confirm Sale the coordinator (Atif Hameed) chose "Customer PO" and typed the placeholder
 * "Yet to Issue." as the PO number, when the site was really approved by email. The issued IPO, its customer PO
 * row and its PO receipt are immutable, so the normal "received later" screen stayed closed for this site.
 * This list lets Coordination attach the real customer PO through that normal screen. The issued IPO, its number
 * and its PDF are not changed.
 *
 * Records: UBL Kot Sarang (branch 0999), IPO CHP-163, order 166/250 —
 *   workflow record 5aa91218-903a-45af-b382-652d4468f515, IPO 41d14f4c-14c6-4301-a194-ccb15b825223.
 * Date: 26 November 2026. Approved by: the user (owner instruction in chat, 26 November 2026).
 *
 * Never extend this by customer, IPO number, PO text or site name; add exact workflow record ids only.
 */
export const latePoExceptionRecordIds: ReadonlySet<string> = new Set([
  "5aa91218-903a-45af-b382-652d4468f515",
]);

export const latePoException = (recordId: string | null | undefined) =>
  typeof recordId === "string" && latePoExceptionRecordIds.has(recordId);
