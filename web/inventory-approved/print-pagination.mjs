/** Conservative A4 row budgets reserve space for the header and signatures.
 * Long names/IDs consume more than one row unit. No material is clipped to fit.
 */
export function paginateMaterialRows(rows, mode='do',{headerText=''}={}) {
 const base=mode==='irr'?17:mode==='master'?15:18;
 const capacity=Math.max(8,base-Math.max(0,Math.ceil(String(headerText).length/90)-1));
 const weight=row=>Math.max(1,Math.ceil(String(row?.name||'').length/(mode==='irr'?48:65)),Math.ceil(String(row?.id||'').length/40));
 const pages=[];let page=[],used=0;
 for(const row of rows){const units=Math.min(capacity,weight(row));if(page.length&&used+units>capacity){pages.push(page);page=[];used=0;}page.push(row);used+=units;}
 const blanks=Math.min(3,Math.max(0,capacity-used));
 page.push(...Array.from({length:blanks},()=>undefined));
 if(page.length||!pages.length)pages.push(page);
 return pages;
}
