type Row=Record<string,any>;
export const isMissingInvoiceCustomer=(value:unknown)=>!String(value??'').trim()||/^(customer not recorded|not recorded|unknown)$/i.test(String(value).trim());
/** A recovered display name must retain earlier exact-ledger events saved with
 * its missing label. Never accept another actual customer or another IPO. */
export function sameInvoiceCustomer(row:Row,customer:unknown){
 if(row.customer===customer)return true;
 const link=row.customerLink;
 return link?.basis==='Exact saved IPO customer'&&row.sourceKey==='issued:'+link.ipoId&&isMissingInvoiceCustomer(link.originalCustomer)&&link.originalCustomer===customer;
}
