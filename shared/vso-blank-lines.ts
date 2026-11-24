/** Owner request (user, 24 Nov 2026): every VSO (Variable-Material Usage Sign-off) keeps at least
 * two blank lines for items written by hand, for example material bought from a local vendor. */
export const vsoMinimumBlankLines=2;

/** Blank rows printed at the end of a VSO table: the model's own count, never fewer than the minimum. */
export function vsoBlankRows(blankRows?:number){return Math.max(blankRows??0,vsoMinimumBlankLines);}
