import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
import {sourceSiteSchema} from './schema.js';
import {planLiveIpoBridge,type LiveIpoPosition} from './live-ipo-bridge.js';

const inputSchema=z.object({ipoIds:z.array(z.uuid()).min(1).max(10000).optional()}).strict();
const normal=(value:unknown)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toLowerCase():'';
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function approvedHandoffScope(ipoBoqId:unknown,issuanceBoqId:unknown,basis:{id:string;snapshot:any}|null,legacy:{scope:unknown;siteType:unknown;humanSiteType:boolean}){
 if(legacy.scope!==null||typeof ipoBoqId!=='string'||ipoBoqId!==issuanceBoqId||basis?.id!==ipoBoqId)return null;
 const family=basis.snapshot?.survey?.family;
 if(!['solar-hybrid','bess-only','direct-product'].includes(family))return null;
 const scope=family==='direct-product'?'delivery_only':'installation';
 const siteType=legacy.humanSiteType?legacy.siteType:family==='bess-only'?'UPS':family==='solar-hybrid'?'Solar + BESS':legacy.siteType;
 return {boqRevisionId:basis.id,boqSha256:sha(basis.snapshot),family,scope,siteType,preservedHumanSiteType:legacy.humanSiteType};
}
export type LiveIpoSyncResult={created:{ipoId:string;boardSiteId:string;sourceSha256:string}[];retained:{ipoId:string;boardSiteId:string}[];held:{ipoId:string;reason:string;boardSiteIds:string[]}[]};
/** Explicit Management operator command, never a write-on-GET or a new IPO issuer.
 * Existing board decisions are retained; ambiguous identity is a diagnostic hold.
 */
export class OperationsLiveIpoSync {
 constructor(private readonly pool:Pool){}
 async sync(actor:string,raw:unknown={}):Promise<LiveIpoSyncResult>{
  const input=inputSchema.parse(raw);
  return transaction(this.pool,c=>syncInClient(c,actor,input));
 }
}
/** Trusted issuance writers call this inside their existing business transaction.
 * No HTTP handler accepts this authority: the exact persisted issuer is checked.
 * Caller first runs the established scoped legacy-workflow ensure operation.
 */
