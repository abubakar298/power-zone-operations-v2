import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {ipoSiteIdentity,applyIpoSiteIdentity} from '../orders/site-identity.js';
import {checkMaterialSourceLink} from './source-link-policy.js';
export const materialSourceLinkSchema=z.object({boardSiteId:z.string().min(1).max(160),boardVersion:z.number().int().positive(),ipoId:z.uuid(),reason:z.string().trim().min(1).max(2000),requestKey:z.uuid()}).strict();
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function approvedMaterialIdentity(c:Pool|PoolClient,ipoId:string){
 const ipo=(await c.query('SELECT i.id,i.number,i.snapshot,p.po_number AS saved_po_reference FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id WHERE i.id=$1',[ipoId])).rows[0];
 if(!ipo)throw new HttpError(409,'The approved IPO is unavailable.');
 if((await c.query("SELECT 1 FROM test_workflow_archives WHERE records->'localPreviewDocumentIds' ? $1::text UNION ALL SELECT 1 FROM archived_sample_ipos WHERE ipo_id=$1::uuid AND restored_at IS NULL",[ipoId])).rowCount)throw new HttpError(409,'This IPO is archived.');
 const correction=await ipoSiteIdentity(c,ipo);if(correction.snapshot)ipo.snapshot=correction.snapshot;
 const po=(value:unknown)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toLowerCase():'';
 if(po(ipo.snapshot.input?.poNumber)&&po(ipo.snapshot.input.poNumber)!==po(ipo.saved_po_reference))throw new HttpError(409,'Approved IPO identity needs review: po-mismatch with its saved customer PO reference.');
 return ipo;
}
/** Request-local bulk read only. Each link still receives the original archive,
 * Director-correction and saved-PO checks; no result is cached across requests. */
