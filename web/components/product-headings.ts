/** Headings for the individual-product picker (Create Quotation → Direct product sale).
 * Display only: a heading is worked out from the product's key and name, and is never saved. */
export const productHeadings=['Inverters','Batteries & BMS','Solar panels','Breakers','Fuses','Changeovers','Surge protection (SPD)','Contactors','Cables','DB boxes & enclosures','Smart meters','C&I BESS parts','Other materials'] as const;
export type ProductHeading=typeof productHeadings[number];
type Product={key:string;display_name?:string|null;item_group?:string|null};

/** Rules run in order; the first match wins. Anything not matched is "Other materials". */
export function productHeading(item:Product):ProductHeading{
 const key=item.key,name=item.display_name||item.key,text=`${key} ${name}`;
 if(/^C&I BESS/i.test(item.item_group??'')||/^CH-(C&I|CAB-|IO MODULE|CNI-)/i.test(key))return 'C&I BESS parts';
 if(/change ?over|changover/i.test(text))return 'Changeovers';
 if(/cable (glands?|pipe)|conduit/i.test(text))return 'Other materials';
 if(/cable/i.test(text))return 'Cables';
 if(/^(HYB-|CH-PCS-)/i.test(key)||/^inverter (on grid|hybrid)/i.test(name))return 'Inverters';
 if(/^(BAT-|CH-BAT-|BMS-|CH-BMS-)/i.test(key)||/^(battery|lithium)\b/i.test(name))return 'Batteries & BMS';
 if(/solar (pv )?modules?|solar plates?/i.test(text))return 'Solar panels';
 if(/fuse/i.test(text))return 'Fuses';
 if(/\b(SPD|VPD)\b/i.test(text))return 'Surge protection (SPD)';
 if(/contactor/i.test(text))return 'Contactors';
 if(/\bbox(es)?\b|enclosure/i.test(text))return 'DB boxes & enclosures';
 if(/\b(MCB|MCCB)\b|breaker/i.test(text))return 'Breakers';
 if(/smart meter/i.test(text))return 'Smart meters';
 return 'Other materials';
}

const label=(item:Product)=>item.display_name||item.key;
/** Products grouped under their headings, in heading order; names sorted so 6mm² comes before 10mm². */
export function groupProducts<T extends Product>(items:T[]):{heading:ProductHeading;items:T[]}[]{
 return productHeadings.map(heading=>({heading,items:items.filter(item=>productHeading(item)===heading).sort((a,b)=>label(a).localeCompare(label(b),'en',{numeric:true,sensitivity:'base'}))})).filter(group=>group.items.length>0);
}
