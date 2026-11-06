import {Decimal} from 'decimal.js';
/** Survey entry suggestion only; does not change approved BOQ/rule snapshots. */
export function panelEarthMetres(panelQty: number|string): string {
 return new Decimal(panelQty || 0).mul('0.3048').ceil().toString();
}
/** Persisted DC quantity includes both equal-length red and black conductors. */
export function dcConductorMetres(combinedMetres: number|string): string {
 return new Decimal(combinedMetres || 0).div(2).toString();
}

/** Whole metres per conductor; red/black remain equal when stored as a combined total. */
export function roundedSurveyCableMetres(key: string, metres: number|string): string {
 const n=new Decimal(metres || 0);
 return key==='dcMetres'?n.div(2).ceil().mul(2).toString():n.ceil().toString();
}
