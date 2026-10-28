import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
import {MaterialDraftRepository} from './material-drafts.js';
import {MaterialUsageRepository} from './material-usage.js';
export class ParentReconciliationRepository{
 constructor(private pool:Pool){}
 async read(actor:string,id:string,c:Pool|PoolClient=this.pool){const data=await new MaterialUsageRepository(this.pool).read(actor,id,c);if(!data.draft.snapshot.parent)throw new HttpError(422,'Select a Parent DO.');const history=(await c.query('SELECT version,status,snapshot,created_at FROM inventory_parent_reconciliation_versions WHERE draft_id=$1 ORDER BY version DESC',[id])).rows;const role=(await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0]?.role;return {...data,state:history[0]??{version:0,status:'waiting'},history,management:['Admin','Management'].includes(role)};}
 async change(actor:string,value:unknown){
  const p=z.object({id:z.uuid(),version:z.number().int().nonnegative(),draftVersion:z.number().int().positive(),action:z.enum(['close','review','return','accept-variance']),reason:z.string().trim().min(3).max(2000),requestKey:z.uuid()}).strict().safeParse(value);if(!p.success)throw new HttpError(422,'Check the reconciliation action and reason.');const v=p.data,hash=createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return transaction(this.pool,async c=>{await lockActiveActor(c,actor);await c.query('SELECT id FROM inventory_material_drafts WHERE id=$1 FOR UPDATE',[v.id]);const data=await this.read(actor,v.id,c);const replay=(await c.query('SELECT version,status,request_fingerprint FROM inventory_parent_reconciliation_versions WHERE request_key=$1',[v.requestKey])).rows[0];if(replay){if(replay.request_fingerprint!==hash)throw new HttpError(409,'This request belongs to another decision.');return replay;}
   if(['close','accept-variance'].includes(v.action)&&(await c.query("SELECT 1 FROM inventory_signed_dispatch_pending p JOIN inventory_material_dispatches d ON d.id=p.document_id WHERE p.document_kind='dispatch' AND d.draft_id=$1 AND NOT EXISTS(SELECT 1 FROM inventory_signed_dispatch_postings z WHERE z.document_kind=p.document_kind AND z.document_id=p.document_id)",[v.id])).rowCount)throw new HttpError(409,'Upload the pending signed gate copies before closing this Parent DO.');
   if(data.state.version!==v.version||data.draft.version!==v.draftVersion)throw new HttpError(409,'This reconciliation changed. Refresh before deciding.');if(data.state.status==='closed')throw new HttpError(409,'This Parent DO is already closed.');
   if((v.action==='return'||v.action==='accept-variance')&&!data.management)throw new HttpError(403,'Management must decide this variance.');
   if((v.action==='return'||v.action==='accept-variance')&&data.state.status!=='management-review')throw new HttpError(409,'Send this Parent DO for management review first.');
   if(v.action==='close'&&!data.reconciliation?.ready)throw new HttpError(409,'Usage, verified warehouse returns or evidence are still unresolved. Send the difference to Management.');
   const status=v.action==='close'||v.action==='accept-variance'?'closed':v.action==='review'?'management-review':'waiting',version=data.state.version+1;
   const snapshot={action:v.action,reason:v.reason,draftVersion:data.draft.version,reconciliation:data.reconciliation,usageVersions:data.reports.map((r:any)=>({site:r.site_id,version:r.version})),stockPosting:false,varianceAccepted:v.action==='accept-variance'};
   await c.query('INSERT INTO inventory_parent_reconciliation_versions(draft_id,version,status,snapshot,request_key,request_fingerprint,actor_id)VALUES($1,$2,$3,$4,$5,$6,$7)',[v.id,version,status,snapshot,v.requestKey,hash,actor]);return {version,status,stockPosting:false};
  });
 }
}
