import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {validOrderPosition} from '../../shared/direct-po-reading.js';
export const manualIpoSchema=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9 _./()-]*$/,'Use letters, numbers, spaces or reference separators.').transform(value=>/^\d+$/.test(value)?`CHP-${value}`:value.replace(/^CHP[ -]?(\d+)$/i,'CHP-$1'));
const upsKeys=['MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10'];
type UpsContext={customerId:number;configurationKey:string};
export const ipoNumberConflict='This IPO number is already in use. For a shared UPS IPO, enter a different order unit with the same batch total; otherwise use a different IPO number.';
export async function manualIpoAvailable(c:Pool|PoolClient,number:string,recordId?:string,orderNumber?:string,context?:UpsContext){
 const value=manualIpoSchema.parse(number);
 if(recordId){
  const r=(await c.query('SELECT customer_id,route,data FROM project_workflow_records WHERE id=$1',[recordId])).rows[0];
  context=r?.route==='direct-framework'?{customerId:r.customer_id,configurationKey:r.data?.basis?.source?.key}:undefined;
  orderNumber??=r?.data?.directPoDetails?.values?.orderNumber;
 }
 const issued=(await c.query('SELECT i.id,i.snapshot,p.customer_id FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id WHERE lower(i.number)=lower($1)',[value])).rows;
 const shared=!!context&&upsKeys.includes(context.configurationKey)&&!!orderNumber&&validOrderPosition(orderNumber);
 if(issued.length&&!issued.every(row=>shared&&row.customer_id===context!.customerId&&upsKeys.includes(row.snapshot.approvedCommercialSource?.key)&&validOrderPosition(row.snapshot.input?.orderNumber??'')&&row.snapshot.input.orderNumber.split('/')[0]!==orderNumber!.split('/')[0]&&row.snapshot.input.orderNumber.split('/')[1]===orderNumber!.split('/')[1]))return false;
 const roots=(await c.query('SELECT document_type,family_id FROM document_reference_roots WHERE lower(reference)=lower($1)',[value])).rows;
 if(roots.some(root=>root.document_type!=='IPO'||!issued.some(row=>row.id===root.family_id)))return false;
 const reserved=(await c.query(`SELECT 1 FROM historical_ipo_authorizations WHERE lower(number)=lower($1) AND ($2::uuid IS NULL OR record_id<>$2::uuid)
 UNION ALL SELECT 1 FROM ubl_site_orders WHERE lower(legacy_ipo_number)=lower($1) OR lower('CHP-'||legacy_ipo_number)=lower($1) LIMIT 1`,[value,recordId??null])).rowCount;
 return !reserved;
}
export function requireDirectUps(r:any){
 if(r.route!=='direct-framework'||!upsKeys.includes(r.data?.basis?.source?.key))throw new HttpError(422,'Manual IPO numbering is available only for the dedicated Direct PO UPS agreements.');
}
export function requireEditableIpoRoute(r:any){
 if(!['survey-quote','quick-quote','survey-framework','direct-framework'].includes(r.route))throw new HttpError(422,'Manual IPO numbering is unavailable for this workflow.');
}
export async function allocateEditableIpo(c:PoolClient,familyId:string,number:string,recordId?:string,orderNumber?:string){
 const value=manualIpoSchema.parse(number);
 await c.query('SELECT pg_advisory_xact_lock(742019040)');
 if(!await manualIpoAvailable(c,value,recordId,orderNumber))throw new HttpError(409,ipoNumberConflict);
 const existing=(await c.query("SELECT 1 FROM document_reference_roots WHERE document_type='IPO' AND lower(reference)=lower($1)",[value])).rowCount;
 if(existing)await c.query("INSERT INTO document_reference_aliases(document_type,family_id,reference) SELECT 'IPO',$1,reference FROM document_reference_roots WHERE document_type='IPO' AND lower(reference)=lower($2)",[familyId,value]);
 else await c.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('IPO',$1,$2)",[familyId,value]);
 return value;
}
export async function allocateManualIpo(c:PoolClient,r:any,familyId:string,number:string,orderNumber?:string){
 requireEditableIpoRoute(r);return allocateEditableIpo(c,familyId,number,r.id,orderNumber);
}
