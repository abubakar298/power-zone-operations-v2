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
 return {snapshot:{...structuredClone(row.snapshot),siteCode:correction.snapshot.siteCode,...(correction.snapshot.siteName?{siteName:correction.snapshot.siteName}: {})},originalSnapshot:row.snapshot,siteIdentityCorrection:{id:correction.id,previousSiteCode:correction.snapshot.previousSiteCode,siteCode:correction.snapshot.siteCode,reason:correction.snapshot.reason}};
}
