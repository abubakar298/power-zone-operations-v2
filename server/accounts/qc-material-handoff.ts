import {parentPoolLines} from '../../shared/parent-material-pool.js';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient,QueryResult} from 'pg';
import {Decimal} from 'decimal.js';
import {customerDocumentNativeIpo,type DocumentIpoIdentity} from './customer-document-identity.js';
import {completionEvidence} from '../../shared/qc-completion-evidence.js';
import {isArchivedLegacySolar} from '../../shared/legacy-solar-archive.js';
import {dispatchReconciliationEligibleSql} from '../inventory/dispatch-reconciliation-eligibility.js';
import {qcDispatchQuantities,qcReviewedDispatches,qcReviewedDispatchIds} from '../inventory/qc-dispatch-review.js';
import {historicalQcIssues} from '../inventory/historical-qc-issues.js';
type Db=Pool|PoolClient;
type HistoricalIssueEvidence={signedDoIds:string[];vsoId:string|null;noVariableItemsUsed:boolean;unsignedDeliveries:number};
export type QcMaterialHandoff={jobKey:string;aliases:string[];siteId:string;siteName:string;ipo:string;customer:string;ready:boolean;holds:string[];signature:string;usage:any[];localPurchases:any[];completedDate:string;receivedAt:string;deliveryOnly:boolean;historicalReportId?:string;historicalReportVersion?:number;historicalIssueEvidence?:HistoricalIssueEvidence;sources:any};
/** One exact site, all actually issued preparations. No warehouse returns or photos. */
export function materialUsageHolds(input:{deliveryOnly:boolean;completed:boolean;signedDos:number;drafts:{parent:boolean;kind:string;lineKeys:string[];usage:any}[];localDeclared:boolean;noVariableItemsUsed?:boolean;noWarehouseMaterials?:boolean}):string[]{
 const holds:string[]=[];
 if(input.deliveryOnly&&!input.completed)holds.push('Delivery completion pending');
 if(!input.signedDos&&(input.deliveryOnly||input.drafts.length>0||!input.noWarehouseMaterials))holds.push('Signed DO pending');
 if(input.deliveryOnly)return holds;
 if(!input.drafts.length&&!input.noWarehouseMaterials)holds.push('Issued material linkage or no-material confirmation pending');
 for(const d of input.drafts){
  if(!d.lineKeys.length)continue;
  const label=d.parent?'Parent DO variable usage':d.kind==='variable'?'Variable material usage':'Fixed material usage';
  if(!d.usage||d.usage.state!=='signed'||d.lineKeys.some(key=>!d.usage.lines?.some((l:any)=>l.lineKey===key&&l.used!==null&&l.used!==undefined&&l.used!=='')))holds.push(label+' pending');
  else if(d.kind==='variable'&&!d.usage.customerEvidenceId&&(!input.noVariableItemsUsed||d.usage.lines.some((l:any)=>l.used!=null&&new Decimal(l.used).gt(0))))holds.push('Signed VSO pending');
 }
 if(!input.localDeclared)holds.push('Confirm local purchases or no local purchases');
 return [...new Set(holds)];
}
type Query=()=>Promise<QueryResult<any>>;
async function runQueries(db:Db,queries:Query[]):Promise<QueryResult<any>[]>{
 const values:QueryResult<any>[]=[];
 if(typeof (db as PoolClient).release==='function'){for(const query of queries)values.push(await query());}else values.push(...await Promise.all(queries.map(query=>query())));
 return values;
}
// Which job a live Operations site belongs to (null when excluded or unlinked).
function boardJob(board:any,i:QueryResult<any>,l:QueryResult<any>,o:QueryResult<any>):{jobKey:string;native:any}|null{
 const s=board.snapshot;if(s.superseded||s.sample===true||s.archived===true||isArchivedLegacySolar({...s,id:board.site_id}))return null;
 const explicit=s.origin?.ipoId,linked=l.rows.filter(r=>r.board_site_id===board.site_id);
 const legacy=o.rows.filter(r=>board.site_id==='registered-UBL:SOLAR:'+r.legacy_ipo_number);
 const native=explicit&&i.rows.some(r=>r.id===explicit)?explicit:!explicit&&linked.length===1?linked[0].ipo_id:!explicit?customerDocumentNativeIpo({...s,id:board.site_id},i.rows as DocumentIpoIdentity[]):undefined;
 const jobKey=legacy.length===1?'ubl:'+legacy[0].site_id:native?'ipo:'+native:null;
 return jobKey?{jobKey,native}:null;
}
export async function qcMaterialHandoffs(db:Db):Promise<QcMaterialHandoff[]>{return buildQcMaterialHandoffs(db);}
/** With a key, only the Operations sites of that job (and any other site sharing its job) are evaluated. */
async function buildQcMaterialHandoffs(db:Db,key?:string):Promise<QcMaterialHandoff[]>{
 const identity:Query[]=[
  ()=>db.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot,created_at FROM operations_board_versions ORDER BY site_id,version DESC'),
  ()=>db.query("SELECT i.id,i.number,i.snapshot,coalesce(i.snapshot#>>'{input,orderNumber}','') AS \"orderNumber\",i.snapshot#>>'{customer,shortCode}' AS \"customerCode\",i.snapshot#>>'{customer,name}' AS \"customerName\" FROM internal_purchase_orders i JOIN boq_revisions b ON b.id::text=i.snapshot->>'boqRevisionId'"),
  ()=>db.query('SELECT ipo_id,board_site_id FROM inventory_material_source_links'),
  ()=>db.query('SELECT site_id,legacy_ipo_number FROM ubl_site_orders'),
 ];
 // Site-scoped rows are only ever matched to their own site (and reports to their own job), so a filter changes nothing for the selected sites.
 const detail=(only?:{sites:string[];jobs:string[]}):Query[]=>[
  ()=>db.query('SELECT d.id,v.snapshot FROM inventory_material_drafts d JOIN LATERAL(SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=d.id ORDER BY version DESC LIMIT 1)v ON true'),
  ()=>db.query('SELECT DISTINCT ON(draft_id,site_id) draft_id,site_id,version,snapshot FROM inventory_material_site_usage_versions ORDER BY draft_id,site_id,version DESC'),
  ()=>only?db.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_site_local_purchase_versions WHERE site_id=ANY($1::text[]) ORDER BY site_id,version DESC',[only.sites]):db.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_site_local_purchase_versions ORDER BY site_id,version DESC'),
  ()=>only?db.query('SELECT id,site_id,sha256 FROM operations_board_files WHERE site_id=ANY($1::text[])',[only.sites]):db.query('SELECT id,site_id,sha256 FROM operations_board_files'),
  ()=>only?db.query("SELECT r.id,r.job_key,v.version,v.snapshot->'qcUsage' AS usage FROM inventory_reports r JOIN LATERAL(SELECT version,stage,snapshot FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1)v ON true WHERE v.stage='Sent to Accounts' AND v.snapshot#>>'{qcUsage,source}'='QC historical usage' AND r.job_key=ANY($1::text[])",[only.jobs]):db.query("SELECT r.id,r.job_key,v.version,v.snapshot->'qcUsage' AS usage FROM inventory_reports r JOIN LATERAL(SELECT version,stage,snapshot FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1)v ON true WHERE v.stage='Sent to Accounts' AND v.snapshot#>>'{qcUsage,source}'='QC historical usage'"),
  ()=>only?db.query('SELECT DISTINCT ON(site_id) site_id,job_key,version,snapshot FROM inventory_historical_qc_issue_usage WHERE site_id=ANY($1::text[]) ORDER BY site_id,version DESC',[only.sites]):db.query('SELECT DISTINCT ON(site_id) site_id,job_key,version,snapshot FROM inventory_historical_qc_issue_usage ORDER BY site_id,version DESC'),
  ()=>db.query(`SELECT d.id,d.draft_id,d.snapshot->'combinedPlan' AS combined_plan,l.line_key,l.quantity::text,${dispatchReconciliationEligibleSql} AS warehouse_ready FROM inventory_material_dispatch_lines_active l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id WHERE l.quantity>0 AND (${dispatchReconciliationEligibleSql} OR d.id=ANY($1::uuid[]))`,[qcReviewedDispatches]),
 ];
 let b:QueryResult<any>,i:QueryResult<any>,l:QueryResult<any>,o:QueryResult<any>,details:QueryResult<any>[];
 let selected:Set<string>|undefined;
 if(key===undefined){[b,i,l,o,...details]=await runQueries(db,[...identity,...detail()]);}
 else{
  [b,i,l,o]=await runQueries(db,identity);
  const jobs=new Map<string,string>();
  for(const board of b.rows){const job=boardJob(board,i,l,o);if(job)jobs.set(board.site_id,job.jobKey);}
  // Every site of a matched job is kept so duplicate Operations links are still detected.
  const matchedJobs=new Set([...jobs].filter(([site,job])=>job===key||'site:'+site===key).map(([,job])=>job));
  selected=new Set([...jobs].filter(([,job])=>matchedJobs.has(job)).map(([site])=>site));
  if(!selected.size)return [];
  details=await runQueries(db,detail({sites:[...selected],jobs:[...matchedJobs]}));
 }
 const [d,u,p,f,reports,historicalUsage,issued]=details;
 const result:QcMaterialHandoff[]=[];
 for(const board of b.rows){
  if(selected&&!selected.has(board.site_id))continue;
  const job=boardJob(board,i,l,o);if(!job)continue;
  const s=board.snapshot,{jobKey,native}=job;
  const deliveryOnly=s.installation===false||s.projectType==='delivery-only';
  const historicalDelivery=s.documents?.find((v:any)=>v.id===board.site_id+':historical-delivery-documents');
  const signedDos=[...new Map<string,any>([...(s.deliveries??[]).map((v:any)=>v.signedDo),...(historicalDelivery?.evidence??[]).slice(0,1)].filter((v:any)=>v&&f.rows.some(file=>file.id===v.id&&file.site_id===board.site_id)).map((v:any)=>[v.id,v])).values()];
  const drafts:any[]=[],usage:any[]=[],sources:any[]=[];
  const reviewIds=qcReviewedDispatchIds(board.site_id);
  for(const draft of d.rows){if(draft.snapshot.combinedPlan)continue;
   const site=draft.snapshot.sites?.find((v:any)=>v.registeredSiteId===board.site_id||native&&v.siteId===native);if(!site)continue;
   const lines:any[]=parentPoolLines(draft.snapshot).filter((v:any)=>(v.sites??[]).includes(site.siteId));
   const outs=issued.rows.filter(v=>(v.warehouse_ready||reviewIds.includes(v.id))&&(v.draft_id===draft.id||v.combined_plan?.fixedDraftId===draft.id||v.combined_plan?.variableDraftId===draft.id));
   const relevant=lines.filter((line:any)=>outs.some(v=>v.line_key===line.key));if(!relevant.length)continue;
   const saved=u.rows.find(v=>v.draft_id===draft.id&&v.site_id===site.siteId),entry=saved?.snapshot;
   // Files must be site scoped; an arbitrary evidence UUID is not a sign-off.
   const quantity=(key:string)=>outs.filter(v=>v.line_key===key).reduce((n,v)=>n.add(v.quantity),new Decimal(0)).toString();
   const currentQuantities=entry?.qcDispatchQuantities===undefined||entry.qcDispatchQuantities===qcDispatchQuantities(relevant.map(line=>({key:line.key,quantity:quantity(line.key)})));
   const validated=entry&&currentQuantities?{...entry,customerEvidenceId:f.rows.some(v=>v.id===entry.customerEvidenceId&&v.site_id===board.site_id)?entry.customerEvidenceId:null}:null;
   drafts.push({parent:draft.snapshot.parent,kind:draft.snapshot.kind,lineKeys:relevant.map((v:any)=>v.key),usage:validated});
   sources.push({draftId:draft.id,siteId:site.siteId,usageVersion:saved?.version??null,lines:relevant.map((v:any)=>v.key),dispatches:outs.map(v=>[v.id,v.line_key,v.quantity])});
   for(const line of relevant){const used=validated?.lines?.find((v:any)=>v.lineKey===line.key)?.used;
    usage.push({key:draft.id+':'+line.key,itemId:line.itemId,description:line.description||line.itemId,unit:line.unit,issued:draft.snapshot.parent?null:quantity(line.key),used:used??null,parent:!!draft.snapshot.parent});}
  }
  const local=p.rows.find(v=>v.site_id===board.site_id),localItems=local?.snapshot.items??[];
  const final=s.qcJob??s.qc?.handover??s.qc?.signoff??completionEvidence(s.documents?.find((v:any)=>v.id===board.site_id+':completion-documents'||v.id===board.site_id+':historical-handover-documents'));
  const verifiedHistorical=(!deliveryOnly&&!drafts.length&&signedDos.length&&final?.variableSignoff?.id)
   ? reports.rows.find(report=>{
     const verified=report.usage;
     const vsoId=final.variableSignoff.id;
     return report.job_key===jobKey&&verified.boardId===board.site_id&&verified.input?.verify===true
      &&Array.isArray(verified.evidenceIds)&&verified.evidenceIds.includes(vsoId)
      &&f.rows.some(file=>file.site_id===board.site_id&&file.id===vsoId)
      &&signedDos.every((file:any)=>file.id!==vsoId&&verified.evidenceIds.includes(file.id));
    }) : undefined;
  const unsignedDeliveries=(s.deliveries??[]).filter((v:any)=>!v.signedDo||!f.rows.some((file:any)=>file.site_id===board.site_id&&file.id===v.signedDo.id));
  const linkedIssues=!deliveryOnly&&s.installation===true&&!drafts.length&&!verifiedHistorical?historicalQcIssues(board.site_id,s.ipo??''):null;
  let historicalIssueEvidence:HistoricalIssueEvidence|undefined;
  if(linkedIssues){
   const signedDoIds=[...new Set<string>(signedDos.map((file:any)=>file.id))].sort();
   const candidateVso=final?.variableSignoff?.id;
   const vsoId=candidateVso&&!signedDoIds.includes(candidateVso)&&f.rows.some(file=>file.id===candidateVso&&file.site_id===board.site_id)?candidateVso:null;
   historicalIssueEvidence={signedDoIds,vsoId,noVariableItemsUsed:final?.noVariableItemsUsed===true,unsignedDeliveries:unsignedDeliveries.length};
   const record=historicalUsage.rows.find(row=>row.site_id===board.site_id&&row.job_key===jobKey);
   const recorded=record?.snapshot;
   const unchanged=recorded?.evidence===JSON.stringify(historicalIssueEvidence)&&recorded?.issueSignature===linkedIssues.signature;
   const used=(key:string)=>unchanged?recorded.usage[key]??null:null;
   for(const variable of [false,true]){
    const lineKeys=linkedIssues.lines.filter(line=>line.variable===variable).map(line=>line.key);
    if(lineKeys.length)drafts.push({parent:false,kind:variable?'variable':'fixed',lineKeys,usage:unchanged?{state:recorded.state,customerEvidenceId:vsoId,lines:lineKeys.map(lineKey=>({lineKey,used:used(lineKey)}))}:null});
   }
   for(const line of linkedIssues.lines)usage.push({...line,used:used(line.key),parent:false});
   sources.push({historicalIssues:linkedIssues.lines.map(line=>[line.key,line.issued]),version:record?.version??null,evidence:historicalIssueEvidence});
  }
  const holds=verifiedHistorical?[]:materialUsageHolds({deliveryOnly,completed:s.completed===true,signedDos:signedDos.length,drafts,localDeclared:!!local,noWarehouseMaterials:local?.snapshot.noWarehouseMaterials===true,noVariableItemsUsed:final?.noVariableItemsUsed===true});
  if(unsignedDeliveries.length)holds.push('Signed DO pending for '+unsignedDeliveries.length+' delivery / deliveries');
  if(linkedIssues?.review)holds.push(linkedIssues.review);
  const source={ready:holds.length===0,siteId:board.site_id,completed:deliveryOnly?s.completed===true:true,deliveryOnly,usage:sources,noVariableItemsUsed:final?.noVariableItemsUsed===true,noWarehouseMaterials:local?.snapshot.noWarehouseMaterials===true,localVersion:local?.version??null,localItems,signedDos:signedDos.map((v:any)=>({id:v.id,sha256:f.rows.find(file=>file.id===v.id)?.sha256})),...(verifiedHistorical?{historicalReportId:verifiedHistorical.id,historicalReportVersion:verifiedHistorical.version}:{})};
  const signature=createHash('sha256').update(JSON.stringify(source)).digest('hex');
  result.push({jobKey,aliases:['site:'+board.site_id],siteId:board.site_id,siteName:s.name,ipo:s.ipo??i.rows.find(r=>r.id===native)?.number??'',customer:s.customer??'',ready:source.ready,holds,signature,usage,localPurchases:localItems,completedDate:final?.date??s.qcDelivery?.date??'',receivedAt:new Date(board.created_at).toISOString(),deliveryOnly,historicalReportId:source.historicalReportId,historicalReportVersion:source.historicalReportVersion,historicalIssueEvidence,sources:source});
 }
 // Multiple live Operations records for one IPO must be resolved, never silently merged.
 for(const row of result)if(result.filter(v=>v.jobKey===row.jobKey).length>1){row.ready=false;row.holds.push('Multiple Operations site links need review');row.sources.ready=false;}
 return result;
}
export async function qcMaterialHandoff(db:Db,key:string){const matches=(await buildQcMaterialHandoffs(db,key)).filter(r=>r.jobKey===key||r.aliases.includes(key));return matches.length===1?matches[0]:null;}
