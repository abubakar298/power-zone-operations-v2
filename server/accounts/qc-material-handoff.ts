import {parentPoolLines} from '../../shared/parent-material-pool.js';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient,QueryResult} from 'pg';
import {Decimal} from 'decimal.js';
import {customerDocumentNativeIpo,type DocumentIpoIdentity} from './customer-document-identity.js';
import {completionEvidence} from '../../shared/qc-completion-evidence.js';
import {isArchivedLegacySolar} from '../../shared/legacy-solar-archive.js';
import {dispatchReconciliationEligibleSql} from '../inventory/dispatch-reconciliation-eligibility.js';
type Db=Pool|PoolClient;
export type QcMaterialHandoff={jobKey:string;aliases:string[];siteId:string;siteName:string;ipo:string;customer:string;ready:boolean;holds:string[];signature:string;usage:any[];localPurchases:any[];completedDate:string;receivedAt:string;deliveryOnly:boolean;sources:any};
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
export async function qcMaterialHandoffs(db:Db):Promise<QcMaterialHandoff[]>{
 const queries=[
  ()=>db.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot,created_at FROM operations_board_versions ORDER BY site_id,version DESC'),
  ()=>db.query("SELECT i.id,i.number,i.snapshot,coalesce(i.snapshot#>>'{input,orderNumber}','') AS \"orderNumber\",i.snapshot#>>'{customer,shortCode}' AS \"customerCode\",i.snapshot#>>'{customer,name}' AS \"customerName\" FROM internal_purchase_orders i JOIN boq_revisions b ON b.id::text=i.snapshot->>'boqRevisionId'"),
  ()=>db.query('SELECT ipo_id,board_site_id FROM inventory_material_source_links'),
  ()=>db.query('SELECT site_id,legacy_ipo_number FROM ubl_site_orders'),
  ()=>db.query('SELECT d.id,v.snapshot FROM inventory_material_drafts d JOIN LATERAL(SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=d.id ORDER BY version DESC LIMIT 1)v ON true'),
  ()=>db.query('SELECT DISTINCT ON(draft_id,site_id) draft_id,site_id,version,snapshot FROM inventory_material_site_usage_versions ORDER BY draft_id,site_id,version DESC'),
  ()=>db.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_site_local_purchase_versions ORDER BY site_id,version DESC'),
  ()=>db.query('SELECT id,site_id,sha256 FROM operations_board_files'),
  ()=>db.query(`SELECT d.id,d.draft_id,d.snapshot->'combinedPlan' AS combined_plan,l.line_key,l.quantity::text FROM inventory_material_dispatch_lines_active l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id WHERE l.quantity>0 AND ${dispatchReconciliationEligibleSql}`),
 ];
 const values:QueryResult<any>[]=[];
 if(typeof (db as PoolClient).release==='function'){for(const query of queries)values.push(await query());}else values.push(...await Promise.all(queries.map(query=>query())));
 const [b,i,l,o,d,u,p,f,issued]=values;
 const result:QcMaterialHandoff[]=[];
 for(const board of b.rows){
  const s=board.snapshot;if(s.superseded||s.sample===true||s.archived===true||isArchivedLegacySolar({...s,id:board.site_id}))continue;
  const explicit=s.origin?.ipoId,linked=l.rows.filter(r=>r.board_site_id===board.site_id);
  const legacy=o.rows.filter(r=>board.site_id==='registered-UBL:SOLAR:'+r.legacy_ipo_number);
  const native=explicit&&i.rows.some(r=>r.id===explicit)?explicit:!explicit&&linked.length===1?linked[0].ipo_id:!explicit?customerDocumentNativeIpo({...s,id:board.site_id},i.rows as DocumentIpoIdentity[]):undefined;
  const jobKey=legacy.length===1?'ubl:'+legacy[0].site_id:native?'ipo:'+native:null;
  if(!jobKey)continue;
  const deliveryOnly=s.installation===false||s.projectType==='delivery-only';
  const signedDos=[...(s.deliveries??[]).map((v:any)=>v.signedDo),...(s.documents??[]).filter((v:any)=>v.id===board.site_id+':historical-delivery-documents').map((v:any)=>v.evidence?.[0])].filter((v:any)=>v&&f.rows.some(file=>file.id===v.id&&file.site_id===board.site_id));
  const drafts:any[]=[],usage:any[]=[],sources:any[]=[];
  for(const draft of d.rows){if(draft.snapshot.combinedPlan)continue;
   const site=draft.snapshot.sites?.find((v:any)=>v.registeredSiteId===board.site_id||native&&v.siteId===native);if(!site)continue;
   const lines:any[]=parentPoolLines(draft.snapshot).filter((v:any)=>(v.sites??[]).includes(site.siteId));
   const outs=issued.rows.filter(v=>v.draft_id===draft.id||v.combined_plan?.fixedDraftId===draft.id||v.combined_plan?.variableDraftId===draft.id);
   const relevant=lines.filter((line:any)=>outs.some(v=>v.line_key===line.key));if(!relevant.length)continue;
   const saved=u.rows.find(v=>v.draft_id===draft.id&&v.site_id===site.siteId),entry=saved?.snapshot;
   // Files must be site scoped; an arbitrary evidence UUID is not a sign-off.
   const validated=entry?{...entry,customerEvidenceId:f.rows.some(v=>v.id===entry.customerEvidenceId&&v.site_id===board.site_id)?entry.customerEvidenceId:null}:null;
   drafts.push({parent:draft.snapshot.parent,kind:draft.snapshot.kind,lineKeys:relevant.map((v:any)=>v.key),usage:validated});
   sources.push({draftId:draft.id,siteId:site.siteId,usageVersion:saved?.version??null,lines:relevant.map((v:any)=>v.key),dispatches:outs.map(v=>[v.id,v.line_key,v.quantity])});
   for(const line of relevant){const used=entry?.lines?.find((v:any)=>v.lineKey===line.key)?.used;
    usage.push({key:draft.id+':'+line.key,itemId:line.itemId,description:line.description||line.itemId,unit:line.unit,issued:draft.snapshot.parent?null:outs.filter(v=>v.line_key===line.key).reduce((n,v)=>n.add(v.quantity),new Decimal(0)).toString(),used:used??null,parent:!!draft.snapshot.parent});}
  }
  const local=p.rows.find(v=>v.site_id===board.site_id),localItems=local?.snapshot.items??[];
  const final=s.qcJob??s.qc?.handover??s.qc?.signoff??completionEvidence(s.documents?.find((v:any)=>v.id===board.site_id+':completion-documents'));
  let holds=materialUsageHolds({deliveryOnly,completed:s.completed===true,signedDos:signedDos.length,drafts,localDeclared:!!local,noWarehouseMaterials:local?.snapshot.noWarehouseMaterials===true,noVariableItemsUsed:final?.noVariableItemsUsed===true});
  const unsignedDeliveries=(s.deliveries??[]).filter((v:any)=>!v.signedDo||!f.rows.some((file:any)=>file.site_id===board.site_id&&file.id===v.signedDo.id));
  if(unsignedDeliveries.length)holds.push('Signed DO pending for '+unsignedDeliveries.length+' delivery / deliveries');
  // Installation-only scopes may explicitly confirm no warehouse material was issued.
  if(local?.snapshot.noWarehouseMaterials===true)holds=holds.filter(h=>h!=='Issued material linkage or no-material confirmation pending');
  const source={ready:holds.length===0,siteId:board.site_id,completed:deliveryOnly?s.completed===true:true,deliveryOnly,usage:sources,noVariableItemsUsed:final?.noVariableItemsUsed===true,noWarehouseMaterials:local?.snapshot.noWarehouseMaterials===true,localVersion:local?.version??null,localItems,signedDos:signedDos.map((v:any)=>({id:v.id,sha256:f.rows.find(file=>file.id===v.id)?.sha256}))};
  const signature=createHash('sha256').update(JSON.stringify(source)).digest('hex');
  result.push({jobKey,aliases:['site:'+board.site_id],siteId:board.site_id,siteName:s.name,ipo:s.ipo??i.rows.find(r=>r.id===native)?.number??'',customer:s.customer??'',ready:source.ready,holds,signature,usage,localPurchases:localItems,completedDate:final?.date??s.qcDelivery?.date??'',receivedAt:new Date(board.created_at).toISOString(),deliveryOnly,sources:source});
 }
 // Multiple live Operations records for one IPO must be resolved, never silently merged.
 for(const row of result)if(result.filter(v=>v.jobKey===row.jobKey).length>1){row.ready=false;row.holds.push('Multiple Operations site links need review');row.sources.ready=false;}
 return result;
}
export async function qcMaterialHandoff(db:Db,key:string){const matches=(await qcMaterialHandoffs(db)).filter(r=>r.jobKey===key||r.aliases.includes(key));return matches.length===1?matches[0]:null;}
