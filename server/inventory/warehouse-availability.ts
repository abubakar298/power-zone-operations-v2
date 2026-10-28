import type {Pool,PoolClient} from 'pg';
import {Decimal} from 'decimal.js';
import {sameUnit} from '../../shared/stock-units.js';
import {warehousePositions} from './warehouse-ledger.js';
type Availability={quantity:string|null;unit:string;hold:string|null};
/** Global planning reads authoritative warehouse positions INSTEAD of legacy
 * counts/receipts. Ambiguous identity, partial authority and unknown stock hold
 * automatic buying rather than silently treating missing warehouses as zero. */
export async function warehouseAvailability(c:Pool|PoolClient,requested:{itemKey:string;unit:string}[]){
 const authorities=(await c.query('SELECT warehouse,source_sha256,state FROM inventory_warehouse_authority_current ORDER BY warehouse')).rows;
 if(!authorities.length)return null;
 const byWarehouse=new Map(authorities.map(r=>[r.warehouse,r]));
 const positions=(await Promise.all([...new Set(authorities.map(r=>r.source_sha256 as string))].map(source=>warehousePositions(c,source)))).flat();
 const catalogue=(await c.query("SELECT item_id,rate_key FROM inventory_catalogue_final_current WHERE payload->>'finalStockId'='true' ORDER BY item_id")).rows;
 const finalIds=new Set(catalogue.map(r=>r.item_id as string)),aliases=(await c.query('SELECT alias,item_id FROM inventory_item_aliases_current')).rows;
 const sourceIds=new Set(positions.map(r=>r.baseline.itemId as string));
 const inputs=new Map(requested.map(r=>[r.itemKey,r.unit]));
 for(const item of catalogue.filter(r=>sourceIds.has(r.item_id))){const key=item.rate_key||item.item_id;if(!inputs.has(key))inputs.set(key,positions.find(r=>r.baseline.itemId===item.item_id)?.baseline.unit??'');}
 const result=new Map<string,Availability>();
 for(const [key,unit] of inputs){
  const direct=finalIds.has(key)?[key]:[],aliasTargets=[...new Set(aliases.filter(r=>r.alias===key&&finalIds.has(r.item_id)).map(r=>r.item_id as string))],commercial=[...new Set(catalogue.filter(r=>r.rate_key===key).map(r=>r.item_id as string))];
  const targets=direct.length?direct:[...new Set([...aliasTargets,...commercial])];
  const held=(hold:string)=>result.set(key,{quantity:null,unit,hold});
  if(targets.length!==1||!finalIds.has(targets[0])){held('Final item identity needs review');continue;}
  const itemId=targets[0],all=positions.filter(r=>r.baseline.itemId===itemId);
  if(!all.length){held('Warehouse opening balance needs verification');continue;}
  // One current source per warehouse; other rows in a shared source still tell
  // us that an unactivated warehouse exists, so global availability is unknown.
  const warehouses=[...new Set(all.map(r=>r.baseline.warehouse as string))];
  const current=[];
  let hold='';
  for(const warehouse of warehouses){const authority=byWarehouse.get(warehouse);if(!authority||authority.state!=='active'){hold='Warehouse baseline verification pending';break;}
   const rows=all.filter(r=>r.baseline.warehouse===warehouse&&r.sourceSha256===authority.source_sha256);
   if(rows.length!==1){hold='Warehouse item/unit identity needs review';break;}
   const row=rows[0];if(!sameUnit(unit,row.baseline.unit)){hold='Stock and purchase units need review';break;}if(row.currentClosing===null||new Decimal(row.currentClosing).lt(0)){hold='Unknown or negative warehouse balance needs reconciliation';break;}current.push(row);
  }
  if(hold){held(hold);continue;}
  result.set(key,{quantity:current.reduce((sum,r)=>sum.plus(r.currentClosing!),new Decimal(0)).toString(),unit:current[0]?.baseline.unit??unit,hold:null});
 }
 return result;
}
