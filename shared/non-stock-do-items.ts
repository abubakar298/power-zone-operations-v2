/**
 * Non-stock DO item: CH-Solar Structure.
 *
 * What it fixes: the DO item list only offered reviewed warehouse stock IDs, so
 * Inventory could not put the solar structure on a site DO.
 * Records affected: DO lines whose item ID is CH-Solar Structure (new lines only).
 * Date and approval: owner instruction, 23 November 2026 (relayed by the user):
 * the structure is not warehouse stock; the electrician or responsible person buys
 * it from a vendor and installs it. It is listed on the DO without any warehouse
 * stock movement, its quantity is always 1, and Inventory chooses its size in kW.
 *
 * The chosen size is kept in the line description ("Solar structure — 3 kW"), which
 * is saved with the DO line and printed on every DO copy, PDF and print.
 */
export const solarStructureItemId='CH-Solar Structure';
export const solarStructureUnit='No.';
export const solarStructureQuantity='1';
const baseDescription='Solar structure';
/** Whole kW sizes offered in the drop-down. */
export const solarStructureKwChoices:readonly number[]=Array.from({length:100},(_,index)=>index+1);

export function isSolarStructureItem(itemId:string|undefined|null){
 return (itemId??'').trim().toLowerCase()===solarStructureItemId.toLowerCase();
}
export function solarStructureDescription(kw:number){
 return `${baseDescription} — ${kw} kW`;
}
/** The chosen size, or null when the description has no valid kW choice. */
export function solarStructureKw(description:string|undefined|null){
 const match=(description??'').trim().match(/^Solar structure — (\d{1,3}) kW$/);
 const kw=match?Number(match[1]):NaN;
 return solarStructureKwChoices.includes(kw)?kw:null;
}
/** The pick-list entry, offered even though no warehouse balance exists. */
export const solarStructureCatalogueItem={itemId:solarStructureItemId,description:baseDescription,units:[solarStructureUnit]};
/** Message shown when the structure line is incomplete or changed. */
export const solarStructureRule='Solar structure needs its kW size. Its quantity is always 1 (No.) and it is listed on the DO without warehouse stock.';
