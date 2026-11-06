/** Owner-authorized ten-day stock-reconciliation window, Pakistan time.
 * DOs may take recorded stock negative until 9 November 2026 at 12:52:11 PKT.
 * Actual OUT still posts once, on signed gate upload. No opening is invented.
 * Includes DOs, warehouse transfers and replacements. Dispatcher/item/unit/replay checks remain.
 */
export const negativeDoWindowStartsAt='2026-10-30T07:52:11.000Z';
export const negativeDoWindowEndsAt='2026-11-09T07:52:11.000Z';
export function temporaryNegativeDoBalanceAllowed(now=Date.now()){
 return now>=Date.parse(negativeDoWindowStartsAt)&&now<Date.parse(negativeDoWindowEndsAt);
}
