import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';
/** Explicit Director correction only; original immutable IPO stays available. */
export async function ipoSiteIdentity(pool:Pool|PoolClient,row:any){
 const correction=(await pool.query("SELECT d.id,d.snapshot,u.role FROM project_workflow_documents d JOIN users u ON u.id=d.created_by WHERE d.kind IN ('IPO branch code correction','IPO site identity correction') AND d.snapshot->>'ipoId'=$1 ORDER BY d.created_at DESC,d.version DESC LIMIT 1",[row.id])).rows[0];
 return applyIpoSiteIdentity(row,correction);
}
/** Shared validation for single-record and batched read projections. */
export function applyIpoSiteIdentity(row:any,correction:any){
 if(!correction)return {};
 const hash=createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex');
 if(!['Admin','Management'].includes(correction.role)||correction.snapshot.originalFingerprint!==hash||correction.snapshot.previousSiteCode!==row.snapshot.siteCode)throw new HttpError(409,'IPO branch-code correction requires review.');
 if(correction.snapshot.siteName!==undefined&&(correction.snapshot.previousSiteName!==row.snapshot.siteName||typeof correction.snapshot.siteName!=='string'||!correction.snapshot.siteName.trim()))throw new HttpError(409,'IPO site-name correction requires review.');
 const input={...row.snapshot.input};
 for(const field of ['poNumber','orderNumber'])if(correction.snapshot[field]!==undefined){
  const previous=field==='poNumber'?'previousPoNumber':'previousOrderNumber',value=correction.snapshot[field];
  if(correction.snapshot[previous]!==row.snapshot.input?.[field]||typeof value!=='string'||!value.trim()||field==='orderNumber'&&!/^[1-9][0-9]{0,5}\/[1-9][0-9]{0,5}$/.test(value))throw new HttpError(409,'IPO PO/order correction requires review.');
  if(field==='poNumber'&&row.saved_po_reference!==undefined&&correction.snapshot.previousSavedPoReference!==row.saved_po_reference)throw new HttpError(409,'IPO saved PO correction requires review.');
  input[field]=value;
 }
 return {approvedPoReference:correction.snapshot.poNumber,snapshot:{...structuredClone(row.snapshot),input,siteCode:correction.snapshot.siteCode,...(correction.snapshot.siteName?{siteName:correction.snapshot.siteName}: {})},originalSnapshot:row.snapshot,siteIdentityCorrection:{id:correction.id,previousSiteCode:correction.snapshot.previousSiteCode,siteCode:correction.snapshot.siteCode,reason:correction.snapshot.reason}};
}
