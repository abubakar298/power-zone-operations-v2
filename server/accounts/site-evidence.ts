import {projectSiteEvidence,evidenceFileIds} from './site-evidence-projection.js';
export {projectSiteEvidence,evidenceFileIds} from './site-evidence-projection.js';
import {accountsIpoLabel} from '../../shared/accounts-site-reference.js';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {lockActiveActor} from '../auth/actor-lock.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {completionEvidence} from '../../shared/qc-completion-evidence.js';
import {isArchivedLegacySolar} from '../../shared/legacy-solar-archive.js';
import {AccountsRepository} from './repository.js';
type Db=Pool|PoolClient;
type Row=Record<string,any>;
const today=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const addDays=(date:string,days:number)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const daysBetween=(from:string,to:string)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
const deliveryOnly=(s:Row)=>s.installation===false||s.projectType==='delivery-only';
/** Job Completion Date recorded by QC; never derived from plans or dispatch dates. */
export function completionDate(s:Row):string|null{return s.qc?.handover?.date??s.qc?.signoff?.date??s.qcJob?.date??null;}
function finalDeliveryDate(s:Row):string|null{
 const full=(s.deliveries??[]).filter((d:Row)=>d.partial!==true&&d.deliveryDate);
 return full.at(-1)?.deliveryDate??null;
}

/** Required originals for Karachi office, each tracked separately from its scan. */
export function projectOriginals(siteId:string,s:Row,receipts:Row[],now=new Date()){
 const items:Row[]=[];
 const only=deliveryOnly(s),evidence=projectSiteEvidence(siteId,s);
 for(const d of s.documents??[]){
  const label=String(d.label??''),base={documentId:d.id,batchLabel:label,location:d.location??'Location not recorded',locationDate:d.date??null,tracking:d.tracking||'',carrier:d.carrier||'',history:d.history??[]};
  if(/DO\b/.test(label))items.push({...base,key:`${d.id}:Signed DO`,type:'Signed DO'});
  else if(!only&&(d.id===`${siteId}:completion-documents`||d.id===`${siteId}:historical-handover-documents`||/acknowledg|sign-?off|handover/i.test(label))){
   items.push({...base,key:`${d.id}:Customer acknowledgment`,type:'Customer acknowledgment'});
   const noVso=d.completionEvidenceVersion===2?completionEvidence(d).noVariableItemsUsed:evidence.vsoNotRequired;
   if(!noVso)items.push({...base,key:`${d.id}:VSO`,type:'VSO'});
  }
 }
 const completed=s.completed===true||s.stage==='completed';
 const start=only?finalDeliveryDate(s)??(s.stage==='delivered'||completed?s.deliveryDate??null:null):completionDate(s);
 const due=!only&&!completed?null:start?addDays(start,3):null;
 const missingStartDate=(only?(s.stage==='delivered'||completed):completed)&&!start;
 if(!only&&completed&&!items.some(i=>i.type==='Customer acknowledgment'))items.push({key:`${siteId}:completion:missing`,documentId:null,batchLabel:'Completion documents not recorded by QC',type:'Customer acknowledgment',location:'Location not recorded',locationDate:null,tracking:'',carrier:'',history:[],unconfirmable:true});
 const day=today(now);
 const projected:Row[]=items.map((item):Row=>{
  const receipt=receipts.find(r=>r.site_id===siteId&&r.item_key===item.key);
  const status=receipt?'confirmed':item.location==='Submitted to Accounts'?'legacy-handover':item.location==='Received at Karachi office'?'karachi-pending':item.location==='Received at Lahore head office'?'lahore-pending':'pending';
  const statusLabel={confirmed:'Handed over to Accounts','legacy-handover':'Handed over to Accounts (recorded by Operations before Accounts confirmation)','karachi-pending':'Karachi arrival reported — Accounts confirmation pending','lahore-pending':'At Lahore head office — Accounts confirmation pending',pending:'Not yet at Karachi office'}[status];
  const outstanding=status==='pending'||status==='karachi-pending'||status==='lahore-pending';
  const daysOverdue=outstanding&&due&&day>due?daysBetween(due,day):0;
  return {...item,status,statusLabel,receivedOn:receipt?.received_on??null,receivedLate:!!receipt&&!!due&&receipt.received_on>due,daysLate:receipt&&due&&receipt.received_on>due?daysBetween(due,receipt.received_on):0,overdue:daysOverdue>0,daysOverdue};
 });
 return {startDate:start,startBasis:only?'Final delivery date':'Job Completion Date (QC)',dueDate:due,missingStartDate,items:projected,missing:projected.filter(i=>i.status==='pending'||i.status==='karachi-pending'||i.status==='lahore-pending'),overdue:projected.filter(i=>i.overdue)};
}

