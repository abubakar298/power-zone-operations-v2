import {createHash} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {z} from 'zod';

const rowSchema=z.object({id:z.string().min(1),item:z.string(),itemId:z.string().default(''),unit:z.string(),origin:z.string(),status:z.string(),dispatch:z.unknown().optional(),used:z.unknown().optional(),countedReturn:z.unknown().optional(),credited:z.unknown().optional()}).passthrough();
const sourceSchema=z.object({groups:z.array(z.object({id:z.string().min(1),title:z.string(),warehouse:z.string(),rows:z.array(rowSchema)}).passthrough())}).passthrough();
const catalogueSchema=z.object({rows:z.array(z.object({itemId:z.string().min(1),oldAliases:z.array(z.string()).optional(),savedLiveId:z.string().nullish()}).passthrough()),aliases:z.array(z.object({oldId:z.string(),finalIds:z.array(z.string()).min(1)})).default([])}).passthrough();
type Identity={state:'final'|'alias'|'ambiguous'|'unmapped';finalItemId:string|null;sourceItemId:string;candidates:string[]};
function quantity(value:unknown):string|null{
 if(value==null||value===''||!['string','number'].includes(typeof value))return null;
 try{const amount=new Decimal(String(value));return amount.isFinite()?amount.toString():null;}catch{return null;}
}
const difference=(a:string|null,b:string|null)=>a===null||b===null?null:new Decimal(a).minus(b).toString();

/** Read-only normalization. A reviewed identifier changes identity only: never
 * quantity, unit, product variant, ledger history or an approved conclusion. */
export function prepareInventoryReview(sourceInput:unknown,catalogueInput:unknown){
 const source=sourceSchema.parse(sourceInput),catalogue=catalogueSchema.parse(catalogueInput),finalIds=new Set(catalogue.rows.map(row=>row.itemId));
 if(new Set(source.groups.map(group=>group.id)).size!==source.groups.length)throw Error('Duplicate reconciliation group identity.');
 if(finalIds.size!==catalogue.rows.length)throw Error('Duplicate final item identity in the reviewed catalogue.');
 const aliases=new Map<string,Set<string>>();
 function alias(old:string,id:string){if(!old.trim())throw Error('An empty source identifier cannot become an alias.');if(!finalIds.has(id))throw Error('An alias points outside the final item catalogue.');const values=aliases.get(old)??new Set<string>();values.add(id);aliases.set(old,values);}
 for(const row of catalogue.rows)for(const old of [...row.oldAliases??[],...row.savedLiveId?[row.savedLiveId]:[]])alias(old,row.itemId);
 for(const rule of catalogue.aliases)for(const id of rule.finalIds)alias(rule.oldId,id);
 function identity(row:z.infer<typeof rowSchema>):Identity{
  const sourceItemId=row.itemId;if(finalIds.has(sourceItemId))return {state:'final',finalItemId:sourceItemId,sourceItemId,candidates:[]};
  const candidates=[...aliases.get(sourceItemId)??[]];
  if(candidates.length===1)return {state:'alias',finalItemId:candidates[0],sourceItemId,candidates:[]};
  // Colour is resolved only when the actual source description explicitly names
  // one colour. A combined/unlabelled reel remains held for the owner's decision.
  const red=/\bred\b/i.test(row.item),black=/\bblack\b/i.test(row.item);
  const coloured=red!==black?candidates.filter(id=>red?/\/1C-R\//.test(id):/\/1C-B\//.test(id)):[];
  if(coloured.length===1)return {state:'alias',finalItemId:coloured[0],sourceItemId,candidates:[]};
  return {state:candidates.length?'ambiguous':'unmapped',finalItemId:null,sourceItemId,candidates};
 }
 const seen=new Set<string>();
 const cases=source.groups.flatMap(group=>group.rows.map(row=>{
  const key=group.id+'\0'+row.id;if(seen.has(key))throw Error('Duplicate reconciliation row identity.');seen.add(key);
  const item=identity(row),dispatch=quantity(row.dispatch),used=quantity(row.used),counted=quantity(row.countedReturn),credited=quantity(row.credited);
  const expectedReturn=row.usagePartial===true?null:difference(dispatch,used);
  const verifiedSource=/^Reconciled(?:\s|$)/.test(row.status);
  // Owner accepted zero due with no handwritten entry. Keep that narrow rule;
  // never turn an unknown nonzero receipt into a verified warehouse return.
  const zeroReturnDue=expectedReturn==='0'&&counted===null;
  const warehouseReturn=counted??(verifiedSource&&zeroReturnDue?'0':null);
  const sourceStockPosting=!!row.stockCorrectionPosted||/stock credit posted/i.test(row.status);
  return {
   id:createHash('sha256').update('powerzone.inventory.review\0'+key).digest('hex'),groupId:group.id,groupTitle:group.title,warehouse:group.warehouse,sourceRowId:row.id,
   item:item.finalItemId,sourceItemId:row.itemId,description:row.item,unit:row.unit,origin:row.origin,identity:item,
   quantities:{dispatch,irrIssued:quantity(row.irrIssued),used,reportedReturn:quantity(row.reportedReturn),countedReturn:counted,expectedReturn,warehouseReturn,credited,returnDifference:difference(expectedReturn,warehouseReturn),creditDifference:difference(warehouseReturn,credited)},
   sourceStatus:row.status,conclusion:verifiedSource?'verified-source' as const:'needs-review' as const,identityReviewRequired:item.finalItemId===null,
   stockPosting:sourceStockPosting?'already-recorded-in-source' as const:'not-posted-by-this-import' as const,
   postingEnabled:false as const,sourceRow:structuredClone(row),
  };
 }));
 return {groups:source.groups.map(({rows,...metadata})=>structuredClone(metadata)),cases,postingEnabled:false as const,summary:{groups:source.groups.length,rows:cases.length,verifiedConclusions:cases.filter(row=>row.conclusion==='verified-source').length,reviewRows:cases.filter(row=>row.conclusion==='needs-review').length,identityHolds:cases.filter(row=>row.identityReviewRequired).length,recordedStockCorrections:cases.filter(row=>row.stockPosting==='already-recorded-in-source').length}};
}
