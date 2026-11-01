import {completionEvidence} from '../../shared/qc-completion-evidence.js';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {isArchivedLegacySolar} from '../../shared/legacy-solar-archive.js';
import type {AccountsCustomerDocument,CustomerDocumentKind} from '../../shared/accounts-customer-documents.js';
type Board={site_id:string;version:number;snapshot:any};
type Ref={siteId:string;siteName:string;customer:string;ipo:string;kind:CustomerDocumentKind;fileId:string;date:string|null;version:number;source:'QC'|'Site sign-off';warehouse?:string};
type File={id:string;site_id?:string;warehouse?:string;filename:string;created_at:string;media_type:string};
const uuid=z.uuid();
/** Typed signed-document references only: no IRR, site photos, orphan uploads,
 * Inventory approval, returned material or physical-original location gate. */
export function customerDocumentReferences(boards:Board[]):Ref[]{
 const refs:Ref[]=[];
 for(const b of boards){const s=b.snapshot;if(s.superseded||isArchivedLegacySolar({...s,id:b.site_id}))continue;
  const add=(kind:CustomerDocumentKind,f:any,date?:string)=>{if(uuid.safeParse(f?.id).success)refs.push({siteId:b.site_id,siteName:String(s.name??''),customer:String(s.customer??''),ipo:String(s.ipo??''),kind,fileId:f.id,date:date??null,version:b.version,source:'QC'});};
  for(const d of s.deliveries??[])add('Signed DO',d.signedDo,d.deliveryDate);
  for(const q of [s.qcJob,s.qc?.signoff,s.qc?.handover].filter(Boolean)){add('Acknowledgment',q.acknowledgement,q.date);add('VSO',q.variableSignoff,q.date);}
  for(const d of s.documents??[]){
   if(d.id===`${b.site_id}:historical-delivery-documents`)add('Signed DO',d.evidence?.[0],d.date);
   if(d.id===`${b.site_id}:historical-handover-documents`||d.id===`${b.site_id}:completion-documents`){const refs=completionEvidence(d);add('Acknowledgment',refs.acknowledgement,d.date);add('VSO',refs.variableSignoff,d.date);}
  }
 }
 return refs;
}
export function projectCustomerDocuments(refs:Ref[],files:File[]):AccountsCustomerDocument[]{
 const rows=new Map<string,AccountsCustomerDocument>(),qcFiles=new Map(files.filter(f=>f.site_id).map(f=>[f.site_id+'|'+f.id,f])),warehouseFiles=new Map(files.filter(f=>f.warehouse).map(f=>[f.warehouse+'|'+f.id,f]));
 for(const r of refs){const f=qcFiles.get(r.siteId+'|'+r.fileId)??(r.warehouse?warehouseFiles.get(r.warehouse+'|'+r.fileId):undefined);if(!f)continue;
  const id=createHash('sha256').update(JSON.stringify([r.siteId,r.kind,r.fileId])).digest('hex');if(rows.has(id))continue;
  rows.set(id,{id,siteId:r.siteId,siteName:r.siteName,customer:r.customer,ipo:r.ipo,kind:r.kind,filename:f.filename,receivedAt:new Date(f.created_at).toISOString(),documentDate:r.date,source:r.source,sourceVersion:r.version,downloadUrl:'/api/accounts-workspace/customer-documents/'+id+'/file'});
 }
 return [...rows.values()].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.id.localeCompare(b.id));
}
/** Closure means the latest Management closure decision, not installation completion.
 * Shared UPS IPO/PO text and site names are never sufficient to hide another site. */
