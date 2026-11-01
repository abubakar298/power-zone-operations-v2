import {dispatchReconciliationEligibleSql} from './dispatch-reconciliation-eligibility.js';
import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import type {DispatchDocument,DispatchDocumentRow} from '../../shared/dispatch-document-status.js';
type Db=Pool|PoolClient;
type Dispatch={id:string;number:string;draft_id:string;warehouse:string;created_at:string;snapshot:any;retrospective?:boolean};
type Board={site_id:string;snapshot:any};
type Copy={document_id:string;source_site_id:string|null;copy_kind:string;evidence_id:string};
type File={id:string;site_id:string;created_at:string};
type Usage={draft_id:string;site_id:string;created_at:string;snapshot:any;evidence_warehouse?:string};
const instant=(v:string)=>new Date(v).getTime();
/** Only exact registered/native IPO identity; shared UPS PO numbers and names are never joins. */
export function dispatchBoard(site:any,boards:Board[]){
 const matches=boards.filter(b=>site.registeredSiteId?b.site_id===site.registeredSiteId:b.snapshot.origin?.ipoId===site.siteId);
 return matches.length===1?matches[0]:undefined;
}
export function dispatchDocumentRows(dispatches:Dispatch[],boards:Board[],copies:Copy[],files:File[],usage:Usage[],closed:Set<string>=new Set()):DispatchDocumentRow[]{
 const siteDispatches=new Map<string,Dispatch[]>();
 for(const d of dispatches)if(!d.snapshot.parent)for(const s of d.snapshot.sites??[]){const key=s.siteId;siteDispatches.set(key,[...(siteDispatches.get(key)??[]),d]);}
 return dispatches.filter(d=>!closed.has(d.draft_id)).map(d=>{
  const lines=(d.snapshot.lines??[]).filter((l:any)=>Number(l.out??l.quantity)>0);
  const sites=(d.snapshot.sites??[]).filter((s:any)=>lines.some((l:any)=>l.sites?.includes(s.siteId))).map((s:any)=>{
   const board=dispatchBoard(s,boards),b=board?.snapshot;
   const qcFile=(ref:any,fresh=false)=>ref?.id&&files.some(f=>f.id===ref.id&&f.site_id===board?.site_id&&(!fresh||d.retrospective||instant(f.created_at)>=instant(d.created_at)))?{fileId:ref.id as string,source:'qc' as const,boardId:board!.site_id}:undefined;
   const copy=(kind:string)=>copies.find(c=>c.document_id===d.id&&c.copy_kind===kind&&(kind!=='customer-signoff'||c.source_site_id===s.siteId));
   const documents:DispatchDocument[]=[];
   if(!d.snapshot.parent&&!d.retrospective){
    const own=copy('signed-customer');
    const deliveries=b?.deliveries??[],explicit=deliveries.filter((v:any)=>v.dispatchId===d.id),legacy=deliveries.filter((v:any)=>!v.dispatchId);
    const candidate=explicit.length===1?explicit[0]:!explicit.length&&siteDispatches.get(s.siteId)?.length===1&&legacy.length===1?legacy[0]:undefined;
    const historical=b?.documents?.find((v:any)=>v.id===`${board?.site_id}:historical-delivery-documents`);
    const received=own?{fileId:own.evidence_id,source:'warehouse' as const}:qcFile(candidate?.signedDo,!candidate?.dispatchId)??(siteDispatches.get(s.siteId)?.length===1&&!deliveries.length?qcFile(historical?.evidence?.[0],true):undefined);
    documents.push({label:'Signed DO',...received,...(!received&&deliveries.length?{note:'A signed DO must be linked to this delivery.'}:{})});
   }
   const variable=lines.filter((l:any)=>l.sites?.includes(s.siteId)&&materialDocumentPolicy(l).customerUsageSignoff);
   if(variable.length||d.retrospective){
    const own=copy('customer-signoff'),draftIds=[d.draft_id,d.snapshot.combinedPlan?.variableDraftId,d.snapshot.combinedPlan?.fixedDraftId].filter(Boolean);
    const report=usage.find(u=>draftIds.includes(u.draft_id)&&u.site_id===s.siteId&&u.snapshot.state==='signed'&&u.snapshot.customerEvidenceId&&(d.retrospective||instant(u.created_at)>=instant(d.created_at))&&variable.every((l:any)=>u.snapshot.lines?.some((v:any)=>v.lineKey===l.key&&v.used!==null)));
    const final=b?.qcJob??b?.qc?.signoff??b?.qc?.handover;
    const historical=b?.documents?.find((v:any)=>v.id===`${board?.site_id}:historical-handover-documents`);
    const reportCopy=report&&copies.find(c=>c.evidence_id===report.snapshot.customerEvidenceId&&c.document_id===d.id&&c.source_site_id===s.siteId);
    const received=own?{fileId:own.evidence_id,source:'warehouse' as const}:reportCopy?{fileId:reportCopy.evidence_id,source:'warehouse' as const}:report?.evidence_warehouse===d.warehouse?{fileId:report.snapshot.customerEvidenceId,source:'warehouse' as const}:qcFile(report?{id:report.snapshot.customerEvidenceId}:undefined)??qcFile(final?.variableSignoff,true)??qcFile(historical?.evidence?.[2],true);
    documents.push({label:'Variable Items Sign Off',...received});
   }
   return {siteId:s.siteId,registeredSiteId:board?.site_id??s.registeredSiteId,dispatchComplete:!d.snapshot.parent&&d.snapshot.kind==='fixed'&&d.snapshot.partialDelivery===false,name:s.siteName,customer:s.customer,ipo:[s.ipo,s.orderNumber].filter(Boolean).join(' · '),documents};
  });
  return {id:d.id,number:d.number,draftId:d.draft_id,warehouse:d.warehouse,createdAt:new Date(d.created_at).toISOString(),parent:!!d.snapshot.parent,retrospective:!!d.retrospective,sites,status:sites.length&&sites.every((s:any)=>s.documents.every((v:DispatchDocument)=>v.fileId))?'ready' as const:'awaiting' as const,reconciliationStatus:d.retrospective?'Retrospective DO: gate copy waived; usage and returns require reconciliation':'Usage and any returns require reconciliation'};
 });
}
export const postedDispatchSql=`SELECT d.id,d.number,d.draft_id,d.warehouse,d.created_at,EXISTS(SELECT 1 FROM inventory_retrospective_dispatches retrospective WHERE retrospective.dispatch_id=d.id) retrospective,jsonb_build_object('kind',d.snapshot->'kind','partialDelivery',d.snapshot->'partialDelivery','parent',d.snapshot->'parent','sites',d.snapshot->'sites','lines',d.snapshot->'lines','combinedPlan',d.snapshot->'combinedPlan') snapshot
 FROM inventory_material_dispatches_active d WHERE ($1::text[] IS NULL OR d.warehouse=ANY($1::text[]))
 AND ${dispatchReconciliationEligibleSql} ORDER BY d.created_at DESC,d.id`;