export async function syncCreatedOperationsHandoff(c:PoolClient,actor:string,raw:{ipoId:string;operationsIssuanceId:string}):Promise<LiveIpoSyncResult>{
 const input=z.object({ipoId:z.uuid(),operationsIssuanceId:z.uuid()}).strict().parse(raw);
 return syncInClient(c,actor,{ipoIds:[input.ipoId]},input);
}
async function syncInClient(c:PoolClient,actor:string,input:z.infer<typeof inputSchema>,trusted?:{ipoId:string;operationsIssuanceId:string}):Promise<LiveIpoSyncResult>{
   await lockActiveActor(c,actor);
   const user=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
   const management=user?.active&&['Admin','Management'].includes(user.role);
   if(trusted){
    const issued=(await c.query('SELECT created_by FROM operations_boq_issuances WHERE id=$1 AND ipo_id=$2',[trusted.operationsIssuanceId,trusted.ipoId])).rows[0];
    if(!issued)return {created:[],retained:[],held:[{ipoId:trusted.ipoId,reason:'The exact saved Operations handoff is unavailable.',boardSiteIds:[]}]};
    if(!management&&issued.created_by!==actor)throw new HttpError(403,'Only the authenticated handoff issuer can sync this saved Operations handoff.');
   }else if(!management)throw new HttpError(403,'Management approval is required to sync Operations IPO handoffs.');
   // Match the existing importer, then freeze immutable source-link decisions.
   // Neither code path acquires these locks in the reverse order.
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.import',0))");
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('material.source.links',0))");
   const rows=(await c.query(`SELECT i.id, to_jsonb(i) AS ipo, to_jsonb(p) AS customer_po, customer.name AS customer_name, customer.id AS customer_id,
    COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM operations_boq_issuances o WHERE o.ipo_id=i.id),'[]'::jsonb) AS issuances,
    (EXISTS(SELECT 1 FROM test_workflow_archives a WHERE a.records->'localPreviewDocumentIds' ? i.id::text) OR EXISTS(SELECT 1 FROM archived_sample_ipos a WHERE a.ipo_id=i.id AND a.restored_at IS NULL)) AS archived
    FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id JOIN customers customer ON customer.id=p.customer_id
    WHERE ($1::uuid[] IS NULL OR i.id=ANY($1::uuid[])) ORDER BY i.created_at,i.id`,[input.ipoIds??null])).rows;
   const boards=(await c.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot,action FROM operations_board_versions ORDER BY site_id,version DESC')).rows;
   const links=(await c.query('SELECT ipo_id,board_site_id FROM inventory_material_source_links')).rows;
   const result:LiveIpoSyncResult={created:[],retained:[],held:[]};
   const hold=(ipoId:string,reason:string,ids:string[]=[])=>result.held.push({ipoId,reason,boardSiteIds:ids});
   if(input.ipoIds)for(const id of new Set(input.ipoIds))if(!rows.some(r=>r.id===id))hold(id,'The exact saved IPO is unavailable.');
   for(const row of rows){
    const ipoId=row.id as string;
    if(row.archived){hold(ipoId,'Archived source records are not imported.');continue;}
    if(row.issuances.length!==1){hold(ipoId,'Exactly one saved Operations handoff is required.');continue;}
    const issuance=row.issuances[0];
    if((await c.query("SELECT 1 FROM test_workflow_archives a WHERE a.records->'localPreviewDocumentIds' ? $1::text",[issuance.id])).rowCount){hold(ipoId,'The saved Operations handoff is archived.');continue;}
    const workflows=(await c.query('SELECT to_jsonb(w) AS value FROM site_workflow w WHERE w.issuance_id=$1 AND w.ipo_id=$2 FOR SHARE',[issuance.id,ipoId])).rows;
    if(workflows.length!==1){hold(ipoId,'Exactly one saved legacy site-workflow position is required.');continue;}
    const w=workflows[0].value,ipo=row.ipo,s=ipo.snapshot;
    const basis=typeof s.boqRevisionId==='string'?(await c.query('SELECT id,snapshot FROM boq_revisions WHERE id=$1',[s.boqRevisionId])).rows[0]??null:null;
    const humanSiteType=(await c.query("SELECT 1 FROM site_workflow_events WHERE workflow_id=$1 AND kind='field_update' AND changes ? 'siteType' LIMIT 1",[w.id])).rowCount!==0;
    const approvedScope=approvedHandoffScope(s.boqRevisionId,issuance.boq_revision_id,basis,{scope:w.scope,siteType:w.site_type,humanSiteType});
    const scope=approvedScope?.scope??w.scope,siteType=approvedScope?.siteType??w.site_type;

    const orderNumber=typeof s.input?.orderNumber==='string'?s.input.orderNumber:'';
    if(normal(issuance.snapshot?.orderNumber)&&normal(issuance.snapshot.orderNumber)!==normal(orderNumber)){hold(ipoId,'Saved IPO and Operations order numbers differ; review their exact identity.');continue;}
    const verifiedLinks=links.map(l=>({ipoId:l.ipo_id as string,boardSiteId:l.board_site_id as string}));
    for(const board of boards){const origin=board.snapshot.origin;
     if(origin?.kind==='live-ipo-handoff'&&origin.ipoId===ipoId&&origin.operationsIssuanceId===issuance.id&&origin.legacyWorkflowId===w.id)verifiedLinks.push({ipoId,boardSiteId:board.site_id});
    }
    const deterministic=boards.find(b=>b.site_id==='live-ipo:'+ipoId);
    if(deterministic&&!verifiedLinks.some(l=>l.ipoId===ipoId&&l.boardSiteId===deterministic.site_id)){
     hold(ipoId,'The deterministic board identity has no matching immutable IPO, issuance and workflow origin.',[deterministic.site_id]);continue;
    }
    const label=normal(ipo.number)+(orderNumber?' · '+normal(orderNumber):'');
    const candidates=boards.filter(b=>normal(b.snapshot.ipo)===label||b.snapshot.origin?.ipoId===ipoId).map(b=>b.site_id as string);
    const position:LiveIpoPosition={ipoId,ipoNumber:ipo.number,orderNumber,customerName:row.customer_name,customerId:row.customer_id,siteName:typeof s.siteName==='string'?s.siteName:'',customerPo:typeof s.input?.poNumber==='string'?s.input.poNumber:'',operationsIssuanceId:issuance.id,createdAt:ipo.created_at,
     legacy:{id:w.id,stage:w.stage,stageEnteredAt:w.stage_entered_at,scope,siteType,deliveredOn:w.delivered_on,installationCompletedOn:w.installation_completed_on,handedOverOn:w.handed_over_on,closedAt:w.closed_at,expectedDelivery:w.expected_delivery}};
    const plan=planLiveIpoBridge(position,{verifiedLinks,boardSites:boards.map(b=>({id:b.site_id,originIpoId:b.snapshot.origin?.ipoId})),unverifiedBoardCandidateIds:candidates});
    if(plan.action==='hold'){hold(ipoId,plan.reason,plan.boardSiteIds);continue;}
    if(plan.action==='retain'){
     const known=boards.find(b=>b.site_id===plan.boardSiteId);
     if(approvedScope&&known?.site_id==='live-ipo:'+ipoId&&known.version===1&&known.action==='Source imported'&&known.snapshot.scopePending===true&&known.snapshot.origin?.ipoId===ipoId&&known.snapshot.origin?.operationsIssuanceId===issuance.id&&known.snapshot.origin?.legacyWorkflowId===w.id){
      await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[known.site_id]);
      const current=(await c.query('SELECT version,snapshot,action FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[known.site_id])).rows[0];
      const activity=(await c.query('SELECT EXISTS(SELECT 1 FROM operations_board_events WHERE site_id=$1) OR EXISTS(SELECT 1 FROM operations_board_files WHERE site_id=$1) AS any',[known.site_id])).rows[0].any;
      if(current.version===1&&current.action==='Source imported'&&current.snapshot.scopePending===true&&!activity){
       const fresh=planLiveIpoBridge(position,{verifiedLinks:[],boardSites:[],unverifiedBoardCandidateIds:[]});
       if(fresh.action==='prepare'){
        const snapshot=sourceSiteSchema.parse({...current.snapshot,stage:fresh.site.stage,completed:fresh.site.completed,evidencePending:fresh.site.evidencePending,installation:fresh.site.installation,scopePending:false,projectType:fresh.site.projectType,approvedScopeBasis:approvedScope,legacyPosition:{...current.snapshot.legacyPosition,scope:w.scope,siteType:w.site_type},reviewFlags:(current.snapshot.reviewFlags??[]).filter((flag:string)=>!['Verify approved installation/delivery-only scope.','Verify approved project type.'].includes(flag))});
        await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,2,$2,$3,$4,$5,$6)',[known.site_id,snapshot,'Approved source scope confirmed','Exact saved approved BOQ family; original legacy scope and type retained.',randomUUID(),actor]);
        await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'operations.board.approved-scope:'+known.site_id+':'+approvedScope.boqRevisionId]);
        known.version=2;known.snapshot=snapshot;known.action='Approved source scope confirmed';
       }
      }
     }
     result.retained.push({ipoId,boardSiteId:plan.boardSiteId});continue;
    }
    if(issuance.snapshot?.bulkHistoricalImport===true||s.historicalImport){hold(ipoId,'Historical bulk handoffs require their reviewed immutable site link; no duplicate site was created.');continue;}
    const sourceSha256=sha({ipo,operationsIssuance:issuance,legacyWorkflow:w});
    const snapshot=sourceSiteSchema.parse({...plan.site,
     origin:{...(plan.site.origin as Record<string,unknown>),sourceSha256},
     legacyPosition:{...(plan.site.legacyPosition as Record<string,unknown>),scope:w.scope,siteType:w.site_type},
     ...(approvedScope?{approvedScopeBasis:approvedScope}:{}),
     // Preserve legitimate source IDs, without presenting them as signed QC evidence.
     legacySourceReferences:{ipoId,operationsIssuanceId:issuance.id,legacyWorkflowId:w.id,boqRevisionId:issuance.boq_revision_id,customerPoDocumentId:row.customer_po.document_id??null},
    });
    await c.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[plan.boardSiteId,actor]);
    await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',[plan.boardSiteId,snapshot,'Source imported',sourceSha256,randomUUID(),actor]);
    boards.push({site_id:plan.boardSiteId,version:1,snapshot});
    result.created.push({ipoId,boardSiteId:plan.boardSiteId,sourceSha256});
   }
   if(result.created.length)await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'operations.board.live-ipo-sync:'+sha(result.created)]);
   return result;

}
