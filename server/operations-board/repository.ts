import {siteDispatchChoices} from '../inventory/dispatch-document-status.js';
import {queueOperationsEmails} from '../ipo-email/queue.js';
import {withInventoryReceiving} from './inventory-delivery.js';
import {isArchivedLegacySolar} from '../../shared/legacy-solar-archive.js';
import {regionalQcDelegationSql} from './qc-delegation.js';
import {recordDeliveryReturn} from './delivery-return.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {isDeepStrictEqual} from 'node:util';
import {attachHistoricalEvidence} from './historical-evidence.js';
import {validateBatch,type BatchSnapshot} from './batches.js';
import {activeSiteAlerts} from './delays.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {fileSchema,importSchema,movementSchema,commandSchema,vendorSchema,targetsSchema,batchSchema,type BatchInput,type BoardCommand,type BoardSite} from './schema.js';
import {workflowSiteSchema,saveDispatchPlan,confirmDelivery,completeQcStage,completeUpsJob,currentStage,siteBucket as siteBucketForBatch,qcType as qcTypeForBatch,type WorkflowSite,type FileReference,type Entry} from './workflow.js';
import type {z} from 'zod';

type Access={qcDelegated?:boolean;name:string;kind:'owner'|'head'|'lead'|'qc'|'accounts';team:'central'|'south'|null};
const latest='SELECT DISTINCT ON (site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
/** Server-owned records; browser role selectors never authorise access. */
export class OperationsBoardRepository{
 constructor(private pool:Pool){}
 private async access(actor:string,c:Pool|PoolClient=this.pool):Promise<Access>{
  const row=(await c.query(`SELECT u.active,u.role,u.display_name,a.kind,a.team,${regionalQcDelegationSql} AS qc_delegated FROM users u LEFT JOIN operations_board_access a ON a.user_id=u.id WHERE u.id=$1`,[actor])).rows[0];
  if(!row?.active)throw new HttpError(401,'Your access has ended.');
  if(['Admin','Management'].includes(row.role))return {kind:'owner',team:null,name:row.display_name};
  if(row.role==='Accounts')return {kind:'accounts',team:null,name:row.display_name};
  if(row.role==='Operations'&&row.kind)return {kind:row.kind,team:row.team,name:row.display_name,qcDelegated:row.qc_delegated===true};
  throw new HttpError(403,'Operations board access is not assigned.');
 }
 private scope(access:Access,site:BoardSite,documentsOnly=false){
  if(access.kind==='accounts'){if(documentsOnly)return;throw new HttpError(403,'Accounts can view document tracking only.');}
  if(['owner','head'].includes(access.kind))return;
  if(site.operationsTeam!==access.team)throw new HttpError(404,'Site not found in your assigned team.');
 }
 private async current(c:Pool|PoolClient,id:string,lock=false){
  if(lock)await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[id]);
  const row=(await c.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];
  if(!row)throw new HttpError(404,'Operations site not found.');
  const [projected]=await withInventoryReceiving(c,[{...row,site_id:id}]);return projected as {version:number;snapshot:BoardSite};
 }
 async sites(actor:string){
  const access=await this.access(actor);if(access.kind==='accounts')throw new HttpError(403,'Accounts can view document tracking only.');
  const rows=await withInventoryReceiving(this.pool,(await this.pool.query(latest)).rows);
  return {sites:rows.filter(r=>!r.snapshot.superseded&&!isArchivedLegacySolar({...r.snapshot,id:r.site_id})&&(['owner','head'].includes(access.kind)||r.snapshot.operationsTeam===access.team)).map(r=>({...r.snapshot,version:r.version})),access};
 }
 async deliveryDispatches(actor:string,id:string){const site=await this.site(actor,id);return {dispatches:await siteDispatchChoices(this.pool,id,(site as {origin?:{ipoId?:string}}).origin?.ipoId)};}
 async site(actor:string,id:string){const a=await this.access(actor),r=await this.current(this.pool,id);this.scope(a,r.snapshot);return {...r.snapshot,version:r.version};}
 async history(actor:string,id:string,before?:number){
  const a=await this.access(actor),site=await this.current(this.pool,id);this.scope(a,site.snapshot);
  const rows=(await this.pool.query('SELECT v.version,v.action,v.reason,v.created_at,u.display_name AS actor FROM operations_board_versions v JOIN users u ON u.id=v.created_by WHERE v.site_id=$1 AND ($2::integer IS NULL OR v.version<$2) ORDER BY v.version DESC LIMIT 100',[id,before??null])).rows;
  const versions=rows.map(r=>{let reason=r.reason;if(r.action==='Source imported')reason='Reviewed source register imported';else if(r.action.startsWith('Document movement:')){try{reason=JSON.parse(reason).reason||'Document movement recorded';}catch{reason='Document movement recorded';}}return {...r,reason};});
  return {versions,nextBefore:rows.length===100?rows.at(-1)!.version:null};
 }
 async physicalDocuments(actor:string){
  const access=await this.access(actor),rows=(await this.pool.query(latest)).rows;
  if(!rows.length)throw new HttpError(409,'The reviewed Operations site register has not been imported.');
  // Deliberately project documents, not vendors, blockers or arbitrary snapshot data.
  return {sites:rows.filter(r=>!r.snapshot.superseded&&!isArchivedLegacySolar({...r.snapshot,id:r.site_id})&&(['owner','head','accounts'].includes(access.kind)||r.snapshot.operationsTeam===access.team)).map(r=>{
   const s=r.snapshot;return {id:r.site_id,name:s.name,ipo:s.ipo,completed:s.completed===true,version:r.version,documents:s.documents??[],evidencePending:s.evidencePending===true};
  })};
 }
 /** Operator-only import helper; intentionally no HTTP import or blanket snapshot-update endpoint. */
 async importSource(actor:string,input:z.infer<typeof importSchema>){
  const a=await this.access(actor);if(a.kind!=='owner')throw new HttpError(403,'Management approval is required for source imports.');
  const source=importSchema.parse(input),ids=new Set<string>();for(const r of source.rows){if(ids.has(r.id))throw new HttpError(422,'Duplicate source site identity.');ids.add(r.id);}
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   if((await this.access(actor,c)).kind!=='owner')throw new HttpError(403,'Management approval is required for source imports.');
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.import',0))");
   let imported=0,retained=0;
   for(const row of source.rows){
    const old=(await c.query('SELECT 1 FROM operations_board_sites WHERE id=$1',[row.id])).rowCount;
    if(old){retained++;continue;} // Never overwrite ongoing decisions with source positioning.
    await c.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[row.id,actor]);
    await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,$3,$4,$5,$6)',[row.id,row,'Source imported',source.sourceSha256,randomUUID(),actor]);imported++;
   }
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`operations.board.import:${source.sourceSha256}:${imported}`]);return {imported,retained};
  });
 }
 async upload(actor:string,id:string,input:z.infer<typeof fileSchema>){
  const v=fileSchema.parse(input),a=await this.access(actor),site=await this.current(this.pool,id);this.scope(a,site.snapshot);
  if(a.kind==='accounts')throw new HttpError(403,'Operations uploads only.');
  // Canonical round-trip stays linear for 25 MB evidence; a repeated-group
  // regular expression can overflow the engine stack on valid large inputs.
  const content=Buffer.from(v.base64,'base64');
  if(v.base64.length%4!==0||content.toString('base64')!==v.base64)throw new HttpError(422,'File encoding is invalid.');
  const heif=()=>{
   if(content.length<16||content.subarray(4,8).toString()!=='ftyp')return false;
   const length=content.readUInt32BE(0);if(length<16||length>4096||length>content.length)return false;
   const brands=[content.subarray(8,12).toString()];for(let n=16;n+4<=length;n+=4)brands.push(content.subarray(n,n+4).toString());
   return brands.some(b=>['heic','heix','hevc','hevx','heim','heis','mif1','msf1'].includes(b));
  };
  const valid=v.mediaType==='application/pdf'?content.subarray(0,5).toString()==='%PDF-':v.mediaType==='image/png'?content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):v.mediaType==='image/jpeg'?content[0]===255&&content[1]===216&&content[2]===255:v.mediaType==='image/webp'?content.subarray(0,4).toString()==='RIFF'&&content.subarray(8,12).toString()==='WEBP':heif();
  if(!content.length||content.length>26214400||!valid)throw new HttpError(422,'Upload a supported PDF or image up to 25 MB that matches its file type.');
  const sha=createHash('sha256').update(content).digest('hex'),filename=v.filename.replace(/[\x00-\x1f\x7f/\\]/g,'_');
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   const freshAccess=await this.access(actor,c),fresh=await this.current(c,id,true);this.scope(freshAccess,fresh.snapshot);
   const row=(await c.query('INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(site_id,sha256) DO NOTHING RETURNING id,filename AS name,media_type AS "mediaType",sha256',[randomUUID(),id,filename,v.mediaType,sha,content,actor])).rows[0];
   if(row){await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'operations.board.upload:'+row.id]);return row;}
   return (await c.query('SELECT id,filename AS name,media_type AS "mediaType",sha256 FROM operations_board_files WHERE site_id=$1 AND sha256=$2',[id,sha])).rows[0];
  });
 }
 async download(actor:string,id:string,fileId:string){
  const a=await this.access(actor),site=await this.current(this.pool,id);this.scope(a,site.snapshot,true);
  if(a.kind==='accounts'){
   const linked=site.snapshot.inventoryReceiving?.evidenceId===fileId||(site.snapshot.documents??[]).some((d:any)=>(d.evidence??[]).some((f:any)=>f.id===fileId));
   if(!linked)throw new HttpError(404,'Document file not found.');
  }
  const file=(await this.pool.query('SELECT filename,media_type,content FROM operations_board_files WHERE site_id=$1 AND id=$2',[id,fileId])).rows[0]??(site.snapshot.inventoryReceiving?.evidenceId===fileId?(await this.pool.query('SELECT original_name AS filename,media_type,content FROM inventory_material_evidence WHERE id=$1',[fileId])).rows[0]:undefined);
  if(!file)throw new HttpError(404,'Document file not found.');
  await this.pool.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'operations.board.download:'+fileId]);return file;
 }
 async moveDocument(actor:string,id:string,input:z.infer<typeof movementSchema>){
  const v=movementSchema.parse(input);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   const a=await this.access(actor,c),row=await this.current(c,id,true);this.scope(a,row.snapshot);
   if(isArchivedLegacySolar({...row.snapshot,id}))throw new HttpError(409,'Archived legacy Solar sites are read-only. History and documents remain available.');
   const replay=(await c.query('SELECT snapshot,version,action,reason FROM operations_board_versions WHERE site_id=$1 AND request_key=$2',[id,v.requestKey])).rows[0];
   const action=`Document movement:${v.documentId}`,reason=JSON.stringify({...v,requestKey:undefined});
   if(replay){if(replay.action!==action||replay.reason!==reason)throw new HttpError(409,'This request key was already used for a different update.');return {...replay.snapshot,version:replay.version};}
   if(row.version!==v.version)throw new HttpError(409,'This site was updated. Reload before saving your document movement.');
   const docs=row.snapshot.documents??[],doc=docs.find((d:any)=>d.id===v.documentId);if(!doc)throw new HttpError(404,'Document batch not found.');
   if(v.date>today()||(doc.createdDate&&v.date<doc.createdDate)||(!v.edit&&doc.date&&v.date<doc.date))throw new HttpError(422,'Enter a movement date on or after the previous movement and not in the future.');
   if(v.edit&&!v.reason.trim())throw new HttpError(422,'Give a reason for correcting the saved document movement.');
   if(v.location.startsWith('TCS')&&!v.tracking)throw new HttpError(422,'Enter the TCS consignment number.');
   if(v.location==='With delivery driver'&&!v.carrier)throw new HttpError(422,'Enter the driver’s name.');
   const movement={location:v.location,date:v.date,tracking:v.tracking,carrier:v.carrier,recordedAt:new Date().toISOString(),recordedBy:actor,...(v.edit?{correctionReason:v.reason}:{})};
   const snapshot={...row.snapshot,documents:docs.map((d:any)=>d.id===v.documentId?{...d,...movement,history:[...(d.history??[]),movement]}:d)};
   await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,row.version+1,snapshot,action,reason,v.requestKey,actor]);
   await c.query('INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,row.version+1,v.edit?'Document movement corrected':'Physical document updated',JSON.stringify(v.edit?['accounts','operations-head','management']:['accounts']),actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`operations.board.document-movement:${id}:${row.version+1}`]);return {...snapshot,version:row.version+1};
  });
 }

 async batches(actor:string){
  const a=await this.access(actor);if(!['owner','head','lead'].includes(a.kind))throw new HttpError(403,'Batch planning belongs to the Operations lead.');
  const rows=(await this.pool.query('SELECT DISTINCT ON (batch_id) batch_id,version,snapshot FROM operations_board_batch_versions ORDER BY batch_id,version DESC')).rows;
  const current=(await this.pool.query(latest)).rows,sites=new Map(current.map(r=>[r.site_id,r]));
  return {batches:rows.filter(r=>['owner','head'].includes(a.kind)||r.snapshot.team===a.team).map(r=>{
   const snapshot=r.snapshot as BatchSnapshot,stops=snapshot.stops.filter(s=>['owner','head'].includes(a.kind)||sites.get(s.siteId)?.snapshot.operationsTeam===a.team).map(s=>({...s,siteVersion:sites.get(s.siteId)?.version}));
   return {...snapshot,version:r.version,stops,canEdit:stops.length===snapshot.stops.length};
  })};
 }
 async saveBatch(actor:string,input:BatchInput){
  const v=batchSchema.parse(input),fingerprint=createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   const a=await this.access(actor,c);if(!['owner','head','lead'].includes(a.kind))throw new HttpError(403,'Batch planning belongs to the Operations lead.');
   if(a.kind==='lead'&&a.team!==v.team)throw new HttpError(403,'Select your assigned Operations team.');
   // One booking transaction across teams prevents vehicle/labour double bookings.
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.batches',0))");
   const replay=(await c.query('SELECT version,snapshot,request_sha256 FROM operations_board_batch_versions WHERE request_key=$1',[v.requestKey])).rows[0];
   if(replay){if(a.kind==='lead'&&replay.snapshot.team!==a.team)throw new HttpError(404,'Batch not found.');for(const stop of replay.snapshot.stops){const site=await this.current(c,stop.siteId);this.scope(a,site.snapshot);}if(replay.request_sha256!==fingerprint)throw new HttpError(409,'This request key was used for another batch decision.');return {...replay.snapshot,version:replay.version};}
   const rows=(await c.query('SELECT DISTINCT ON (batch_id) batch_id,version,snapshot FROM operations_board_batch_versions ORDER BY batch_id,version DESC')).rows;
   const previous=v.id?rows.find(r=>r.batch_id===v.id):undefined;
   if(v.id&&!previous)throw new HttpError(404,'Batch not found.');
   if(previous&&a.kind==='lead'&&previous.snapshot.team!==a.team)throw new HttpError(404,'Batch not found.');
   if((previous?.version??0)!==v.version)throw new HttpError(409,'The batch was updated. Reload before saving.');
   if(previous&&!v.edit)throw new HttpError(409,'The saved batch is locked. Click Edit first.');
   if(previous&&!v.reason)throw new HttpError(422,'Give a reason for changing the saved batch.');
   const selected:WorkflowSite[]=[],versions=new Map<string,number>();
   for(const stop of [...v.stops,...v.cancelledSites].sort((a,b)=>a.siteId.localeCompare(b.siteId))){
    const row=await this.current(c,stop.siteId,true);this.scope(a,row.snapshot);
    if(row.version!==stop.siteVersion)throw new HttpError(409,'A selected site changed. Reload the batch before saving.');
    selected.push(workflowSiteSchema.parse(row.snapshot));versions.set(stop.siteId,row.version);
   }
   const vendors=await this.vendorList(c);
   if(v.labourTeam&&!(previous?.snapshot.labourTeam===v.labourTeam)){const vendor=vendors.find(r=>r.id===v.labourTeam);if(!vendor?.active||!vendor.roles.includes('electrical')||vendor.kind!=='vendor'||!vendor.internal&&vendor.team!==v.team)throw new HttpError(422,'Choose an active electrical labour team.');}
   if(v.vehicle&&v.vehicle!==previous?.snapshot.vehicle){const matches=vendors.filter(r=>r.kind==='vehicle'&&r.name.toLowerCase()===v.vehicle.toLowerCase());if(matches.length&&!matches.some(r=>r.team===v.team&&r.active))throw new HttpError(422,'Choose a vehicle available in this region.');}
   const stops=validateBatch(v,selected,rows.map(r=>r.snapshot as BatchSnapshot),previous?.snapshot);
   const now=new Date().toISOString(),id=v.id??randomUUID(),number=previous?.snapshot.number??`OPB-${now.slice(0,10).replaceAll('-','')}-${String(rows.length+1).padStart(3,'0')}`;
   const snapshot:BatchSnapshot={id,number,deliveryDate:v.deliveryDate,team:v.team,kind:v.kind,vehicle:v.vehicle,driver:v.driver,labourTeam:v.labourTeam,inventoryReference:v.inventoryReference,stops,createdAt:previous?.snapshot.createdAt??now,updatedAt:now,plannedBy:a.name};
   await c.query('INSERT INTO operations_board_batch_versions(batch_id,version,number,snapshot,request_key,request_sha256,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,v.version+1,number,snapshot,v.requestKey,fingerprint,v.reason||'Initial shared batch plan',actor]);
   for(const original of selected.filter(site=>stops.some(stop=>stop.siteId===site.id))){
    const stop=stops.find(s=>s.siteId===original.id)!,kind=stop.kind??v.kind;let site:WorkflowSite={...original,operationsTeam:original.operationsTeam??v.team,stageStartedAt:original.stageStartedAt??now};
    if(site.installation!==false&&stop.plannedDate)site={...site,installationPlanDate:stop.plannedDate};
    if(kind!=='labour'&&siteBucketForBatch(site)!=='completed'&&site.stage!=='delivered'){
     const date=v.deliveryDate!;
     if(site.dispatchDate&&site.dispatchDate!==date)site=saveDispatchPlan(site,{dispatchDate:date,assignments:site.assignments??{}},now,true);
     else if(!site.dispatchDate){const required=site.installation?qcTypeForBatch(site)==='ups'?['electrical','delivery']:['structure','electrical','earthing','delivery']:['delivery'];if(required.every(role=>site.assignments?.[role]))site=saveDispatchPlan(site,{dispatchDate:date,assignments:site.assignments??{}},now);}
    }
    // A site's copy contains only its own stop. Other-team identities never leak
    // through a site snapshot after an individual team reassignment.
    const link={...snapshot,stops:[stop]},links=Array.isArray(site.planningBatches)?site.planningBatches as {id:string}[]:[];
    const accountsEvent={id:`${id}:${site.id}:schedule`,type:'Batch plan',date:now,ipo:site.ipo,site:site.name,dispatchDate:kind==='labour'?undefined:v.deliveryDate,description:`${number} · delivery ${v.deliveryDate??'not part of this batch'} · expected installation ${stop.plannedDate||'not applicable'}${stop.start&&stop.end?' '+stop.start+'–'+stop.end:''}. Evidence remains pending.`};
    const updated={...site,planningBatches:[...links.filter(b=>b.id!==id),link],accounts:[...site.accounts.filter(e=>e.id!==accountsEvent.id),accountsEvent],history:[...site.history,{date:now,description:`${number}: delivery ${v.deliveryDate??'not part of this batch'}; expected installation ${stop.plannedDate||'not applicable'}${stop.start&&stop.end?' '+stop.start+'–'+stop.end:''}.${v.reason?' Reason: '+v.reason:''}`}]};
    const version=versions.get(site.id)!+1;
    await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,request_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[site.id,version,updated,'Batch plan',v.reason||'Initial shared batch plan',v.requestKey,fingerprint,actor]);
    await c.query('INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),site.id,version,previous?'Batch plan changed':'Batch plan',JSON.stringify(previous?['operations-head','management',`${v.team}-operations`,'accounts']:['accounts']),actor]);
   }
   for(const cancelled of v.cancelledSites){
    const original=selected.find(site=>site.id===cancelled.siteId)!;
    const links=original.planningBatches.filter(batch=>batch.id!==id);
    const updated={...original,planningBatches:links,accounts:original.accounts.filter(event=>event.id!==`${id}:${original.id}:schedule`),history:[...original.history,{date:now,description:`${number}: site cancelled from batch. Reason: ${v.reason}`}]};
    if(original.stage!=='delivered'&&previous?.snapshot.deliveryDate===original.dispatchDate&&!links.some(batch=>batch.deliveryDate&&batch.stops.some((stop:any)=>stop.siteId===original.id&&(stop.kind??batch.kind)!=='labour')))delete updated.dispatchDate;
    const version=versions.get(original.id)!+1;
    await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,request_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[original.id,version,updated,'Batch site cancelled',v.reason,v.requestKey,fingerprint,actor]);
    await c.query('INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),original.id,version,'Batch site cancelled',JSON.stringify(['operations-head','management',`${v.team}-operations`,'accounts']),actor]);
   }
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`operations.board.batch:${id}:${v.version+1}`]);return {...snapshot,version:v.version+1};
  });
 }
 private async vendorList(c:Pool|PoolClient){
  const rows=(await c.query('SELECT DISTINCT ON (vendor_id) vendor_id,version,snapshot FROM operations_board_vendor_versions ORDER BY vendor_id,version DESC')).rows;
  return [{id:'pz-team',version:1,name:'Power Zone team',phone:'',roles:['electrical'],active:true,internal:true,deleted:false,team:null as string|null,kind:'vendor'},...rows.map(r=>({...r.snapshot,id:r.vendor_id,version:r.version,internal:false,deleted:r.snapshot.deleted===true,team:r.snapshot.team??null,kind:r.snapshot.kind??'vendor'}))];
 }
 async vendors(actor:string){const a=await this.access(actor);if(!['owner','head','lead'].includes(a.kind))throw new HttpError(403,'Vendor management belongs to the Operations lead.');return {vendors:(await this.vendorList(this.pool)).filter(v=>(v.internal||(v.kind??'vendor')==='vendor')&&(a.kind!=='lead'||v.internal||!v.deleted&&v.team===a.team))};}
 async resources(actor:string,kind:'member'|'vehicle'){
  const a=await this.access(actor);if(!['owner','head','lead'].includes(a.kind))throw new HttpError(403,'Resource management belongs to the Operations lead.');
  return {resources:(await this.vendorList(this.pool)).filter(v=>!v.internal&&v.kind===kind&&(a.kind!=='lead'||!v.deleted&&v.team===a.team))};
 }
 async saveVendor(actor:string,input:z.infer<typeof vendorSchema>){
  const v=vendorSchema.parse(input),fingerprint=createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   const a=await this.access(actor,c);if(!['owner','head','lead'].includes(a.kind))throw new HttpError(403,'Vendor management belongs to the Operations lead.');
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.vendors',0))");
   const replay=(await c.query('SELECT vendor_id,version,snapshot,request_sha256 FROM operations_board_vendor_versions WHERE request_key=$1',[v.requestKey])).rows[0];
   if(replay){if(a.kind==='lead'&&(replay.snapshot.deleted||replay.snapshot.team!==a.team))throw new HttpError(404,'Vendor not found.');if(replay.request_sha256!==fingerprint)throw new HttpError(409,'This request key was used for another vendor update.');return {...replay.snapshot,id:replay.vendor_id,version:replay.version};}
   const vendors=await this.vendorList(c),old=v.id?vendors.find(r=>r.id===v.id):undefined;
   if(v.id&&(!old||a.kind==='lead'&&(old.deleted||old.team!==a.team)))throw new HttpError(404,'Vendor not found.');
   if(a.kind==='lead'&&v.deleted!==undefined)throw new HttpError(403,'Only the Operations head can delete or restore resources.');
   if(v.deleted!==undefined&&!old)throw new HttpError(422,'Save the resource before deleting it.');
   if(old&&(old.kind??'vendor')!==v.kind)throw new HttpError(422,'The saved resource type cannot change.');
   if(a.kind==='lead'&&v.team&&v.team!==a.team)throw new HttpError(403,'Use your assigned region.');
   const team=a.kind==='lead'?a.team:v.team??old?.team??null;
   if((old?.version??0)!==v.version)throw new HttpError(409,'The vendor was updated. Reload before saving.');
   if(old&&!v.reason)throw new HttpError(422,'Give a reason for changing the saved vendor.');
   if(vendors.some(r=>r.id!==v.id&&r.team===team&&(r.kind??'vendor')===v.kind&&r.name.toLowerCase()===v.name.toLowerCase()))throw new HttpError(409,'This vendor is already saved. Edit the existing record.');
   const deleted=v.deleted??old?.deleted??false;
   const id=v.id??randomUUID(),snapshot={name:v.name,phone:v.phone,roles:[...new Set(v.roles)],active:deleted?false:v.active,team,kind:v.kind,deleted};
   await c.query('INSERT INTO operations_board_vendor_versions(vendor_id,version,snapshot,request_key,request_sha256,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,v.version+1,snapshot,v.requestKey,fingerprint,v.reason||'Initial vendor',actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`operations.board.vendor:${id}:${v.version+1}`]);return {...snapshot,id,version:v.version+1};
  });
 }
 async targets(actor:string){const a=await this.access(actor);if(a.kind==='accounts')throw new HttpError(403,'Accounts can view document tracking only.');return (await this.pool.query('SELECT version,values,reason,created_at FROM operations_board_target_versions ORDER BY version DESC LIMIT 1')).rows[0]??{version:0,values:{}};}
 async alerts(actor:string,now=new Date().toISOString()){const [board,targets]=await Promise.all([this.sites(actor),this.targets(actor)]);return {sites:activeSiteAlerts(board.sites.map(s=>workflowSiteSchema.parse(s)),targets.values,now),asOf:now};}
 async saveTargets(actor:string,input:z.infer<typeof targetsSchema>){
  const v=targetsSchema.parse(input),fingerprint=createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   const a=await this.access(actor,c);if(!['owner','head'].includes(a.kind))throw new HttpError(403,'Moaz manages Operations stage targets.');
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.targets',0))");
   const replay=(await c.query('SELECT version,values,request_sha256 FROM operations_board_target_versions WHERE request_key=$1',[v.requestKey])).rows[0];
   if(replay){if(replay.request_sha256!==fingerprint)throw new HttpError(409,'This request key was used for another target update.');return {version:replay.version,values:replay.values};}
   const old=(await c.query('SELECT version,values FROM operations_board_target_versions ORDER BY version DESC LIMIT 1')).rows[0];
   if((old?.version??0)!==v.version)throw new HttpError(409,'Targets changed. Reload before saving.');
   if(old&&!v.reason)throw new HttpError(422,'Give a reason for changing the saved targets.');
   if(old&&isDeepStrictEqual(old.values,v.values))throw new HttpError(422,'No stage targets changed.');
   await c.query('INSERT INTO operations_board_target_versions(version,values,request_key,request_sha256,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)',[v.version+1,v.values,v.requestKey,fingerprint,v.reason||'Initial stage targets',actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`operations.board.targets:${v.version+1}`]);
   // Keep the reviewed Management-only notification; Moaz receives no target-change alert.
   await c.query('INSERT INTO operations_board_target_events(version) VALUES($1)',[v.version+1]);
   return {version:v.version+1,values:v.values};
  });
 }
 private async references(c:PoolClient,id:string,ids:string[]){
  const rows=ids.length?(await c.query('SELECT id,filename AS name,media_type AS "mediaType" FROM operations_board_files WHERE site_id=$1 AND id=ANY($2::uuid[])',[id,ids])).rows:[];
  if(new Set(ids).size!==rows.length)throw new HttpError(422,'An evidence file is missing or belongs to a different site.');
  return new Map(rows.map((r:FileReference)=>[r.id,r]));
 }
 async command(actor:string,id:string,input:BoardCommand){
  const v=commandSchema.parse(input),fingerprint=createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   const a=await this.access(actor,c),row=await this.current(c,id,true);this.scope(a,row.snapshot);
   if(isArchivedLegacySolar({...row.snapshot,id}))throw new HttpError(409,'Archived legacy Solar sites are read-only. History and documents remain available.');
   if(v.action==='delivery-return'&&!['owner','head','lead'].includes(a.kind))throw new HttpError(403,'Returned delivery belongs to the assigned Operations lead.');
   if(v.action==='assign-team'&&!['owner','head'].includes(a.kind))throw new HttpError(403,'Only Moaz or Management can assign Operations teams.');
   if(v.action==='plan'&&!['owner','head','lead'].includes(a.kind))throw new HttpError(403,'Dispatch planning belongs to the assigned Operations lead.');
   if(['qc','ups-job'].includes(v.action)&&!['owner','head','qc'].includes(a.kind)&&!a.qcDelegated)throw new HttpError(403,'Only the assigned QC team can record installation progress.');
   if(v.action==='historical-evidence'&&v.category==='handover'&&!['owner','head','qc'].includes(a.kind)&&!a.qcDelegated)throw new HttpError(403,'Only the assigned QC team can attach installation handover evidence.');
   const replay=(await c.query('SELECT version,snapshot,request_sha256 FROM operations_board_versions WHERE site_id=$1 AND request_key=$2',[id,v.requestKey])).rows[0];
   if(replay){if(replay.request_sha256!==fingerprint)throw new HttpError(409,'This request key was used for a different site decision.');return {...replay.snapshot,version:replay.version};}
   if(row.version!==v.version)throw new HttpError(409,'The site was updated. Reload before saving your decision.');
   if(v.edit&&!v.reason)throw new HttpError(422,'Give a reason for editing the saved decision.');
   const site=workflowSiteSchema.parse(row.snapshot),now=new Date().toISOString();
   let snapshot:WorkflowSite,kind:string,audiences:string[]=['operations-head','management'];
   if(v.edit&&v.action==='plan'&&site.dispatchDate===v.dispatchDate&&isDeepStrictEqual(site.assignments??{},v.assignments)&&isDeepStrictEqual(site.teamMembers?.map(m=>m.id)??[],v.teamMemberIds??site.teamMembers?.map(m=>m.id)??[]))throw new HttpError(422,'Nothing changed. Cancel editing or update the dispatch plan.');
   if(v.action==='assign-team'){
    if(v.edit&&!site.operationsTeam)throw new HttpError(409,'There is no saved team assignment to edit.');
    if(site.operationsTeam&&!v.edit)throw new HttpError(409,'The saved team assignment is locked. Use Edit and give a reason.');
    if(site.operationsTeam===v.team)throw new HttpError(422,'This team is already assigned.');
    snapshot={...site,operationsTeam:v.team,stageStartedAt:site.stageStartedAt??now,history:[...site.history,{date:now,description:`${a.name} assigned this site to ${v.team==='central'?'Central':'South'} Operations.${v.edit?' Reason: '+v.reason:''}`}]};kind='Operations team assigned';
   }else if(v.action==='plan'){
    const vendors=await this.vendorList(c);
    for(const [role,selected] of Object.entries(v.assignments)){const vendor=vendors.find(r=>r.id===selected);if(!(v.edit&&site.assignments?.[role]===selected)&&(!vendor?.active||!vendor.roles.includes(role)||vendor.kind!=='vendor'||!vendor.internal&&vendor.team!==site.operationsTeam))throw new HttpError(422,'Choose an active vendor for each applicable service.');}
    const teamMembers=v.teamMemberIds===undefined?site.teamMembers??[]:v.teamMemberIds.map(id=>{const member=vendors.find(r=>r.id===id);if(!member||member.kind!=='member'||member.team!==site.operationsTeam||!member.active&&!site.teamMembers?.some(r=>r.id===id))throw new HttpError(422,'Choose active team members from this site region.');return {id:member.id,name:member.name};});
    if(teamMembers.length&&!v.assignments.electrical)throw new HttpError(422,'Choose the electrical labour team before adding members.');
    snapshot=saveDispatchPlan(site,{dispatchDate:v.dispatchDate,assignments:v.assignments,teamMembers},now,v.edit);if(site.installation!==false)snapshot={...snapshot,installationPlanDate:v.dispatchDate};kind='Dispatch plan';audiences=['accounts'];
   }else if(v.action==='delivery-return'){
    snapshot=recordDeliveryReturn(site,v,now);kind='Delivery returned';audiences=['operations-head','management','accounts','inventory'];
    }else if(v.action==='delivery'){
    const choices=await siteDispatchChoices(c,id,(site as {origin?:{ipoId?:string}}).origin?.ipoId);
    if(choices.length&&!v.dispatchId)throw new HttpError(422,'Select the dispatched DO so its signed copy reaches Inventory.');
    if(v.dispatchId){
     if(!choices.some(d=>d.id===v.dispatchId))throw new HttpError(422,'Select an actually dispatched DO for this exact site.');
     const existing=v.edit?site.deliveries?.slice(0,-1):site.deliveries;
     if(existing?.some(d=>d.dispatchId===v.dispatchId))throw new HttpError(422,'This DO is already linked to a delivery. Edit that delivery instead.');
    }
    const files=await this.references(c,id,[v.signedDoId,v.materialPhotoId]),value={...(v.dispatchId?{dispatchId:v.dispatchId}:{}),deliveryDate:v.deliveryDate,signedDo:files.get(v.signedDoId)!,materialPhoto:files.get(v.materialPhotoId)!,partial:v.partial};
    if(!value.materialPhoto.mediaType.startsWith('image/'))throw new HttpError(422,'Upload a photo of the delivered material.');
    if(v.edit){
     const old=site.deliveries?.at(-1);if(!old)throw new HttpError(409,'There is no saved delivery record to edit.');
     if(v.dispatchId===old.dispatchId&&v.deliveryDate===old.deliveryDate&&v.signedDoId===old.signedDo.id&&v.materialPhotoId===old.materialPhoto.id&&v.partial===old.partial)throw new HttpError(422,'Nothing changed. Cancel editing or update the delivery record.');
     if(v.partial!==old.partial)throw new HttpError(422,'Record remaining material as a new delivery instead of changing a saved partial delivery.');
     const qcDates=[...Object.values(site.qc??{}),...(site.qcJob?[site.qcJob]:[])].map(q=>q.date).sort();
     if(qcDates[0]&&v.deliveryDate>qcDates[0])throw new HttpError(422,'Delivery cannot be moved after a recorded QC stage.');
     confirmDelivery({...site,stage:'awaiting',deliveries:site.deliveries?.slice(0,-1)},value,now);
     snapshot={...site,...value,deliveries:[...site.deliveries!.slice(0,-1),{...value,documentId:old.documentId}],documents:(site.documents??[]).map(d=>d.id===(old.documentId??old.signedDo.id)?{...d,evidence:[value.signedDo]}:d),accounts:site.accounts.map(e=>(old.documentId?e.documentId===old.documentId:Array.isArray(e.evidence)&&e.evidence.includes(old.signedDo.id))?{...e,deliveryDate:value.deliveryDate,evidence:[value.signedDo.id,value.materialPhoto.id],correctedAt:now}:e),history:[...site.history,{date:now,description:`${a.name} corrected the delivery. Reason: ${v.reason}`}]};
    }else snapshot=confirmDelivery(site,value,now);
    kind=v.partial?'Partial delivery update':site.invoiceOnDelivery?'Delivery invoice due':'Delivery update';audiences=['accounts'];
   }else if(v.action==='qc'||v.action==='ups-job'){
    const ids=[...v.evidenceIds,...[v.acknowledgementId,v.irrId,v.variableSignoffId].filter((s):s is string=>!!s)],files=await this.references(c,id,ids);
    const value:Entry={date:v.date,evidence:files.get(v.evidenceIds[0]),additionalEvidence:v.evidenceIds.slice(1).map(f=>files.get(f)!),acknowledgement:v.acknowledgementId?files.get(v.acknowledgementId):undefined,irr:v.irrId?files.get(v.irrId):undefined,variableSignoff:v.variableSignoffId?files.get(v.variableSignoffId):undefined};
    if(v.edit){const old=v.action==='qc'?site.qc?.[v.stageId]:site.qcJob;if(old&&old.date===value.date&&isDeepStrictEqual([old.evidence?.id,...(old.additionalEvidence??[]).map(f=>f.id)].filter(Boolean),v.evidenceIds)&&old.acknowledgement?.id===value.acknowledgement?.id&&old.irr?.id===value.irr?.id&&old.variableSignoff?.id===value.variableSignoff?.id)throw new HttpError(422,'Nothing changed. Cancel editing or update the QC record.');}
    snapshot=v.action==='qc'?completeQcStage(site,v.stageId,value,now,v.edit):completeUpsJob(site,{...value,checks:v.checks},now,v.edit);
    kind=snapshot.completed?'Installation completed':'QC stage completed';audiences=snapshot.completed?['accounts']:['operations-head'];
   }else if(v.action==='historical-evidence'){
    const ids=v.category==='delivery'?[v.signedDoId,v.materialPhotoId]:[v.acknowledgementId,v.irrId,v.variableSignoffId];
    if(ids.some(id=>!id))throw new HttpError(422,v.category==='delivery'?'Upload the signed DO and material photo.':'Upload the acknowledgement, IRR and variable-items sign-off.');
    const files=await this.references(c,id,ids as string[]),references=(ids as string[]).map(file=>files.get(file)!);
    if(v.category==='delivery'&&!references[1].mediaType.startsWith('image/'))throw new HttpError(422,'Upload a photo of the delivered material.');
    snapshot=attachHistoricalEvidence(site,{category:v.category,date:v.date,files:references},now,v.edit);kind='Existing site evidence recorded';audiences=['accounts'];
   }else if(v.action==='blocker'){
    if(v.edit)throw new HttpError(422,'Resolve the saved blocker or add a new reason.');
    const stage=currentStage(site);if(site.blockers.some(b=>b.status==='open'&&b.stage===stage&&b.reason===v.text))throw new HttpError(409,'This blocker reason is already recorded.');
    const blocker={id:randomUUID(),reason:v.text,stage,status:'open' as const,raisedAt:now,raisedBy:a.name,actorId:actor};
    snapshot={...site,blockers:[...site.blockers,blocker],history:[...site.history,{date:now,description:`${a.name} raised a blocker at ${stage}: ${v.text}`}]};kind='Site blocker raised';audiences=['operations-head','management',...(site.operationsTeam?[`${site.operationsTeam}-operations`]:[])];
   }else{
    const blocker=site.blockers.find(b=>b.id===v.blockerId&&b.status==='open');if(!blocker)throw new HttpError(409,'This blocker is not open.');
    snapshot={...site,blockers:site.blockers.map(b=>b.id===v.blockerId?{...b,status:'resolved' as const,resolution:v.resolution,resolvedAt:now,resolvedBy:a.name}:b),history:[...site.history,{date:now,description:`${a.name} resolved the blocker: ${v.resolution}`}]};kind='Site blocker resolved';
   }
   if(v.edit){kind='Saved site decision changed';audiences=[...new Set([...audiences,'operations-head','management'])];}
   await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,request_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,row.version+1,snapshot,v.action,v.reason||'Initial decision',v.requestKey,fingerprint,actor]);
   await queueOperationsEmails(c,actor,site,{...snapshot,id});
   await c.query('INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,row.version+1,kind,JSON.stringify(audiences),actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`operations.board.${v.action}:${id}:${row.version+1}`]);
   return {...snapshot,version:row.version+1};
  });
 }

}
