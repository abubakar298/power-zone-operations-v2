type Row=Record<string,any>;
/** Owner-confirmed display corrections for records entered from the pre-portal Excel
 * registers. Accounts screens show the corrected reference; saved Operations,
 * Inventory and Accounts records keep their original values and history, and
 * internal matching continues to use the saved label.
 * 3 Nov 2026 (Umar): Consumer Hub Lahore is CHP-233 · 2/60, not CHP-338 · 20/60. */
const corrections=[{site:'Consumer Hub Lahore',from:'CHP-338 · 20/60',to:'CHP-233 · 2/60'}] as const;
const same=(a:unknown,b:string)=>String(a??'').trim().replace(/\s+/g,' ').toLowerCase()===b.toLowerCase();
/** Exact site name and exact saved label must both match; nothing else is changed. */
export function accountsIpoLabel(ipo:unknown,site:unknown):string{
 const hit=corrections.find(c=>same(site,c.site)&&same(ipo,c.from));
 return hit?hit.to:String(ipo??'');
}
/** Relabel one output row; the site field may hold one name or a combined "A / B" list. */
export function withAccountsIpo<T extends Row>(row:T,ipoField='ipo',siteField='site'):T{
 if(!row||typeof row!=='object')return row;
 const ipo=row[ipoField],site=row[siteField];
 if(typeof ipo!=='string')return row;
 const next=accountsIpoLabel(ipo,site);
 return next===ipo?row:{...row,[ipoField]:next,originalIpoLabel:ipo};
}
