import {historicalInvoiceTerms, issuedInvoiceTerms, invoiceMilestones} from './invoice-milestones.js';
import {withAccountsIpo} from '../../shared/accounts-site-reference.js';
import {ublProgrammeLinks,withProgrammeAccounts} from '../ubl/programme-links.js';
import {partialSolarInvoiceDate} from './partial-solar-delivery.js';
import {invoiceSubmissions,submissionMatches,submissionReferences,submissionBillingBasis} from './invoice-submission-state.js';
import {applyOperationsStages} from './site-projection.js';
import {isArchivedLegacySolar} from '../../shared/legacy-solar-archive.js';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {lockActiveActor} from '../auth/actor-lock.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {AccountsRepository} from './repository.js';
import {billingRows,invoicingQueues,invoiceIdentity} from './billing-model.js';
import {invoiceStages,invoiceMoney,invoiceState,latestInvoiceUpdates,normalizedInvoiceReference,invoiceReferenceParts,entryInvoiceKey,siteInvoiceKey,defaultInvoiceStage,delayReasonLabels} from './invoice-records.js';
export const invoiceEntrySchema=z.object({sourceKind:z.enum(['Operations','Source register']),siteKey:z.string().min(1).max(160),sourceVersion:z.number().int().positive(),milestone:z.enum(['delivery','completion']),ptReference:z.string().trim().min(1).max(200).refine(v=>!(/\s+\/\s+|,|\s*&\s*/.test(v)),'Enter one invoice number per record.'),entryDate:z.iso.date(),notes:z.string().trim().max(2000),invoiceStage:z.enum(invoiceStages).optional(),invoiceLabel:z.string().trim().min(1).max(200).optional(),amount:invoiceMoney.optional(),requestKey:z.uuid()}).strict();
type Db=Pool|PoolClient;
export function operationsInvoiceRows(rows:any[],registers:any[]=[],routing?:{ipoBySite:Map<string,any>;filesBySite:Map<string,Map<string,string>>}){
 const result:any[]=[];
 const sourceRows=registers.flatMap(r=>r.rows??[]);
 for(const row of rows){const s=row.snapshot;
  if(isArchivedLegacySolar({...s,id:row.site_id})||s.superseded||s.cancelled||s.transferred||s.scopePending)continue;
  const exact=sourceRows.filter(r=>row.site_id==='registered-'+r.key||row.site_id===r.recordKey||!!s.sourceKey&&r.key===s.sourceKey||!!s.origin?.ipoId&&r.ipoId===s.origin.ipoId),matches=exact.length?exact:sourceRows.filter(r=>r.ipo===s.ipo&&r.site===s.name);
  const approved=matches.length===1?matches[0]:undefined;
  const terms=routing&&(issuedInvoiceTerms(routing.ipoBySite.get(row.site_id))??historicalInvoiceTerms(exact.length===1?exact[0]:undefined));
  const milestones=terms?invoiceMilestones(row.site_id,s,terms,routing!.filesBySite.get(row.site_id)??new Map(),approved):undefined;
  const deliveryOnly=terms ? terms==='delivery' : s.installation===false||s.projectType==='delivery-only';
  const ups=approved?.kind==='UPS'||s.projectType==='ups';
  const deliveryMilestone=deliveryOnly||!ups&&(approved?.program==='Solar 70'||s.invoiceOnDelivery===true);
  const completionMilestone=!deliveryOnly&&(s.installation===true||ups||approved?.program==='Solar 70');
  const partialInvoiceDate=milestones?milestones.partial:partialSolarInvoiceDate(s,approved);
  const base={deliveryOnly,invoiceTerms:terms,partialDelivery:!!partialInvoiceDate,advance:approved?.advance,completion:approved?.completion,key:row.site_id,sourceKind:'Operations',documentSiteId:row.site_id,sourceVersion:row.version,sourceKey:approved?.key??s.sourceKey??(row.site_id.startsWith('registered-')?row.site_id.slice(11):undefined),customer:s.customer,site:s.name,ipo:s.ipo,po:s.customerPo??s.po??'',program:approved?.program??s.projectType??'',deliveryDate:partialInvoiceDate??s.deliveryDate,installationDate:s.qc?.handover?.date??s.qc?.signoff?.date??s.qcJob?.date,documents:s.documents??[],evidence:(s.documents??[]).flatMap((d:any)=>(d.evidence??[]).filter((f:any)=>z.uuid().safeParse(f.id).success).map((f:any)=>({id:f.id,filename:f.name??'Supporting document',url:`/api/operations-board/sites/${encodeURIComponent(row.site_id)}/files/${f.id}`})))};
  if(milestones?.delivery ?? (deliveryMilestone&&(s.stage==='delivered'||s.stage==='completed'||s.completed===true||!!partialInvoiceDate)))result.push({...base,milestone:'delivery'});
  if(milestones?.completion ?? (completionMilestone&&(s.completed===true||s.stage==='completed')))result.push({...base,milestone:'completion'});
 }
 return result;
}
/** Existing invoices are already frozen in the source register. Link its stable
 * row identity rather than re-importing financial rows or guessing invoice dates. */
