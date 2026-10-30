import{Decimal}from'decimal.js';
import{materialDocumentPolicy}from'../../shared/material-documents.js';
import type{PreparationRow}from'../../shared/material-preparation.js';
export function reviewIssueRows(rows:PreparationRow[],already:Record<string,string>){
 const missing:string[]=[],included:PreparationRow[]=[];
 for(const row of rows){const policy=materialDocumentPolicy(row);if(policy.approvedQuantityLocked||policy.group==='non-stock'||!row.out||new Decimal(row.out).lte(0))continue;
  if(!row.itemId){missing.push(row.description||'Item without stock ID');continue;}
  const remaining=new Decimal(row.out).minus(already[row.key]??0);if(remaining.gt(0))included.push({...row,out:remaining.toString()});
 }
 return{included,missing};
}
