/** Read-only identity resolution: a customer plus an exact issued IPO and order.
 * Shared PO text and a similar site name never choose a costing record. */
export type DocumentIpoIdentity={id:string;number:string;orderNumber:string;customerCode:string;customerName:string};
const text=(v:unknown)=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
export function customerDocumentNativeIpo(site:{ipo?:unknown;customer?:unknown},issued:DocumentIpoIdentity[]):string|undefined{
 const [number,...parts]=String(site.ipo??'').split(' · '),order=parts.join(' · '),customer=text(site.customer);
 if(!text(number)||!customer)return;
 const matches=issued.filter(i=>text(i.number)===text(number)&&text(i.orderNumber)===text(order)&&[text(i.customerCode),text(i.customerName)].filter(Boolean).includes(customer));
 return matches.length===1?matches[0].id:undefined;
}
