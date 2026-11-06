import {Decimal} from 'decimal.js';

/** Display/decision projection only. Never edits the preserved source snapshot. */
export function reviewQuantities<T extends {quantities:Record<string,string|null>;sourceRow:Record<string,unknown>}>(row:T,approvedReturnDelta='0'){
 const source=row.sourceRow,holds:string[]=[];
 if(source.unitHold===true)holds.push('Unit needs verification');
 if(source.scopeHold===true)holds.push('Dispatch scope needs verification');
 if(source.dispatchPartial===true)holds.push('Dispatch quantity is incomplete');
 if(source.usagePartial===true)holds.push('Site usage is incomplete');
 const quantities={...row.quantities};
 if(quantities.credited!==null&&quantities.credited!==undefined)quantities.credited=new Decimal(quantities.credited).plus(approvedReturnDelta).toString();
 if(quantities.creditDifference!==null&&quantities.creditDifference!==undefined)quantities.creditDifference=new Decimal(quantities.creditDifference).minus(approvedReturnDelta).toString();
 if(holds.length){quantities.expectedReturn=null;quantities.returnDifference=null;}
 if(source.returnPartial===true){holds.push('Warehouse return evidence is incomplete; a missing receipt does not establish a return quantity');quantities.returnDifference=null;quantities.creditDifference=null;}
 // Known receipts and original IRR values stay visible, even when an aggregate
 // difference cannot yet be calculated. A partial count is never the final total.
 if(quantities.expectedReturn===null&&source.countedReturn==null)quantities.warehouseReturn=null;
 // Attribution uncertainty concerns credit, not independently evidenced DO/use maths.
 if(source.creditAmbiguous===true){holds.push('Existing return credit attribution needs verification; additional credit is held');quantities.creditDifference=null;}
 return {...row,quantities,calculationHolds:holds};
}

export function closingEffect(input:{closing:string|null;inDelta:string;outDelta:string}){
 const incoming=new Decimal(input.inDelta),outgoing=new Decimal(input.outDelta);
 const delta=incoming.minus(outgoing);
 return {before:input.closing,change:delta.toString(),after:input.closing===null?null:new Decimal(input.closing).plus(delta).toString()};
}
