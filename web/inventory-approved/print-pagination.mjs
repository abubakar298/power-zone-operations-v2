/** Conservative A4 row budgets reserve space for the header and signatures.
 * Long names/IDs consume more than one row unit. No material is clipped to fit.
 */
export function paginateMaterialRows(rows, mode='do',{headerText='',blankRows=3,minBlankRows=0}={}) {
 const base=mode==='irr'?17:mode==='master'?15:18;
 const capacity=Math.max(8,base-Math.max(0,Math.ceil(String(headerText).length/90)-1));
 const weight=row=>Math.max(1,Math.ceil(String(row?.name||'').length/(mode==='irr'?48:65)),Math.ceil(String(row?.id||'').length/40));
 const pages=[];let page=[],used=0;
 for(const row of rows){const units=Math.min(capacity,weight(row));if(page.length&&used+units>capacity){pages.push(page);page=[];used=0;}page.push(row);used+=units;}
 // minBlankRows (VSO): if the last page has no room for them, its last item moves to a new page.
 if(minBlankRows&&page.length&&capacity-used<minBlankRows){const last=page.pop();if(page.length)pages.push(page);page=[last];used=Math.min(capacity,weight(last));if(capacity-used<minBlankRows){pages.push(page);page=[];used=0;}}
 const blanks=Math.min(Math.max(blankRows,minBlankRows),Math.max(0,capacity-used));
 page.push(...Array.from({length:blanks},()=>undefined));
 if(page.length||!pages.length)pages.push(page);
 return pages;
}
