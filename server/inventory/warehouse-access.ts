import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';

export async function requireWarehouseAccess(actor:string,warehouse:string,c:Pool|PoolClient,printing=false){
  const user=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active)throw new HttpError(401,'Your access has ended.');
  if(['Admin','Management'].includes(user.role))return;
  const grants=user.role==='Inventory'?(await c.query('SELECT capability FROM inventory_material_access WHERE user_id=$1 AND warehouse=$2',[actor,warehouse])).rows:[];
  if(!grants.some(r=>r.capability==='dispatcher'||printing&&r.capability==='storekeeper'))throw new HttpError(403,printing?'This warehouse document is outside your scope.':'Only the assigned Inventory dispatcher can post warehouse stock.');

}

export async function lockWarehouseAuthority(c:PoolClient,warehouse:string,source:string,version:number){
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.warehouse.authority.'||$1,0))",[warehouse]);
  const row=(await c.query('SELECT * FROM inventory_warehouse_authority_current WHERE warehouse=$1',[warehouse])).rows[0];
  if(!row||row.state!=='active')throw new HttpError(409,'Management must verify and activate this warehouse stock baseline before a physical posting.');
  if(row.source_sha256!==source||row.version!==version)throw new HttpError(409,'The warehouse stock baseline changed. Refresh before posting.');
  return row;

}

export async function warehouseNumber(c:PoolClient,type:'DO'|'PDO'|'IGP',id:string){
 await c.query('SELECT pg_advisory_xact_lock(742019040)');
 const year=Number((await c.query("SELECT extract(year FROM now() AT TIME ZONE 'Asia/Karachi')::integer AS calendar_year")).rows[0].calendar_year);
 const sequence=(await c.query(`INSERT INTO document_sequences(document_type,calendar_year,last_value) VALUES($1,$2,1) ON CONFLICT(document_type,calendar_year) DO UPDATE SET last_value=document_sequences.last_value+1 RETURNING last_value`,[type,year])).rows[0].last_value;
 const number=`CPZ-${type}-${String(year).slice(-2)}-${String(sequence).padStart(4,'0')}`;
 await c.query('INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES($1,$2,$3)',[type,id,number]);return number;
}