export async function readDispatchDocuments(db:Db,warehouses:string[]|null){
 const dispatches=(await db.query(postedDispatchSql,[warehouses])).rows as Dispatch[];
 if(!dispatches.length)return {rows:[] as DispatchDocumentRow[]};
 const ids=dispatches.map(d=>d.id),draftIds=[...new Set(dispatches.flatMap(d=>[d.draft_id,d.snapshot.combinedPlan?.variableDraftId,d.snapshot.combinedPlan?.fixedDraftId]).filter(Boolean))],sites=dispatches.flatMap(d=>d.snapshot.sites??[]),boardIds=sites.map(s=>s.registeredSiteId).filter(Boolean),ipoIds=sites.map(s=>s.siteId);
 const [boardResult,copyResult,usageResult,closedResult]=await Promise.all([
  db.query(`SELECT DISTINCT ON(site_id) site_id,jsonb_build_object('origin',snapshot->'origin','installation',snapshot->'installation','deliveries',snapshot->'deliveries','qcJob',snapshot->'qcJob','qc',jsonb_build_object('signoff',snapshot#>'{qc,signoff}','handover',snapshot#>'{qc,handover}'),'documents',snapshot->'documents') snapshot FROM (SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC) latest WHERE site_id=ANY($1::text[]) OR snapshot#>>'{origin,ipoId}'=ANY($2::text[]) ORDER BY site_id,version DESC`,[boardIds,ipoIds]),
  db.query(`SELECT g.document_id,g.source_site_id,g.copy_kind,g.evidence_id FROM inventory_gate_pass_copies g JOIN inventory_material_evidence e ON e.id=g.evidence_id AND e.warehouse=g.warehouse WHERE g.document_kind='dispatch' AND g.document_id=ANY($1::uuid[]) AND g.copy_kind IN ('signed-customer','customer-signoff')`,[ids]),
  db.query(`SELECT DISTINCT ON(u.draft_id,u.site_id) u.draft_id,u.site_id,u.created_at,u.snapshot,e.warehouse evidence_warehouse FROM inventory_material_site_usage_versions u LEFT JOIN inventory_material_evidence e ON e.id::text=u.snapshot->>'customerEvidenceId' WHERE u.draft_id=ANY($1::uuid[]) ORDER BY u.draft_id,u.site_id,u.version DESC`,[draftIds]),
  db.query('SELECT DISTINCT ON(draft_id) draft_id,status FROM inventory_parent_reconciliation_versions WHERE draft_id=ANY($1::uuid[]) ORDER BY draft_id,version DESC',[draftIds])
 ]);
 const boards=boardResult.rows as Board[];
 const files=(await db.query('SELECT id,site_id,created_at FROM operations_board_files WHERE site_id=ANY($1::text[])',[boards.map(b=>b.site_id)])).rows as File[];
 return {rows:dispatchDocumentRows(dispatches,boards,copyResult.rows,files,usageResult.rows,new Set(closedResult.rows.filter(r=>r.status==='closed').map(r=>r.draft_id)))};
}
export async function dispatchDocumentEvidence(db:Db,rows:DispatchDocumentRow[],dispatchId:string,fileId:string){
 const row=rows.find(r=>r.id===dispatchId),doc=row?.sites.flatMap(s=>s.documents).find(d=>d.fileId===fileId);
 if(!doc)throw new HttpError(404,'This signed document is not linked to the selected warehouse delivery.');
 const result=doc.source==='qc'?await db.query('SELECT filename,media_type,content FROM operations_board_files WHERE id=$1 AND site_id=$2',[fileId,doc.boardId]):await db.query('SELECT original_name filename,media_type,content FROM inventory_material_evidence WHERE id=$1 AND warehouse=$2',[fileId,row!.warehouse]);
 if(!result.rows[0])throw new HttpError(404,'Signed document not found.');return result.rows[0];
}
/** Called only after Operations site authorization, including inside its command transaction. */
export async function siteDispatchChoices(db:Db,boardId:string,ipoId?:string){
 const result=await db.query(`SELECT d.id,d.number,d.created_at FROM inventory_material_dispatches_active d
 WHERE coalesce((d.snapshot->>'parent')::boolean,false)=false AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.snapshot->'sites') s WHERE s->>'registeredSiteId'=$1 OR (nullif(s->>'registeredSiteId','') IS NULL AND $2::text IS NOT NULL AND s->>'siteId'=$2))
 AND ${dispatchReconciliationEligibleSql} ORDER BY d.created_at DESC,d.id`,[boardId,ipoId??null]);return result.rows as {id:string;number:string;created_at:string}[];
}
