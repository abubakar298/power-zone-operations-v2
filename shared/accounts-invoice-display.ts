import {Decimal} from 'decimal.js';
type InvoiceRow=Record<string,any>;
export const invoiceCategories=[['solar','Solar'],['ups','UPS'],['delivery-only','Delivery Only'],['extra-cable','Extra Cable'],['internet','Internet']] as const;
export function invoiceCategory(row:InvoiceRow):string{
 if(row.category==='Extra cable')return 'extra-cable';
 if(row.category==='Internet')return 'internet';
 const key=String(row.sourceKey??row.id??'').replace(/^registered-/,'');
 if(key.startsWith('UBL:SOLAR:')||row.category==='System · advance')return 'solar';
 if(row.category==='System · delivery')return 'delivery-only';
 if(row.category==='System'||key.startsWith('MBL:')||key.startsWith('UBL:UPS:'))return 'ups';
 return 'other';
}
export function invoiceType(row:InvoiceRow):string{
 const category=invoiceCategory(row);
 if(category==='extra-cable')return 'Extra Cable Invoice';
 if(category==='internet')return 'Internet Invoice';
 if(category==='delivery-only')return 'Delivery Only Invoice';
 if(category==='solar')return row.category==='System · advance'||row.billingMilestone==='delivery'?'50% Advance Invoice':'Balance Invoice';
 return row.category==='System · completion'||category==='ups'?'Installation / Completion Invoice':'System Invoice';
}

/** Same predicate in Accounts and Management: missing balances stay visible for review. */
export function isSubmittedInvoicePending(row:InvoiceRow):boolean{
 return row.submission==='Submitted'&&!!row.invoice&&(!!row.receiptHold||(row.pending==null?row.receiptConfirmed!==true:new Decimal(row.pending).gt(0)));
}
export function matchesInvoiceFilters(row:InvoiceRow,category:string,stage:string):boolean{
 return (!category||invoiceCategory(row)===category)&&(!stage||invoiceType(row)===stage);
}
