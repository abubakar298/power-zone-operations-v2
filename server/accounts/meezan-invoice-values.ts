type Row=Record<string,any>;
/** Owner confirmed 30 October 2026: full installation invoice per site.
 * Exact programme identity only; never infer a batch from an invoice's suffix.
 * Apply after receipts so existing payments and frozen baselines remain intact. */
export function applyMeezanInvoiceValues(rows:Row[]):Row[]{return rows.map(row=>{
 if(row.sourceKeys?.length>1||row.customer!=='Meezan Bank Limited'||!String(row.category).startsWith('System'))return row;
 const key=String(row.sourceKey??row.id??'').replace(/^registered-/,''),m=/^MBL:CHP-\d+:(20|60|80)-site order:([1-9]\d*)\/(20|60|80)$/.exec(key);
 if(!m||m[1]!==m[3]||Number(m[2])>Number(m[1]))return row;
 const amount=m[1]==='20'?'935000.00':'660000.00';
 const next={...row,amount:row.amount??amount,...(row.amount==null?{invoiceAmountBasis:'Owner-confirmed MBL '+m[1]+' batch invoice value · 30 October 2026'}:{})};
 if(row.pending==null&&row.receiptConfirmed!==true&&!row.receiptHold&&!row.invoiceCorrectionHold){
  return{...next,pending:next.amount,pendingBasis:'owner-confirmed-mbl-batch',notes:[row.notes,'Full installation invoice value confirmed by Management; no receipt is recorded against this invoice.'].filter(Boolean).join(' ')};
 }
 return next;
});}
