/** Owner rule: only UBL Solar may invoice its delivery milestone after a signed partial delivery.
 * This is invoice eligibility, never a claim of full delivery or installation completion. */
export function isUblSolar(row:Record<string,any>){
 if(row.kind==='UPS'||row.projectType==='ups'||row.installation===false||row.deliveryOnly===true||row.projectType==='delivery-only')return false;
 const customer=String(row.customer??'').trim().toLowerCase();
 return ['ubl','united bank limited','united bank ltd','united bank'].includes(customer)&&(row.program==='Solar 70'||row.projectType==='solar');
}
export function partialSolarInvoiceDate(site:Record<string,any>,approved:Record<string,any>={}){
 if(!isUblSolar({...approved,...site})||site.partial!==true||site.cancelled||site.transferred||site.superseded||site.scopePending)return null;
 const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
 const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;
 const lastReturn=site.deliveryReturns?.at(-1)?.recordedAt;
 const rows=(site.deliveries??[]).filter((d:any)=>uuid(d.signedDo?.id)&&date(d.deliveryDate)&&(!lastReturn||d.recordedAt>lastReturn));
 const latest=rows.at(-1);if(latest)return date(latest.deliveryDate);
 return uuid(site.signedDo?.id)&&(!lastReturn||site.deliveryRecordedAt>lastReturn)?date(site.deliveryDate):null;
}