export function importedInvoiceEntries(operations:any[],source:any){
 if(!source)return [];
 const rows=source.snapshot.registers.flatMap((r:any)=>r.rows??[]).filter((r:any)=>!r.cancelled&&!r.transferred);
 const nonSystem=new Set([...(source.snapshot.cables?.rows??[]),...(source.snapshot.internet?.rows??[])].map((r:any)=>invoiceIdentity(r.invoice)).filter(Boolean));
 const norm=(v:unknown)=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
 return operations.flatMap(o=>{
  const s=o.snapshot;if(s.cancelled||s.transferred||s.scopePending||!(s.completed===true||s.stage==='completed'||s.stage==='delivered'))return [];
  const stable=rows.filter((r:any)=>o.site_id==='registered-'+r.key);
  const matches=stable.length?stable:rows.filter((r:any)=>norm(r.ipo)===norm(s.ipo)&&norm(r.site)===norm(s.name));
  if(matches.length!==1)return [];
  const row=matches[0],references=[...new Set<string>([...(row.verifiedInvoiceReferences??[]),...(row.invoiceReferences??[])].filter((r:any)=>invoiceIdentity(r)&&((row.verifiedInvoiceReferences??[]).includes(r)||!nonSystem.has(invoiceIdentity(r)))).map((r:any)=>String(r).trim()))];
  if(!references.length)return [];
  const deliveryOnly=s.installation===false||s.projectType==='delivery-only';
  const completed=s.completed===true||s.stage==='completed';
  const knownMilestones=deliveryOnly?['delivery']:row.program==='Solar 70'?[...(row.advance?.invoiceAmount!=null?['delivery']:[]),...(completed&&row.completion?.invoiceAmount!=null?['completion']:[])]:completed?['completion']:[];
  const milestone=knownMilestones.length?knownMilestones.join(' + '):'unconfirmed';
  return [{id:'imported:'+o.site_id+':'+milestone,source_kind:'Source register',site_key:row.key,source_version:source.version,milestone,knownMilestones,pt_reference:references.join(' / '),entry_date:null,imported:true,notes:`Existing invoice references from reviewed Accounts register v${source.version}. Invoice date not recorded in source; balances unchanged.`,snapshot:{site:s.name,ipo:s.ipo,key:o.site_id,sourceKey:row.key,sourceVersion:source.version,references,sourceEvidence:row.sources??[]}}];
 });
}
async function candidates(c:Db){
 let source=(await c.query('SELECT version,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
 if(source)source={...source,snapshot:withProgrammeAccounts(source.snapshot,await ublProgrammeLinks(c))};
 const savedOperations=(await c.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC')).rows;
 // Use stable source identity and current Operations milestones; display IPO suffixes
 // must not recreate work for an already submitted/paid source milestone.
 const confirmedBilling=source?billingRows(source.snapshot.registers,source.snapshot.cables,source.snapshot.internet,source.snapshot.evidence):[];
 const stageOperations=savedOperations.map(o=>({...o,snapshot:{...o.snapshot,completionDate:o.snapshot.qc?.handover?.date??o.snapshot.qc?.signoff?.date??o.snapshot.qcJob?.date??o.snapshot.completionDate}}));
 if(source)source={...source,snapshot:{...source.snapshot,registers:source.snapshot.registers.map((r:any)=>({...r,rows:applyOperationsStages(r.rows,stageOperations).map((row:any)=>({...row,singleInvoiceSubmitted:row.singleInvoiceSubmitted===true||(row.kind==='UPS'&&confirmedBilling.some(b=>b.category==='System'&&b.site===row.site&&b.customer===(row.customer==='MBL'?'Meezan Bank Limited':'United Bank Limited')&&b.submission==='Submitted'&&(row.invoiceReferences??[]).some((ref:any)=>invoiceIdentity(ref)===invoiceIdentity(b.invoice)))),invoiceReferences:[...new Set([...(row.verifiedInvoiceReferences??[]),...(row.invoiceReferences??[]).filter((ref:any)=>invoiceIdentity(ref))])]}))}))}};
 const sourceRows=source?.snapshot.registers.flatMap((r:any)=>r.rows??[])??[];
 const operationsById=new Map(savedOperations.map(s=>[s.site_id,s]));
 const sourceByKey=new Map<string,any[]>();for(const row of sourceRows)sourceByKey.set(row.key,[...(sourceByKey.get(row.key)??[]),row]);
 // Owner confirmed Consumer Hub moved20/60 to2/20 for an extra battery.
 // Scope the invoice-only link to the exact old native record and labels.
 const approvedFor=(o:any)=>{const old=operationsById.get(o.key)?.snapshot;const upgrade=o.key==='live-ipo:ddb6711e-97b3-41a2-9994-22c768cf590c'&&old?.ipo==='CHP-338 · 20/60'&&old?.name==='Consumer Hub Lahore'?'MBL:CHP-233:20-site order:2/20':undefined;const key=upgrade??(o.key.startsWith('registered-')?o.key.slice('registered-'.length):old?.sourceKey);const exact=sourceByKey.get(key)??[];return exact.length===1?exact[0]:undefined;};
 const submitted=(o:any)=>{const row=approvedFor(o);if(!row)return false;return row.program==='Solar 70'?row[o.milestone==='delivery'?'advance':'completion']?.submitted===true||row[o.milestone==='delivery'?'advance':'completion']?.received===true:row.singleInvoiceSubmitted===true||row.singlePaymentReceived===true;};
 const ipos=(await c.query(`SELECT id,jsonb_build_object('input',snapshot->'input','approvedCommercialSource',snapshot->'approvedCommercialSource','customer',jsonb_build_object('shortCode',snapshot#>>'{customer,shortCode}'),'solutionId',snapshot->'solutionId') snapshot FROM internal_purchase_orders`)).rows;
 const ipoById=new Map(ipos.map(i=>[i.id,i.snapshot]));
 const explicitLinks=new Map<string,Set<string>>();
 for(const link of (await c.query('SELECT board_site_id,ipo_id FROM inventory_material_source_links')).rows){
  if(!explicitLinks.has(link.board_site_id))explicitLinks.set(link.board_site_id,new Set());
  explicitLinks.get(link.board_site_id)!.add(link.ipo_id);
 }
 const ipoBySite=new Map<string,any>();
 for(const board of savedOperations){
  const linked=explicitLinks.get(board.site_id);
  const ipoId=board.snapshot.origin?.ipoId??(linked?.size===1?[...linked][0]:undefined);
  if(ipoId&&ipoById.has(ipoId))ipoBySite.set(board.site_id,ipoById.get(ipoId));
 }
 const filesBySite=new Map<string,Map<string,string>>();
 for(const file of (await c.query('SELECT site_id,id,media_type FROM operations_board_files')).rows){
  if(!filesBySite.has(file.site_id))filesBySite.set(file.site_id,new Map());
  filesBySite.get(file.site_id)!.set(file.id,file.media_type);
 }
 const boardsBySourceKey=new Map<string,string[]>();
 for(const board of savedOperations){
  if(board.snapshot.superseded||board.snapshot.cancelled||board.snapshot.transferred)continue;
  const keys=new Set<string>([board.site_id.replace(/^registered-/,''),board.snapshot.sourceKey].filter(Boolean));
  for(const key of keys)boardsBySourceKey.set(key,[...(boardsBySourceKey.get(key)??[]),board.site_id]);
 }
 const exactOperationsKeys=new Set(boardsBySourceKey.keys());
 const attachSite=(row:any)=>{
  const boards=boardsBySourceKey.get(row.sourceKey??row.key)??[];
  return {...row,documentSiteId:boards.length===1?boards[0]:undefined,invoiceTerms:historicalInvoiceTerms(row)};
 };
 const operations=operationsInvoiceRows(savedOperations,source?.snapshot.registers??[],{ipoBySite,filesBySite}),imported=importedInvoiceEntries(savedOperations,source);
 const queues=source?invoicingQueues(source.snapshot.registers):{delivery:[],completion:[],alreadyIssued:[]};
 const sameSite=(a:any,b:any)=>String(a.ipo??'').trim().toLowerCase()===String(b.ipo??'').trim().toLowerCase()&&String(a.site??'').trim().toLowerCase()===String(b.site??'').trim().toLowerCase();
 const issued=(queues.alreadyIssued as any[]);
 const eligibleOperations=operations.filter(o=>!submitted(o)&&!imported.some(e=>e.snapshot.key===o.key&&e.knownMilestones.includes(o.milestone))&&!issued.some(r=>sameSite(r,o)&&(r.milestone===o.milestone||r.milestone==='advance'&&o.milestone==='delivery')));
 const legacy=['delivery','completion'].flatMap(milestone=>(queues[milestone as 'delivery'|'completion'] as any[]).filter(r=>!isArchivedLegacySolar(r)&&!(historicalInvoiceTerms(r)&&exactOperationsKeys.has(r.key))&&!operations.some(o=>o.ipo===r.ipo&&o.site===r.site)).map(r=>({...attachSite(r),sourceKind:'Source register',sourceVersion:source.version,milestone})));
 return {rows:[...eligibleOperations,...legacy],imported,alreadyIssued:issued.filter(r=>!isArchivedLegacySolar(r)).map(r=>({...attachSite(r),sourceKind:'Source register',sourceVersion:source.version,milestone:r.milestone==='advance'?'delivery':r.milestone}))};
}

/** Creation of a PT invoice is separate from submission to the bank. Keep created
 * references in the work queue until the reviewed source confirms submission. */
export function invoiceSubmissionRows(ready:any[],issued:any[],entries:any[],submissions:any[]=[],updates:any[]=[]){
 const result:any[]=[];
 const same=(a:any,b:any)=>(a.key&&b.key&&String(a.key).replace(/^registered-/, '')===String(b.key).replace(/^registered-/, ''))||(String(a.ipo??'').trim().toLowerCase()===String(b.ipo??'').trim().toLowerCase()&&String(a.site??'').trim().toLowerCase()===String(b.site??'').trim().toLowerCase());
 const recorded=entries.filter(e=>e.snapshot?.key).map(e=>({
  ...e.snapshot,key:e.site_key,sourceKind:e.source_kind,sourceVersion:e.source_version,milestone:e.milestone,recordingHeld:true,
  ...(e.source_kind==='Operations'?{documentSiteId:e.site_key}:{}),
 }));
 for(const candidate of [...ready,...issued,...recorded]){
  // Several separate PT invoices may belong to one site milestone, oldest first.
  const own=entries.filter(e=>e.milestone===candidate.milestone&&((e.source_kind===candidate.sourceKind&&e.site_key===candidate.key)||same(e.snapshot,candidate))).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
  const refs=own.length?own.map(e=>e.pt_reference):candidate.invoiceReferences??[];
  const invoiceCreated=own.length>0||issued.includes(candidate);
  const billingStage=candidate.deliveryOnly===true||candidate.installation===false||candidate.projectType==='delivery-only'?'delivery-only':candidate.milestone==='delivery'?'delivery':'completion';
  // A milestone-level submission saved before separate invoices covers every invoice then recorded.
  const legacySubmission=submissions.find(s=>!s.invoice_entry_id&&submissionMatches(candidate,s));
  const invoices=own.map(e=>{const state=invoiceState(e,updates),submission=submissions.find(s=>s.invoice_entry_id===e.id)??legacySubmission;
   return {key:entryInvoiceKey(e.id),entryId:e.id,reference:e.pt_reference,stage:e.invoice_stage??defaultInvoiceStage({...candidate,billingStage}),label:e.invoice_label??null,entryDate:e.entry_date,notes:e.notes,...state,submittedOn:submission?.submitted_on??null,submissionId:submission?.id??null};});
  const siteUpdate=updates.find(u=>u.invoice_key===siteInvoiceKey(candidate));
  const row={...candidate,billingStage,invoiceCreated,invoiceReferences:invoiceCreated?refs:[],invoiceEntryId:own[0]?.id,invoices,legacySubmitted:!!legacySubmission,
   unsubmittedInvoices:invoices.filter(i=>!i.submittedOn).length,missingAmounts:invoices.filter(i=>!i.amount).length,
   siteDelay:!own.length&&siteUpdate?.delay_reason?{key:siteInvoiceKey(candidate),version:siteUpdate.version,reason:siteUpdate.delay_reason,label:delayReasonLabels[siteUpdate.delay_reason as keyof typeof delayReasonLabels],note:siteUpdate.delay_note}:null,siteDelayVersion:siteUpdate?.version??0,siteDelayKey:siteInvoiceKey(candidate)};
  if(!result.some(r=>same(r,row)&&r.milestone===row.milestone))result.push(row);
 }
 return result;
}
/** Invoices to Submit keeps a site while any of its separate invoices is unsubmitted. */
export function pendingSubmission(row:any,submissions:any[]){
 if(row.invoices?.length)return !row.legacySubmitted&&row.invoices.some((i:any)=>!i.submittedOn);
 return !submissions.some(e=>submissionMatches(row,e));
}

export async function invoiceRegister(pool:Pool,actor:string){
 const role=await new AccountsRepository(pool).access(actor);
 const {rows,imported,alreadyIssued}=await candidates(pool),entries=(await pool.query('SELECT *,entry_date::text AS entry_date,amount::text AS amount FROM accounts_invoice_entries ORDER BY created_at DESC')).rows;
 const cableSource=(await pool.query('SELECT version,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
 const extraCable=(cableSource?.snapshot.cables.rows??[]).filter((r:any)=>r.consolidation&&!r.supersededBy&&!r.submittedOn).map((r:any)=>({key:r.key,sourceKind:'Consolidated cable',sourceVersion:cableSource.version,customer:r.program.startsWith('MBL')?'Meezan Bank Limited':'United Bank Limited',site:r.siteLabel,ipo:[...new Set(r.sites.map((s:any)=>s.ipo))].join(' / '),po:r.po??'',evidence:[{id:r.key,filename:r.consolidation.file.name,url:'/api/accounts-workspace/cable-consolidations/'+r.key+'/file'}],program:'Extra Cable',milestone:'cable',invoiceCreated:true,invoiceReferences:[r.invoice],amount:r.invoicedAmount,invoiceDate:r.consolidation.invoiceDate,memberSites:r.sites,status:'Created — submission pending'}));
 const submissions=await invoiceSubmissions(pool),updates=await latestInvoiceUpdates(pool),submissionRows=invoiceSubmissionRows(rows,alreadyIssued,entries,submissions,updates).filter(r=>pendingSubmission(r,submissions));
 for(const entry of [...entries,...imported]){
  const own=entry.imported?[]:submissions.filter(e=>e.invoice_entry_id===entry.id);
  entry.submissions=(own.length?own:submissions.filter(e=>!e.invoice_entry_id&&(entry.knownMilestones??[entry.milestone]).some((milestone:string)=>submissionMatches({key:entry.snapshot.sourceKey??entry.site_key,milestone},e)))).map(e=>({milestone:e.milestone,date:e.submitted_on}));
  if(!entry.imported)Object.assign(entry,invoiceState(entry,updates),{invoiceKey:entryInvoiceKey(entry.id)});
 }
 const shown=(rows:any[])=>rows.map(r=>withAccountsIpo(r));
 const shownQueues=(queues:Record<string,any[]>)=>Object.fromEntries(Object.entries(queues).map(([k,v])=>[k,shown(v)]));
 return relabelRegister({canRecord:['Admin','Accounts'].includes(role),submissions,submissionQueues:{...(extraCable.length?{extraCable}:{}),deliveryOnly:submissionRows.filter(r=>r.billingStage==='delivery-only'),delivery:submissionRows.filter(r=>r.billingStage==='delivery'),completion:submissionRows.filter(r=>r.billingStage==='completion')},queues:{delivery:rows.filter(r=>r.milestone==='delivery'&&!entries.some(e=>((e.source_kind===r.sourceKind&&e.site_key===r.key)||(e.snapshot.ipo===r.ipo&&e.snapshot.site===r.site))&&e.milestone==='delivery')),completion:rows.filter(r=>r.milestone==='completion'&&!entries.some(e=>((e.source_kind===r.sourceKind&&e.site_key===r.key)||(e.snapshot.ipo===r.ipo&&e.snapshot.site===r.site))&&e.milestone==='completion'))},entries:[...entries,...imported.filter(i=>!entries.some(e=>(e.site_key===i.snapshot.key||e.site_key===i.site_key)&&e.milestone===i.milestone))],importedCount:imported.length},shown,shownQueues);
}
/** Display-only reference corrections on the register's screen rows and saved-entry labels. */
function relabelRegister<T extends {submissionQueues:Record<string,any[]>;queues:Record<string,any[]>;entries:any[]}>(register:T,shown:(rows:any[])=>any[],shownQueues:(q:Record<string,any[]>)=>Record<string,any[]>):T{
 return {...register,submissionQueues:shownQueues(register.submissionQueues),queues:shownQueues(register.queues),entries:register.entries.map((e:any)=>({...e,snapshot:withAccountsIpo(e.snapshot??{})}))};
}
export async function recordInvoiceEntry(pool:Pool,actor:string,input:z.infer<typeof invoiceEntrySchema>){
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);
  const role=await new AccountsRepository(pool).access(actor,c);if(!['Admin','Accounts'].includes(role))throw new HttpError(403,'Accounts invoice recording access required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtext('accounts.invoice-register'))");
  const old=(await c.query('SELECT *,entry_date::text AS entry_date FROM accounts_invoice_entries WHERE request_key=$1',[input.requestKey])).rows[0];
  if(old){if(old.created_by===actor&&Object.entries(input).every(([k,v])=>old.request[k]===v))return old;
   throw new HttpError(409,'Request key already used.');}
  if(input.sourceKind==='Operations')await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[input.siteKey]);
  else await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  const source=(await candidates(c)).rows.find(r=>r.sourceKind===input.sourceKind&&r.key===input.siteKey&&r.milestone===input.milestone);
  if(!source||source.sourceVersion!==input.sourceVersion)throw new HttpError(409,'Site milestone or documents changed. Reload and review before recording the invoice.');
  // Duplicate protection is the invoice's own number, not the site milestone: one
  // milestone may carry separate invoices (for example Solar Panels and Remaining System).
  const identity=normalizedInvoiceReference(input.ptReference);
  const saved=(await c.query('SELECT id,pt_reference FROM accounts_invoice_entries')).rows;
  if(saved.some(e=>invoiceReferenceParts(e.pt_reference).includes(identity)))throw new HttpError(409,'This invoice number is already recorded.');
  const register=(await c.query('SELECT snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
  const registerOwners=(register?.snapshot.registers??[]).flatMap((r:any)=>r.rows??[]).filter((r:any)=>[...(r.invoiceReferences??[]),...(r.verifiedInvoiceReferences??[])].some((ref:unknown)=>invoiceReferenceParts(ref).includes(identity)));
  if(registerOwners.some((r:any)=>r.key!==(source.sourceKey??String(input.siteKey).replace(/^registered-/,''))))throw new HttpError(409,'This invoice number belongs to another site in the reviewed Accounts register.');
  const row=(await c.query('INSERT INTO accounts_invoice_entries(id,source_kind,site_key,source_version,milestone,pt_reference,entry_date,notes,snapshot,request,request_key,created_by,invoice_stage,invoice_label,amount,invoice_identity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *,entry_date::text AS entry_date,amount::text AS amount',[randomUUID(),input.sourceKind,input.siteKey,input.sourceVersion,input.milestone,input.ptReference,input.entryDate,input.notes,source,input,input.requestKey,actor,input.invoiceStage??defaultInvoiceStage({...source,billingStage:source.deliveryOnly?'delivery-only':undefined}),input.invoiceLabel??null,input.amount??null,identity])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.invoice-entry:'+row.id]);return row;
 });
}

export const invoiceSubmissionSchema=invoiceEntrySchema.pick({sourceKind:true,siteKey:true,sourceVersion:true,milestone:true,requestKey:true}).extend({submissionDate:z.iso.date(),invoiceEntryId:z.uuid().optional()}).strict();
export async function recordInvoiceSubmission(pool:Pool,actor:string,raw:unknown,now=new Date()){
 const input=invoiceSubmissionSchema.parse(raw),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(input.submissionDate>today)throw new HttpError(422,'Actual submission date cannot be in the future.');
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);const role=await new AccountsRepository(pool).access(actor,c);
  if(!['Admin','Accounts'].includes(role))throw new HttpError(403,'Accounts invoice submission access required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtext('accounts.invoice-register'))");
  const replay=(await c.query('SELECT *,submitted_on::text AS submitted_on FROM accounts_invoice_submissions WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.created_by===actor&&Object.entries(input).every(([k,v])=>replay.request[k]===v))return replay;
   throw new HttpError(409,'Request key already used for another submission.');}
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  if(input.sourceKind==='Operations')await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[input.siteKey]);
  const {rows,imported,alreadyIssued}=await candidates(c),entries=(await c.query('SELECT *,entry_date::text AS entry_date,amount::text AS amount FROM accounts_invoice_entries')).rows;
  const existing=await invoiceSubmissions(c),updates=await latestInvoiceUpdates(c);
  const candidate=invoiceSubmissionRows(rows,alreadyIssued,entries,existing,updates).find(r=>r.sourceKind===input.sourceKind&&r.key===input.siteKey&&r.milestone===input.milestone);
  if(!candidate||candidate.sourceVersion!==input.sourceVersion)throw new HttpError(409,'Invoice or site evidence changed. Refresh and review before marking submitted.');
  if(!candidate.invoiceCreated||!submissionReferences(candidate.invoiceReferences??[]).length)throw new HttpError(409,'Record the invoice reference before marking it submitted.');
  // Each separate invoice is submitted on its own; one saved invoice may be chosen implicitly.
  const separate=candidate.invoices.find((i:any)=>i.entryId===(input.invoiceEntryId??(candidate.invoices.length===1?candidate.invoices[0].entryId:undefined)));
  if(candidate.invoices.length&&!separate)throw new HttpError(422,'Choose which invoice was submitted.');
  if(!candidate.invoices.length&&input.invoiceEntryId)throw new HttpError(409,'Invoice record not found for this site milestone.');
  const invoice=separate?entries.find(e=>e.id===separate.entryId):undefined;
  if(invoice?.entry_date&&input.submissionDate<invoice.entry_date)throw new HttpError(422,'Submission date cannot be before the recorded invoice date.');
  if(existing.some(e=>!e.invoice_entry_id&&submissionMatches(candidate,e)))throw new HttpError(409,'This invoice milestone is already marked submitted.');
  if(separate?.submittedOn)throw new HttpError(409,'This invoice is already marked submitted.');
  if(!separate&&existing.some(e=>submissionMatches(candidate,e)))throw new HttpError(409,'This invoice milestone is already marked submitted.');
  const source=(await c.query('SELECT version,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
  if(source)source.snapshot=withProgrammeAccounts(source.snapshot,await ublProgrammeLinks(c));
  const financial=source?billingRows(source.snapshot.registers,source.snapshot.cables,source.snapshot.internet,source.snapshot.evidence):[];
  const references=separate?[separate.reference]:submissionReferences(candidate.invoiceReferences),id=randomUUID();
  const basis=submissionBillingBasis({...candidate,invoiceReferences:references},source,financial);
  if(basis.held)throw new HttpError(409,'This reference is linked to another reviewed invoice or milestone. Accounts must confirm its exact site link first.');
  const snapshot={site:candidate.site,ipo:candidate.ipo,po:candidate.po,customer:basis.customer,billingIds:basis.billingIds,invoiceReferences:references,invoiceEntryId:invoice?.id??null,invoiceDate:invoice?.entry_date??null,sourceKey:basis.key,...separate?{invoiceAmount:separate.amount,invoiceStage:separate.stage,invoiceLabel:separate.label}:{}};
  const saved=(await c.query('INSERT INTO accounts_invoice_submissions(id,source_kind,site_key,source_key,source_version,milestone,invoice_reference,submitted_on,snapshot,request,request_key,created_by,invoice_entry_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *,submitted_on::text AS submitted_on',[id,input.sourceKind,input.siteKey,basis.key,input.sourceVersion,input.milestone,references.join(' / '),input.submissionDate,snapshot,input,input.requestKey,actor,separate?.entryId??null])).rows[0];
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.invoice-submission:'+id]);return saved;
 });
}
