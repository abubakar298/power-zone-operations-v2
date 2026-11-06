import {allocateManualIpo} from "./manual-ipo.js";
import type {PoolClient} from 'pg';
import {allocateReference} from './references.js';
import {HttpError} from '../http/errors.js';
export async function ipoReference(c:PoolClient,r:any,familyId:string,requested?:string,orderNumber?:string){
 const auth=(await c.query("SELECT h.*,u.role FROM historical_ipo_authorizations h JOIN users u ON u.id=h.approved_by WHERE h.record_id=$1",[r.id])).rows[0];
 if(requested&&auth&&requested.trim()!==auth.number)throw new HttpError(409,'This document already has an authorized historical IPO number.');
 if(requested&&!auth)return allocateManualIpo(c,r,familyId,requested,orderNumber);
 if(!auth)return allocateReference(c,'IPO',familyId,r.customer_id,r.site_code);
 if(!['Admin','Management'].includes(auth.role))throw new HttpError(403,'Historical IPO reference needs Management authorization.');
 await c.query('SELECT pg_advisory_xact_lock(742019040)');
 if((await c.query("SELECT id FROM internal_purchase_orders WHERE lower(number)=lower($1) UNION ALL SELECT family_id FROM document_reference_roots WHERE lower(reference)=lower($1)",[auth.number])).rowCount)throw new HttpError(409,'This historical IPO number is already assigned. Open its existing record.');
 await c.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('IPO',$1,$2)",[familyId,auth.number]);
 return auth.number as string;
}
