type Row=Record<string,any>;
export const invoiceReviewGroups=[
 ['allocation','Payment allocation or source change to check','A payment, balance or source value cannot be matched to one invoice. Confirm in PT; nothing is divided automatically.'],
 ['split','Combined reference — separate amounts to enter','Historical records that held several invoice numbers are listed per invoice. Enter each invoice’s own amount.'],
 ['balance-without-total','Outstanding known, original invoice total missing','The outstanding balance is kept. Enter the original invoice total once verified in PT.'],
 ['missing-both','Submitted, amount and balance missing','Enter the actual invoice amount. Recorded receipts are checked before any balance is calculated.'],
 ['unsubmitted','Not yet submitted, amount missing','Enter the amount when the invoice is confirmed in PT.'],
] as const;
export type InvoiceReviewGroup=(typeof invoiceReviewGroups)[number][0];
/** Live re-check of existing invoice records; each row is listed once, in the first
 * group that applies. Values are reported, never estimated. */
export function invoiceReviewGroup(row:Row):InvoiceReviewGroup|null{
 if(row.invoiceAllocationPending||row.unallocatedStagePending!=null||row.receiptHold||row.invoiceCorrectionHold)return 'allocation';
 if(row.amount!=null)return null;
 if(row.legacyStageId)return 'split';
 if(row.submission!=='Submitted')return 'unsubmitted';
 return row.pending!=null?'balance-without-total':'missing-both';
}
export function invoiceDataReview(rows:Row[]){
 const grouped=invoiceReviewGroups.map(([id,label,action])=>({id,label,action,rows:rows.filter(r=>invoiceReviewGroup(r)===id)}));
 return {groups:grouped,total:grouped.reduce((n,g)=>n+g.rows.length,0)};
}
