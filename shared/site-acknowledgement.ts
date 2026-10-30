/** Customer-print allowlist. No prices, serials, private contacts or completion claims. */
export type SiteAcknowledgement={siteId:string;reference:string;customer:string;site:string;ipo:string;customerPo:string;orderNumber:string;address:string;contact:string;phone:string;inverter:string;battery:string;panels:string;installation:boolean|null};
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const positive=(v:unknown)=>typeof v==='number'||typeof v==='string'?Number(v)>0:false;
export function siteAcknowledgementModels(record:{number:string;snapshot:{sites:any[];lines:any[]}},ipos:ReadonlyMap<string,any>):SiteAcknowledgement[]{
 const seen=new Set<string>();
 return record.snapshot.sites.flatMap(site=>{
  if(!site.siteId||seen.has(site.siteId))return [];seen.add(site.siteId);
  const source=ipos.get(site.siteId),s=source?.snapshot??{},input=s.input??{};
  // Every product is from this site's exact IPO/BOQ. Parent pooled material is never treated as a site's installed system.
  const lines=Array.isArray(source?.boq?.lines)?source.boq.lines:record.snapshot.sites.length===1?record.snapshot.lines:[];
  const summary=(pattern:RegExp)=>lines.filter((r:any)=>positive(r.qty??r.out)&&pattern.test([r.phase,r.key,r.itemId,r.description].join(' '))).map((r:any)=>[text(r.description)||text(r.itemId)||text(r.key),text(r.specification),`${r.qty??r.out} ${text(r.unit)}`.trim()].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' - ')).join('; ');
  return [{siteId:site.siteId,reference:record.number,customer:text(site.customer)||text(s.customer?.name),site:text(site.siteName)||text(s.siteName),ipo:text(site.ipo)||text(source?.number),customerPo:text(site.customerPo)||text(input.poNumber),orderNumber:text(site.orderNumber)||text(input.orderNumber),address:text(input.deliveryAddress),contact:text(input.siteContact)||text(input.contactPerson),phone:text(input.sitePhone)||text(input.phone),inverter:summary(/inverter|\bups\b|^INV-|^CH-(?:PCS|INV)-/i),battery:summary(/batter(?:y|ies)|^BAT-|^CH-BAT-/i),panels:summary(/solar panels?|pv (?:panels?|modules?)/i),installation:typeof site.installation==='boolean'?site.installation:null}];
 });
}
