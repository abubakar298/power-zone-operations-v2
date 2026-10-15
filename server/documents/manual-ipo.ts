import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
export const manualIpoSchema=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9 _./()-]*$/,'Use letters, numbers, spaces or reference separators.').transform(value=>/^\d+$/.test(value)?`CHP-${value}`:value.replace(/^CHP[ -]?(\d+)$/i,'CHP-$1'));
export async function manualIpoAvailable(c:Pool|PoolClient,number:string,recordId?:string){
 const value=manualIpoSchema.parse(number);
 const found=(await c.query(`SELECT 1 FROM internal_purchase_orders WHERE lower(number)=lower($1)
 UNION ALL SELECT 1 FROM document_reference_roots WHERE lower(reference)=lower($1)
 UNION ALL SELECT 1 FROM historical_ipo_authorizations WHERE lower(number)=lower($1) AND ($2::uuid IS NULL OR record_id<>$2::uuid)
 UNION ALL SELECT 1 FROM ubl_site_orders WHERE lower(legacy_ipo_number)=lower($1) OR lower('CHP-'||legacy_ipo_number)=lower($1) LIMIT 1`,[value,recordId??null])).rowCount;
 return !found;
}
export function requireDirectUps(r:any){
 if(r.route!=='direct-framework'||!['MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10'].includes(r.data?.basis?.source?.key))throw new HttpError(422,'Manual IPO numbering is available only for the dedicated Direct PO UPS agreements.');
}
export async function allocateManualIpo(c:PoolClient,r:any,familyId:string,number:string){
 requireDirectUps(r);
 const value=manualIpoSchema.parse(number);
 await c.query('SELECT pg_advisory_xact_lock(742019040)');
 if(!await manualIpoAvailable(c,value,r.id))throw new HttpError(409,'This IPO number is already in use. Enter a different number or select automatic numbering.');
 await c.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES('IPO',$1,$2)",[familyId,value]);
 return value;
}