export function customerDocumentSiteClosed(board:Board,closedJobs:Set<string>,nativeLinks:Map<string,string[]>,legacySolar:Map<string,string>){
 const s=board.snapshot,origin=s.origin?.ipoId;
 const hasOrigin=typeof origin==='string'&&uuid.safeParse(origin).success;if(hasOrigin&&closedJobs.has('ipo:'+origin))return true;
 const linked=nativeLinks.get(board.site_id)??[];if(!hasOrigin&&linked.length===1&&closedJobs.has('ipo:'+linked[0]))return true;
 if(typeof s.jobKey==='string'&&closedJobs.has(s.jobKey))return true;
 const candidates=[board.site_id,s.sourceKey,s.key].filter((v):v is string=>typeof v==='string').map(v=>v.replace(/^(?:registered-|received-)/,''));
 return candidates.some(key=>legacySolar.has(key)&&closedJobs.has(legacySolar.get(key)!));
}
/** Caller authorizes Accounts/Management before this metadata-only projection. */
export async function customerDocuments(pool:Pool,includeClosed=false,jobKey?:string){
 const boards=(await pool.query(`SELECT DISTINCT ON(site_id) site_id,version,jsonb_build_object('id',site_id,'origin',snapshot->'origin','jobKey',snapshot->'jobKey','name',snapshot->'name','customer',snapshot->'customer','ipo',snapshot->'ipo','program',snapshot->'program','kind',snapshot->'kind','sourceKey',snapshot->'sourceKey','key',snapshot->'key','type',snapshot->'type','projectType',snapshot->'projectType','superseded',snapshot->'superseded','archive',snapshot->'archive','legacySolarArchived',snapshot->'legacySolarArchived','deliveries',snapshot->'deliveries','qcJob',snapshot->'qcJob','qc',jsonb_build_object('signoff',snapshot#>'{qc,signoff}','handover',snapshot#>'{qc,handover}'),'documents',snapshot->'documents') snapshot FROM operations_board_versions ORDER BY site_id,version DESC`)).rows as Board[];
 const [decisions,links,legacy]=await Promise.all([pool.query('SELECT DISTINCT ON(job_key) job_key,stage FROM accounts_active_job_closures ORDER BY job_key,version DESC'),pool.query('SELECT board_site_id,ipo_id FROM inventory_material_source_links'),pool.query('SELECT site_id,legacy_ipo_number FROM ubl_site_orders')]);
 const closedJobs=new Set<string>(decisions.rows.filter(r=>r.stage==='Closed').map(r=>r.job_key)),nativeLinks=new Map<string,string[]>();for(const l of links.rows)nativeLinks.set(l.board_site_id,[...(nativeLinks.get(l.board_site_id)??[]),l.ipo_id]);
 const legacySolar=new Map<string,string>(legacy.rows.map(r=>['UBL:SOLAR:'+String(r.legacy_ipo_number).replace(/^CHP-/i,''),'ubl:'+r.site_id]));
 const openBoards=includeClosed?boards:boards.filter(b=>!customerDocumentSiteClosed(b,closedJobs,nativeLinks,legacySolar));
 // Reuse exact native/registered job identity matching for site-specific document windows.
 const activeBoards=jobKey?openBoards.filter(b=>customerDocumentSiteClosed(b,new Set([jobKey]),nativeLinks,legacySolar)):openBoards;
 const refs=customerDocumentReferences(activeBoards),bySite=new Map(activeBoards.filter(b=>!b.snapshot.superseded&&!isArchivedLegacySolar({...b.snapshot,id:b.site_id})).map(b=>[b.site_id,b]));
 const usage=(await pool.query(`SELECT DISTINCT ON(u.draft_id,u.site_id) u.site_id,u.version,u.snapshot,(SELECT jsonb_agg(jsonb_build_object('siteId',s->'siteId','registeredSiteId',s->'registeredSiteId','siteName',s->'siteName','customer',s->'customer','ipo',s->'ipo')) FROM jsonb_array_elements(d.snapshot->'sites') s) sites,d.snapshot->>'warehouse' warehouse FROM inventory_material_site_usage_versions u JOIN LATERAL(SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=u.draft_id ORDER BY version DESC LIMIT 1)d ON true ORDER BY u.draft_id,u.site_id,u.version DESC`)).rows;
 for(const u of usage){if(u.snapshot.state!=='signed'||!uuid.safeParse(u.snapshot.customerEvidenceId).success)continue;const sources=(u.sites??[]).filter((s:any)=>s.siteId===u.site_id&&s.registeredSiteId&&bySite.has(s.registeredSiteId));if(sources.length!==1)continue;const s=sources[0],b=bySite.get(s.registeredSiteId)!;refs.push({siteId:b.site_id,siteName:String(b.snapshot.name??s.siteName??''),customer:String(b.snapshot.customer??s.customer??''),ipo:String(b.snapshot.ipo??s.ipo??''),kind:'VSO',fileId:u.snapshot.customerEvidenceId,date:u.snapshot.date??null,version:u.version,source:'Site sign-off',warehouse:u.warehouse});}
 if(!refs.length)return {rows:[] as AccountsCustomerDocument[],refs};
 const ids=[...new Set(refs.map(r=>r.fileId))];
 const [qc,warehouse]=await Promise.all([pool.query('SELECT id,site_id,filename,media_type,created_at FROM operations_board_files WHERE id=ANY($1::uuid[])',[ids]),pool.query('SELECT id,warehouse,original_name filename,media_type,created_at FROM inventory_material_evidence WHERE id=ANY($1::uuid[])',[ids])]);
 return {rows:projectCustomerDocuments(refs,[...qc.rows,...warehouse.rows]),refs};
}
export async function customerDocumentFile(pool:Pool,id:string){
 const data=await customerDocuments(pool,true),row=data.rows.find(r=>r.id===id);if(!row)throw new HttpError(404,'This customer-signed document is not available.');
 const ref=data.refs.find(r=>r.siteId===row.siteId&&r.kind===row.kind&&createHash('sha256').update(JSON.stringify([r.siteId,r.kind,r.fileId])).digest('hex')===id)!;
 let file=(await pool.query('SELECT filename,media_type,content FROM operations_board_files WHERE id=$1 AND site_id=$2',[ref.fileId,ref.siteId])).rows[0];
 if(!file&&ref.warehouse)file=(await pool.query('SELECT original_name filename,media_type,content FROM inventory_material_evidence WHERE id=$1 AND warehouse=$2',[ref.fileId,ref.warehouse])).rows[0];
 if(!file)throw new HttpError(404,'Customer-signed file not found.');return file;
}