export async function approvedMaterialIdentities(c:Pool|PoolClient,ipoIds:string[]){
 const ids=[...new Set(ipoIds)],result=new Map<string,any>();if(!ids.length)return result;
 const rows=(await c.query(`SELECT i.id,i.number,i.snapshot,p.po_number AS saved_po_reference,
  (EXISTS(SELECT 1 FROM test_workflow_archives a WHERE a.records->'localPreviewDocumentIds' ? i.id::text)
   OR EXISTS(SELECT 1 FROM archived_sample_ipos a WHERE a.ipo_id=i.id AND a.restored_at IS NULL)) AS archived
  FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id WHERE i.id=ANY($1::uuid[])`,[ids])).rows;
 const corrections=(await c.query(`SELECT DISTINCT ON(d.snapshot->>'ipoId') d.id,d.snapshot,u.role
  FROM project_workflow_documents d JOIN users u ON u.id=d.created_by
  WHERE d.kind IN ('IPO branch code correction','IPO site identity correction') AND d.snapshot->>'ipoId'=ANY($1::text[])
  ORDER BY d.snapshot->>'ipoId',d.created_at DESC,d.version DESC`,[ids])).rows;
 const correctionsById=new Map(corrections.map(r=>[r.snapshot.ipoId,r]));
 for(const row of rows){try{
  if(row.archived)throw new HttpError(409,'This IPO is archived.');
  const ipo={id:row.id,number:row.number,snapshot:row.snapshot,saved_po_reference:row.saved_po_reference};
  const correction=applyIpoSiteIdentity(ipo,correctionsById.get(row.id));if(correction.snapshot)ipo.snapshot=correction.snapshot;
  const po=(value:unknown)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toLowerCase():'';
  if(po(ipo.snapshot.input?.poNumber)&&po(ipo.snapshot.input.poNumber)!==po(ipo.saved_po_reference))throw new HttpError(409,'Approved IPO identity needs review: po-mismatch with its saved customer PO reference.');
  result.set(row.id,ipo);
 }catch(error){if(error instanceof HttpError&&error.status===409)result.set(row.id,error);else throw error;}}
 return result;
}
type SourceLinkInput=z.infer<typeof materialSourceLinkSchema>;
async function writeMaterialSource(c:PoolClient,actor:string,input:SourceLinkInput){
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('material.source.links',0))");
  const replay=(await c.query('SELECT * FROM inventory_material_source_links WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.created_by!==actor||replay.request_sha256!==sha(input))throw new HttpError(409,'This request key belongs to another source link.');return {id:replay.id,unchanged:true};}
  await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR SHARE',[input.boardSiteId]);
  const board=(await c.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[input.boardSiteId])).rows[0];
  if(!board||board.version!==input.boardVersion)throw new HttpError(409,'The imported site changed. Review its latest positioning first.');
  const ipo=await approvedMaterialIdentity(c,input.ipoId),s=ipo.snapshot;
  const check=checkMaterialSourceLink({...board.snapshot,id:input.boardSiteId},[{id:ipo.id,number:ipo.number,orderNumber:s.input?.orderNumber??'',poNumber:s.input?.poNumber??'',siteName:s.siteName??''}]);
  if(check.status!=='eligible')throw new HttpError(409,'Imported IPO identity needs review: '+check.status+'. No source link was created.');
  const boq=(await c.query('SELECT id,snapshot FROM boq_revisions WHERE id=$1',[s.boqRevisionId])).rows[0];
  if(!boq||!Array.isArray(boq.snapshot.lines))throw new HttpError(409,'This IPO has no saved approved BOQ basis.');
  if((await c.query('SELECT 1 FROM inventory_material_source_links WHERE board_site_id=$1 OR ipo_id=$2',[input.boardSiteId,input.ipoId])).rowCount)throw new HttpError(409,'This site or IPO already has an immutable source link.');
  const id=randomUUID();
  await c.query('INSERT INTO inventory_material_source_links(id,board_site_id,board_version,ipo_id,boq_revision_id,board_sha256,ipo_sha256,boq_sha256,reason,request_key,request_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,input.boardSiteId,board.version,ipo.id,boq.id,sha(board.snapshot),sha(s),sha(boq.snapshot),input.reason,input.requestKey,sha(input),actor]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.material.source-link:'+id]);return {id,unchanged:false};
}
/** Operator-only importer. There is deliberately no arbitrary browser link API. */
export async function linkMaterialSource(pool:Pool,actor:string,raw:SourceLinkInput,client?:PoolClient){
 const input=materialSourceLinkSchema.parse(raw);
 const execute=async(c:PoolClient)=>{
  await lockActiveActor(c,actor);
  const user=(await c.query('SELECT role,active FROM users WHERE id=$1',[actor])).rows[0];
  if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Management approval is required to link imported IPO identities.');
  return writeMaterialSource(c,actor,input);
 };
 return client?execute(client):transaction(pool,execute);
}
export type CreatedMaterialSourceResult={status:'linked'|'retained';id:string}|{status:'held';reason:string};
/** Trusted handoff continuation only; public operator authority is never widened. */
export async function linkCreatedOperationsMaterialSource(c:PoolClient,actor:string,raw:{boardSiteId:string;ipoId:string;operationsIssuanceId:string}):Promise<CreatedMaterialSourceResult>{
 const input=z.object({boardSiteId:z.string().min(1).max(160),ipoId:z.uuid(),operationsIssuanceId:z.uuid()}).strict().parse(raw);
 const user=await lockActiveActor(c,actor);
 const handoff=(await c.query('SELECT o.created_by,o.snapshot AS operations_snapshot,i.snapshot AS ipo_snapshot FROM operations_boq_issuances o JOIN internal_purchase_orders i ON i.id=o.ipo_id WHERE o.id=$1 AND o.ipo_id=$2',[input.operationsIssuanceId,input.ipoId])).rows[0];
 if(!handoff)return {status:'held',reason:'The exact saved Operations handoff is unavailable.'};
 if(!['Admin','Management'].includes(user.role)&&handoff.created_by!==actor)throw new HttpError(403,'Only the authenticated handoff issuer can link this saved Operations source.');
 if(handoff.operations_snapshot?.bulkHistoricalImport===true||handoff.ipo_snapshot?.historicalImport)return {status:'held',reason:'Historical handoffs require their reviewed immutable source link.'};
 if((await c.query("SELECT 1 FROM test_workflow_archives WHERE records->'localPreviewDocumentIds' ? $1::text OR records->'localPreviewDocumentIds' ? $2::text UNION ALL SELECT 1 FROM archived_sample_ipos WHERE ipo_id=$1::uuid AND restored_at IS NULL",[input.ipoId,input.operationsIssuanceId])).rowCount)return {status:'held',reason:'Archived source records are not linked.'};
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.import',0))");
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('material.source.links',0))");
 await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR SHARE',[input.boardSiteId]);
 const board=(await c.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[input.boardSiteId])).rows[0];
 if(!board||board.snapshot.origin?.kind!=='live-ipo-handoff'||board.snapshot.origin?.ipoId!==input.ipoId||board.snapshot.origin?.operationsIssuanceId!==input.operationsIssuanceId)return {status:'held',reason:'The Operations board has no exact saved handoff origin.'};
 try{
  const ipo=await approvedMaterialIdentity(c,input.ipoId),basis=(await c.query('SELECT id,snapshot FROM boq_revisions WHERE id=$1',[ipo.snapshot.boqRevisionId])).rows[0];
  const existing=(await c.query('SELECT * FROM inventory_material_source_links WHERE board_site_id=$1 OR ipo_id=$2',[input.boardSiteId,input.ipoId])).rows;
  if(existing.length){const link=existing[0];if(existing.length!==1||link.board_site_id!==input.boardSiteId||link.ipo_id!==input.ipoId||!basis||link.boq_revision_id!==basis.id||link.ipo_sha256!==sha(ipo.snapshot)||link.boq_sha256!==sha(basis.snapshot))return {status:'held',reason:'The saved material source identity or approved BOQ basis differs; review its immutable link.'};return {status:'retained',id:link.id};}
  const result=await writeMaterialSource(c,actor,{boardSiteId:input.boardSiteId,boardVersion:board.version,ipoId:input.ipoId,reason:'Exact approved IPO and Operations handoff continued to Inventory; no stock or Store document posted.',requestKey:randomUUID()});
  return {status:result.unchanged?'retained':'linked',id:result.id};
 }catch(error){
  if(error instanceof HttpError&&error.status===409&&[/^The approved IPO is unavailable\./,/^This IPO is archived\./,/^Approved IPO identity needs review: po-mismatch/, /^The imported site changed\./,/^Imported IPO identity needs review:/,/^This IPO has no saved approved BOQ basis\./,/^This site or IPO already has an immutable source link\./].some(pattern=>pattern.test(error.message)))return {status:'held',reason:error.message};
  throw error;
 }
}
