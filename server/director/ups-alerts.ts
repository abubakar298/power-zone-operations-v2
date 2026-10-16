import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';

const schema=z.object({programKey:z.string().min(1),expectedVersion:z.number().int().positive(),notes:z.string().trim().min(1),sites:z.array(z.object({orderNumber:z.string().regex(/^\d+\/\d+$/),evidenceSiteName:z.string().trim().max(1000).default(''),reason:z.string().trim().min(1).max(1000),nextAction:z.string().trim().min(1).max(1000),followUpDate:z.iso.date().nullable().default(null)}).strict()).min(1)}).strict();

/** Append reporting flags only. Delivery does not constitute installation or closure. */
export async function flagUpsInstallations(pool:Pool,actor:string,raw:unknown){
 const input=schema.parse(raw);
 return transaction(pool,async c=>{
  const user=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active||!['Management','Admin'].includes(user.role))throw new HttpError(403,'Management approval is required.');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.programKey]);
  const previous=(await c.query('SELECT version,customer_code,snapshot FROM ups_management_program_versions WHERE program_key=$1 ORDER BY version DESC LIMIT 1',[input.programKey])).rows[0];
  const register=previous?.snapshot.managementRegister;
  if(!register||previous.customer_code!=='UBL')throw new HttpError(422,'Select an existing UBL UPS register.');
  const seen=new Set<string>(),old=register.installationAlerts??{};
  for(const s of input.sites){
   if(seen.has(s.orderNumber)||!register.sites.some((r:any)=>r.orderNumber===s.orderNumber))throw new HttpError(422,'Flag must match one existing order position.');
   if(register.completionApprovals?.[s.orderNumber])throw new HttpError(409,'This site is already approved closed; review its closure before flagging installation.');
   seen.add(s.orderNumber);
  }
  const additions=input.sites.filter(s=>{const saved=old[s.orderNumber];if(!saved)return true;if(!isDeepStrictEqual({orderNumber:saved.orderNumber,evidenceSiteName:saved.evidenceSiteName??'',reason:saved.reason,nextAction:saved.nextAction,followUpDate:saved.followUpDate},s))throw new HttpError(409,'This site already has different saved alert details.');return false;});
  if(!additions.length)return{programKey:input.programKey,version:previous.version,flagged:0,unchanged:input.sites.length};
  if(previous.version!==input.expectedVersion)throw new HttpError(409,'The register changed; review its latest version before flagging.');
  const snapshot=structuredClone(previous.snapshot),alerts={...old},flaggedAt=new Date().toISOString();
  for(const s of additions)alerts[s.orderNumber]={...s,status:'Delivered — installation pending',flaggedBy:actor,flaggedAt};
  snapshot.managementRegister.installationAlerts=alerts;
  const version=previous.version+1;
  await c.query('INSERT INTO ups_management_program_versions(id,program_key,version,customer_code,snapshot,notes,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),input.programKey,version,previous.customer_code,snapshot,input.notes,actor]);
  await c.query('INSERT INTO audit_log(user_id,action)VALUES($1,$2)',[actor,`ups.installation-alerts:${input.programKey}:v${version}:${additions.map(s=>s.orderNumber).join(',')}:${input.notes}`]);
  return{programKey:input.programKey,version,flagged:additions.length,unchanged:input.sites.length-additions.length};
 });
}

/** Operations receives operational alert fields only, never the imported costing ledger. */
export async function upsInstallationAlerts(pool:Pool,actor:string){
 const user=(await pool.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
 if(!user?.active||!['Management','Admin','Operations'].includes(user.role))throw new HttpError(403,'Management or Operations access is required.');
 const programs=(await pool.query(`SELECT DISTINCT ON(program_key) program_key,snapshot#>'{managementRegister,sites}' AS sites,snapshot#>'{managementRegister,installationAlerts}' AS alerts,snapshot#>'{managementRegister,completionApprovals}' AS completions,snapshot#>>'{managementRegister,configuration}' AS configuration,snapshot#>>'{managementRegister,projectReference}' AS reference FROM ups_management_program_versions WHERE customer_code='UBL' ORDER BY program_key,version DESC`)).rows;
 const rows=programs.flatMap(p=>Object.values(p.alerts??{}).filter((a:any)=>!p.completions?.[a.orderNumber]).map((a:any)=>{const s=(p.sites??[]).find((s:any)=>s.orderNumber===a.orderNumber);return{id:`${p.program_key}:${a.orderNumber}`,customer:'UBL',configuration:p.configuration,projectReference:p.reference,orderNumber:a.orderNumber,ipoNumber:s?.ipoNumber||p.reference,siteName:s?.siteName||a.evidenceSiteName||'',evidenceSiteName:a.evidenceSiteName||'',siteCode:s?.siteCode||'',status:a.status,reason:a.reason,nextAction:a.nextAction,followUpDate:a.followUpDate,flaggedAt:a.flaggedAt};}));
 rows.sort((a,b)=>a.projectReference.localeCompare(b.projectReference)||Number(a.orderNumber.split('/')[0])-Number(b.orderNumber.split('/')[0]));
 return{rows,total:rows.length};
}
