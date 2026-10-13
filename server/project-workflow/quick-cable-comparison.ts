import {Decimal} from 'decimal.js';
import {calculate} from '../boq/engine.js';
import {surveySchema} from '../boq/schema.js';
/** Quantity-only comparison using the same Quick BOQ engine; never persists prices or brand selections. */
export function quickCableComparison(record:any,masters:any){
 const saved=record.data?.surveyInputs;
 if(!saved)return {rows:[],pending:'Save the survey BOQ inputs to compare cable quantities.'};
 const brands=Object.fromEntries(Object.entries({solar:'Solar Panel',inverter:'Inverter',battery:'Battery & BMS',cable:'Cable',switchgear:'Switchgear'}).map(([key,category])=>[key,saved.brands?.[key]||masters.brands.find((b:any)=>b.category===category&&b.status==='Active')?.id||0]));
 const survey=surveySchema.parse({...saved,brands,uploadIds:[],ocrText:'',ocrReviewed:false});
 const quick=calculate({...survey,sourceMode:'General quotation',acTerminationMode:'Fixed'},masters);
 const actual=calculate({...survey,sourceMode:'Survey',acTerminationMode:'Measured'},masters);
 const totals=(boq:any)=>{
  const result=new Map<string,Decimal>();
  for(const line of boq.lines.filter((l:any)=>/Cable/.test(l.key)&&/^(m|meter|metre|mtrs|meters|metres)$/i.test(l.unit))){
   const key=/^6mm² DC Cable (Red|Black)$/.test(line.key)?'6mm² DC cable combined red/black':line.key;
   result.set(key,(result.get(key)??new Decimal(0)).add(line.qty));
  }
  return result;
 };
 const baseline=totals(quick),entered=totals(actual);
 return {rows:[...new Set([...baseline.keys(),...entered.keys()])].map(field=>{const approved=baseline.get(field)??new Decimal(0),received=entered.get(field)??new Decimal(0);return {field:`${field} (m)`,approved:approved.toString(),entered:received.toString(),different:!approved.eq(received)};}),notes:'Baseline quantities use the existing Quick BOQ engineering rules for this survey configuration. Brand choices and all prices remain unchanged.'};
}
