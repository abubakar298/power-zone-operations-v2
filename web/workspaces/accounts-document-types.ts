/** Delivery-only approval is explicit; an ordinary installation DO is not a substitute for its IRR. */
export function isDeliveryOnlyDo(record:any):boolean{
 const source=record.document_source??record.snapshot?.source??record.source??{};
 const kind=String(record.document_type??record.documentType??source.documentType??source.kind??'').toLowerCase();
 const deliveryOnly=record.scope==='delivery_only'||record.installation===false||record.deliveryOnly===true||source.scope==='delivery_only'||source.installation===false;
 return /delivery[ -]only.*(?:do|delivery order)/i.test(kind)||(deliveryOnly&&(/\bdo\b|delivery order/i.test(kind)));
}
export function accountsDocumentLabel(record:any):string{return isDeliveryOnlyDo(record)?'Delivery-only DO':'IRR / Variable Items';}