async function latestSite(c:Db,siteId:string,lock=false){
 if(lock)await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[siteId]);
 const row=(await c.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[siteId])).rows[0];
 if(!row||row.snapshot.superseded||isArchivedLegacySolar({...row.snapshot,id:siteId}))throw new HttpError(404,'Site not found.');
 return row as {version:number;snapshot:Row};
}
async function receiptsFor(c:Db,siteIds?:string[]){
 return (await c.query(`SELECT r.*,r.received_on::text AS received_on,u.display_name AS received_by FROM accounts_original_receipts r JOIN users u ON u.id=r.created_by${siteIds?' WHERE r.site_id=ANY($1::text[])':''} ORDER BY r.created_at,r.id`,siteIds?[siteIds]:[])).rows;
}
/** Accounts popup: existing signed documents, VSO, acknowledgment and QC pictures. */
export async function siteEvidence(pool:Pool,actor:string,siteId:string){
 await new AccountsRepository(pool).access(actor);
 const site=await latestSite(pool,siteId),s=site.snapshot,evidence=projectSiteEvidence(siteId,s);
 const url=(id:string)=>`/api/accounts-workspace/sites/${encodeURIComponent(siteId)}/evidence/${id}`;
 const withUrl=(f:Row)=>({...f,url:url(f.id)});
 return {site:{id:siteId,version:site.version,name:s.name,ipo:accountsIpoLabel(s.ipo,s.name),customer:s.customer??''},signedDos:evidence.signedDos.map(withUrl),vso:evidence.vso.map(withUrl),acknowledgments:evidence.acknowledgments.map(withUrl),pictureGroups:evidence.pictureGroups.map((g:Row)=>({...g,files:g.files.map(withUrl)})),otherDocuments:evidence.otherDocuments.map(withUrl),vsoNotRequired:evidence.vsoNotRequired,originals:projectOriginals(siteId,s,await receiptsFor(pool,[siteId]))};
}
export async function siteEvidenceFile(pool:Pool,actor:string,siteId:string,fileId:string){
 await new AccountsRepository(pool).access(actor);
 const site=await latestSite(pool,siteId);
 if(!evidenceFileIds(siteId,site.snapshot).has(fileId))throw new HttpError(404,'Document file not found.');
 const file=(await pool.query('SELECT filename,media_type,content FROM operations_board_files WHERE site_id=$1 AND id=$2',[siteId,fileId])).rows[0];
 if(!file)throw new HttpError(404,'Document file not found.');
 await pool.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.site-evidence.download:'+fileId]);
 return file as {filename:string;media_type:string;content:Buffer};
}
/** Physical originals for every site, for the Accounts tab and overdue alerts. */
export async function originalsRegister(pool:Pool,actor:string,now=new Date()){
 await new AccountsRepository(pool).access(actor);
 const rows=(await pool.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC')).rows.filter(r=>!r.snapshot.superseded&&!isArchivedLegacySolar({...r.snapshot,id:r.site_id})&&!r.snapshot.cancelled);
 const receipts=await receiptsFor(pool);
 return {sites:rows.map(r=>({id:r.site_id,version:r.version,name:r.snapshot.name,ipo:accountsIpoLabel(r.snapshot.ipo,r.snapshot.name),customer:r.snapshot.customer??'',originals:projectOriginals(r.site_id,r.snapshot,receipts,now)})).filter(r=>r.originals.items.length||r.originals.missingStartDate)};
}

export const originalReceiptSchema=z.object({siteVersion:z.number().int().positive(),items:z.array(z.string().min(1).max(400)).min(1).max(50),receivedOn:z.iso.date(),requestKey:z.uuid()}).strict();
/** Salaas confirms only the originals actually received; each keeps its own date. */
export async function confirmOriginalReceipt(pool:Pool,actor:string,siteId:string,raw:unknown,now=new Date()){
 const input=originalReceiptSchema.parse(raw);
 if(input.receivedOn>today(now))throw new HttpError(422,'Receipt date cannot be in the future.');
 if(new Set(input.items).size!==input.items.length)throw new HttpError(422,'Select each original once.');
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  if(!['Admin','Accounts'].includes(await new AccountsRepository(pool).access(actor,c)))throw new HttpError(403,'Accounts receipt confirmation access required.');
  const replay=(await c.query('SELECT *,received_on::text AS received_on FROM accounts_original_receipts WHERE request_key=$1 ORDER BY item_key',[input.requestKey])).rows;
  if(replay.length){if(replay[0].created_by===actor&&replay[0].site_id===siteId&&Object.entries(input).every(([k,v])=>JSON.stringify(replay[0].request[k])===JSON.stringify(v)))return {receipts:replay};throw new HttpError(409,'Request key already used.');}
  const site=await latestSite(c,siteId,true);
  if(site.version!==input.siteVersion)throw new HttpError(409,'QC updated this site. Reload before confirming receipt.');
  const existing=await receiptsFor(c,[siteId]),originals=projectOriginals(siteId,site.snapshot,existing,now);
  const saved:Row[]=[];
  for(const key of input.items){
   const item=originals.items.find(i=>i.key===key);
   if(!item||item.unconfirmable)throw new HttpError(404,'This original is not a required document for the site.');
   if(item.status==='confirmed')throw new HttpError(409,`${item.type} (${item.batchLabel}) is already confirmed received.`);
   // Accounts confirms originals reported at the Karachi office or at the Lahore head office.
   if(item.status!=='karachi-pending'&&item.status!=='lahore-pending')throw new HttpError(409,`${item.type} (${item.batchLabel}) has not been reported at the Karachi office or the Lahore head office.`);
   if(item.locationDate&&input.receivedOn<item.locationDate)throw new HttpError(422,item.status==='lahore-pending'?'Receipt date cannot be before the Lahore head office arrival.':'Receipt date cannot be before QC reported Karachi arrival.');
   const row=(await c.query('INSERT INTO accounts_original_receipts(id,site_id,item_key,document_id,document_type,received_on,site_version,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *,received_on::text AS received_on',[randomUUID(),siteId,key,item.documentId,item.type,input.receivedOn,site.version,{site:site.snapshot.name,ipo:site.snapshot.ipo,batchLabel:item.batchLabel,dueDate:originals.dueDate,reportedAt:item.locationDate,tracking:item.tracking},input,input.requestKey,actor])).rows[0];
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.original-receipt:'+row.id]);
   saved.push(row);
  }
  return {receipts:saved};
 });
}
