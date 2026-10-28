import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Pool} from 'pg';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {sourceSiteSchema,targetsSchema} from './schema.js';

const blocker=z.object({id:z.string().min(1),reason:z.string().min(1).max(2000),stage:z.string(),status:z.enum(['open','resolved']),raisedAt:z.iso.datetime(),raisedBy:z.string(),actorId:z.string()}).passthrough();
const checkpoint=z.object({format:z.literal('powerzone.operations.browser-checkpoint.v1'),exportedAt:z.iso.datetime(),storage:z.record(z.string(),z.string()),files:z.array(z.unknown())});
/** A deliberately narrow operator import. Archived test progress and its files
 * remain in the private checkpoint; they must never become delivery evidence. */
export function prepareBrowserDecisions(bytes:Buffer,sha256:string,frozenRows:unknown[]){
 if(!/^[a-f0-9]{64}$/.test(sha256)||createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Browser checkpoint fingerprint changed.');
 const saved=checkpoint.parse(JSON.parse(bytes.toString())),rows=z.array(sourceSiteSchema).parse(JSON.parse(saved.storage['powerzone.operations.preview.v1']??'null'));
 const originals=new Map(z.array(sourceSiteSchema).parse(frozenRows).map(s=>[s.id,s]));
 if(rows.length!==originals.size||new Set(rows.map(s=>s.id)).size!==rows.length||rows.some(s=>!originals.has(s.id)))throw Error('Browser and frozen site identities differ.');
 const decisions=rows.filter(s=>Array.isArray(s.blockers)&&s.blockers.length).map(s=>{
  const original=originals.get(s.id);if(!original)throw Error('Unknown browser site identity.');
  for(const key of ['ipo','stage','installation','projectType','deliveryDate'] as const)if(!isDeepStrictEqual(s[key],original[key]))throw Error('Source positioning changed; review before importing decisions.');
  if(Boolean(s.completed)!==Boolean(original.completed))throw Error('Completion differs; review before importing decisions.');
  const blockers=z.array(blocker).parse(s.blockers);if(new Set(blockers.map(b=>b.id)).size!==blockers.length)throw Error('Duplicate blocker identity.');
  return {id:s.id,blockers};
 });
 const settings=JSON.parse(saved.storage['powerzone.operations.targets.v1']??'null');
 const values=targetsSchema.shape.values.parse(settings?.values);
 return {sha256,exportedAt:saved.exportedAt,decisions,values,preservedFiles:saved.files.length};
}

/** No HTTP route. Caller supplies the fingerprint-verified frozen source.
 * Only immutable import versions are appended; no live movement is posted and
 * no historical notification is re-sent. Concurrent decisions abort the batch. */
export async function importBrowserDecisions(pool:Pool,actor:string,plan:ReturnType<typeof prepareBrowserDecisions>,frozenSha256:string){
 return transaction(pool,async c=>{
  const user=(await c.query('SELECT role,active FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Management approval is required for checkpoint imports.');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.import',0))");
  let imported=0,retained=0;
  for(const decision of [...plan.decisions].sort((a,b)=>a.id.localeCompare(b.id))){
   await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[decision.id]);
   const current=(await c.query('SELECT version,snapshot,action,reason FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[decision.id])).rows[0];
   if(current?.snapshot.browserCheckpoint?.sha256===plan.sha256){if(!isDeepStrictEqual(current.snapshot.blockers,decision.blockers))throw new HttpError(409,'Imported decisions changed; review is required.');retained++;continue;}
   if(current?.version!==1||current.action!=='Source imported'||current.reason!==frozenSha256)throw new HttpError(409,'A site has newer decisions; the checkpoint import was not applied.');
   const snapshot={...current.snapshot,blockers:decision.blockers,browserCheckpoint:{sha256:plan.sha256,exportedAt:plan.exportedAt}};
   await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[decision.id,2,snapshot,'Browser decisions imported','Preserved accepted blocker reasons from fingerprint-verified local checkpoint',randomUUID(),actor]);imported++;
  }
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.targets',0))");
  const targets=(await c.query('SELECT version,values FROM operations_board_target_versions ORDER BY version DESC LIMIT 1')).rows[0];
  if(targets&&!isDeepStrictEqual(targets.values,plan.values))throw new HttpError(409,'Stage targets have changed; checkpoint import was not applied.');
  if(!targets)await c.query('INSERT INTO operations_board_target_versions(version,values,request_key,request_sha256,reason,created_by) VALUES(1,$1,$2,$3,$4,$5)',[plan.values,randomUUID(),plan.sha256,'Preserved configured stage targets from browser checkpoint '+plan.sha256,actor]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`operations.board.browser-import:${plan.sha256}:${imported}`]);
  return {imported,retained,targetsImported:!targets,notificationEventsCreated:0,financialOrStockPostingsCreated:false};
 });
}
