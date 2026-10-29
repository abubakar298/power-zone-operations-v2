/** A zero balance alone is not evidence of a receipt awaiting transaction details. */
export function paymentQueue(rows:any[],entries:any[]){
  const recorded=new Set(entries.map(e=>e.source_row_id));
  return rows.filter(r=>r.receiptConfirmed===true&&r.invoice&&!recorded.has(r.id));
}
