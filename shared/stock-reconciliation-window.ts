/** Owner-authorized stock-reconciliation window, Pakistan time. First ten days, ending
 * 9 November 2026 12:52:11 PKT; extended on 12 Nov to the end of 14 November 2026 PKT.
 * DOs may take recorded stock negative until 15 November 2026 00:00 PKT.
 * Actual OUT still posts once, on signed gate upload. No opening is invented.
 * Includes DOs, warehouse transfers and replacements. Dispatcher/item/unit/replay checks remain.
 */
export const negativeDoWindowStartsAt='2026-10-30T07:52:11.000Z';
export const negativeDoWindowEndsAt='2026-11-14T19:00:00.000Z';
export function temporaryNegativeDoBalanceAllowed(now=Date.now()){
 return now>=Date.parse(negativeDoWindowStartsAt)&&now<Date.parse(negativeDoWindowEndsAt);
}
