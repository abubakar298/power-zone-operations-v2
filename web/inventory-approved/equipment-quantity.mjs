export const isCountedEquipment=id=>/^CH-(?:PCS|INV|BAT|BMS)(?:-|\b)/i.test(id);
// Rating remains part of the product identity. BOQ helpers show counts for that product.
export function surveyUnitCount(id,raw){
 if(!raw||raw==='—')return raw||'—';
 if(!isCountedEquipment(id))return raw;
 const mult=raw.match(/^\s*(\d+(?:\.\d+)?)\s*[×x]\s*\d/);if(mult)return mult[1];
 const capacity=raw.match(/^\s*(\d+(?:\.\d+)?)\s*(kwh|kw)\s*$/i);
 if(capacity){const rating=/^CH-BAT/i.test(id)?Number(id.match(/-0?(\d+(?:\.\d+)?)\s*KW/i)?.[1]):/^CH-(?:PCS|INV)/i.test(id)?Number(id.match(/-(\d+)$/)?.[1]):0;return rating>0?String(Number(capacity[1])/rating):raw;}
 const count=raw.match(/^\s*(\d+(?:\.\d+)?)\s*(?:nos?\.?|units?|pcs?\.?)?\s*$/i);return count?count[1]:raw;
}
