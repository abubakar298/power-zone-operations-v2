import {createHash} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {z} from 'zod';

const amount=z.union([z.number(),z.string()]).transform((v,ctx)=>{
 try{const d=new Decimal(v);if(d.isFinite()&&d.decimalPlaces()<=20&&d.abs().lt('100000000000000'))return d.toString();}catch{}
 ctx.addIssue({code:'custom',message:'Invalid stock quantity.'});return z.NEVER;
});
const identity={itemId:z.string().min(1),warehouse:z.string().min(1),unit:z.string().min(1)};
const balance=z.object({...identity,description:z.string(),opening:amount.nullable(),in:amount,out:amount,closing:amount.nullable(),openingStatus:z.string(),review:z.string()}).passthrough();
const movement=z.object({...identity,eventId:z.string().min(1),description:z.string(),in:amount,out:amount}).passthrough();
const schema=z.object({meta:z.record(z.string(),z.unknown()),balances:z.array(balance),events:z.array(movement)}).passthrough();
export const warehouseLedgerKey=(itemId:string,warehouse:string,unit:string)=>createHash('sha256').update(JSON.stringify([itemId,warehouse,unit])).digest('hex');

/** Validate a historical ledger as evidence, not new receipts. Nothing is posted. */
export function prepareWarehouseSource(input:unknown,finalItemIds:readonly string[]){
 const source=schema.parse(input),ids=new Set(finalItemIds),seen=new Set<string>(),eventsSeen=new Set<string>();
 const totals=new Map<string,{incoming:Decimal;outgoing:Decimal}>();
 for(const row of source.events){
  if(eventsSeen.has(row.eventId))throw Error('Duplicate historical stock event.');eventsSeen.add(row.eventId);
  if(!ids.has(row.itemId))throw Error('Historical event is outside the final item catalogue.');
  if(new Decimal(row.in).lt(0)||new Decimal(row.out).lt(0))throw Error('Historical movements must retain nonnegative IN and OUT quantities.');
  const key=warehouseLedgerKey(row.itemId,row.warehouse,row.unit),total=totals.get(key)??{incoming:new Decimal(0),outgoing:new Decimal(0)};
  total.incoming=total.incoming.plus(row.in);total.outgoing=total.outgoing.plus(row.out);totals.set(key,total);
 }
 const balances=source.balances.map(row=>{
  const key=warehouseLedgerKey(row.itemId,row.warehouse,row.unit);
  if(seen.has(key))throw Error('Duplicate item / warehouse / unit stock balance.');seen.add(key);
  if(!ids.has(row.itemId))throw Error('Historical balance is outside the final item catalogue.');
  if(new Decimal(row.in).lt(0)||new Decimal(row.out).lt(0))throw Error('Historical totals must retain nonnegative IN and OUT quantities.');
  if((row.opening===null)!==(row.closing===null))throw Error('Unknown opening stock must keep its closing balance unknown.');
  const formulaClosing=row.opening===null?null:new Decimal(row.opening).plus(row.in).minus(row.out);
  if(formulaClosing!==null&&formulaClosing.minus(row.closing!).abs().gt('0.000001'))throw Error('Historical closing stock does not match opening plus IN less OUT.');
  const total=totals.get(key)??{incoming:new Decimal(0),outgoing:new Decimal(0)};
  if(total.incoming.minus(row.in).abs().gt('0.000001')||total.outgoing.minus(row.out).abs().gt('0.000001'))throw Error('Historical event totals do not match the stock balance.');
  const calculatedClosing=row.opening===null?null:new Decimal(row.opening).plus(total.incoming).minus(total.outgoing).toString();
  // Old browser exports used binary floating point. Preserve their exact values;
  // expose sub-millionth residues separately instead of inventing stock movements.
  const precisionResidue=!total.incoming.equals(row.in)||!total.outgoing.equals(row.out)||(calculatedClosing!==null&&!new Decimal(calculatedClosing).equals(row.closing!));
  return {key,...row,eventIn:total.incoming.toString(),eventOut:total.outgoing.toString(),calculatedClosing,precisionResidue};
 });
 for(const key of totals.keys())if(!seen.has(key))throw Error('Historical movement has no matching stock balance.');
 return {meta:source.meta,balances,events:source.events,summary:{balances:balances.length,events:source.events.length,unknownClosings:balances.filter(r=>r.closing===null).length,negativeClosings:balances.filter(r=>r.closing!==null&&new Decimal(r.closing).lt(0)).length,precisionResidueRows:balances.filter(r=>r.precisionResidue).length},postingEnabled:false as const};
}
