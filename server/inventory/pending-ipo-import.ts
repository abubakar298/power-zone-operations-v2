import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {ProjectWorkflowRepository} from '../project-workflow/repository.js';
import {frameworkBasis} from '../project-workflow/basis.js';
import {linkMaterialSource} from './source-links.js';
import {validOrderPosition} from '../../shared/direct-po-reading.js';
const schema=z.object({boardSiteId:z.string().min(1).max(160),boardVersion:z.number().int().positive(),sourceVersion:z.number().int().positive(),frameworkId:z.uuid(),requestKey:z.uuid(),reason:z.string().trim().min(1).max(2000)}).strict();
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const normalized=(v:unknown)=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
const date=z.iso.date();
export function historicalPoDate(value:unknown){
 const raw=typeof value==='string'?value.trim():'';
 const named=raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/),months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 const month=named?months.indexOf(named[2].toLowerCase())+1:0;
 const iso=named&&month?`${named[3]}-${String(month).padStart(2,'0')}-${named[1].padStart(2,'0')}`:raw;
 const checked=date.safeParse(iso);if(!checked.success)throw new HttpError(422,'The source PO date must be a valid ISO date or d-Mmm-yyyy date.');return checked.data;
}
/** Explicit operator-only historical import, never an HTTP shortcut around PO uploads.
 * The source remains labelled as a register; no original customer scan is invented.
 * Existing approved framework/numbering/BOQ/PT issuance code owns all calculations.
 */
export async function importPendingIpo(pool:Pool,actor:string,raw:z.infer<typeof schema>,client?:PoolClient){
 const input=schema.parse(raw),repo=new ProjectWorkflowRepository(pool);
 const execute=async(c:PoolClient)=>{
  await lockActiveActor(c,actor);
  const user=await repo.user(actor,c);if(!['Admin','Management'].includes(user.role))throw new HttpError(403,'Management authorisation is required for historical IPO imports.');
  await c.query('SELECT pg_advisory_xact_lock(742019004)');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('historical.pending.ipo.import',0))");
  const replay=(await c.query('SELECT * FROM historical_pending_ipo_imports WHERE request_key=$1',[input.requestKey])).rows[0];
  if(replay){if(replay.created_by!==actor||replay.request_sha256!==sha(input))throw new HttpError(409,'This request key belongs to another historical import.');return {ipoId:replay.ipo_id,recordId:replay.record_id,unchanged:true};}
  const source=(await c.query('SELECT id,version,source_sha256,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
  if(!source||source.version!==input.sourceVersion)throw new HttpError(409,'The reviewed source register changed. Recheck the latest version.');
  const board=(await c.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[input.boardSiteId])).rows[0];
  if(!board||board.version!==input.boardVersion)throw new HttpError(409,'The site positioning changed. Recheck the latest version.');
  const b=board.snapshot;
  if(b.sample||b.completed||!['received','awaiting'].includes(b.stage))throw new HttpError(409,'Only original sites still pending delivery can be imported here.');
  const candidates=source.snapshot.registers.flatMap((r:any)=>r.rows).filter((r:any)=>r.key===b.sourceKey);
  if(candidates.length!==1)throw new HttpError(409,'The source site identity is missing or ambiguous.');
  const row=candidates[0],bank=String(row.key).split(':')[0].toUpperCase();
  for(const field of ['cancelled','transferred','delivered','installed','canIssue'])if(row[field]!==undefined&&typeof row[field]!=='boolean')throw new HttpError(422,'Review the source status field '+field+' before importing.');
  if(!['UBL','MBL'].includes(bank)||row.cancelled===true||row.transferred===true||row.delivered===true||row.installed===true||row.canIssue===false)throw new HttpError(409,'This source position is not an active pending-delivery order.');
  const po=z.string().trim().min(1).max(200).parse(row.po),poDate=historicalPoDate(row.poDate),number=z.string().trim().regex(/^CHP-\d+$/).parse(row.ipo),order=String(row.orderNumber??'').trim(),isUps=row.kind==='UPS';
  if(poDate>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))throw new HttpError(409,'The source PO date is in the future.');
  if(isUps&&!validOrderPosition(order))throw new HttpError(409,'A shared UPS IPO requires a valid distinct order number.');
  if(normalized(b.ipo)!==normalized(number+(order?' · '+order:''))||normalized(b.customerPo)!==normalized(po)||normalized(b.name)!==normalized(row.site))throw new HttpError(409,'The source IPO, order, PO and site must agree before import.');
  const previous=(await c.query('SELECT * FROM historical_pending_ipo_imports WHERE board_site_id=$1',[input.boardSiteId])).rows[0];
  if(previous){if(previous.source_sha256!==source.source_sha256||previous.source_key!==row.key||previous.framework_id!==input.frameworkId)throw new HttpError(409,'The existing historical import differs. Use a controlled correction.');return {ipoId:previous.ipo_id,recordId:previous.record_id,unchanged:true};}
  if((await c.query("SELECT 1 FROM internal_purchase_orders WHERE lower(number)=lower($1) AND lower(coalesce(snapshot#>>'{input,orderNumber}',''))=lower($2)",[number,order])).rowCount)throw new HttpError(409,'This IPO/order already exists. Link its approved source instead of importing it again.');
  const framework=(await c.query('SELECT f.*,c.short_code FROM project_framework_versions f JOIN customers c ON c.id=f.customer_id WHERE f.id=$1',[input.frameworkId])).rows[0];
  const config=String(row.configuration??''),ups=config.startsWith('0-')?config.slice(2):config;
  if(!framework||String(framework.short_code).toUpperCase()!==bank||!(isUps?framework.payload.type==='bank-ups'&&framework.payload.profile?.configuration===ups:framework.payload.type==='ubl-solar'&&framework.payload.configuration===config))throw new HttpError(409,'The approved framework does not match this source configuration and customer.');
  if((await c.query('SELECT 1 FROM customer_purchase_orders WHERE customer_id=$1 AND lower(po_number)=lower($2)',[framework.customer_id,po])).rowCount)throw new HttpError(409,'This customer PO already has a saved order. Review its existing identity.');
  const siteName=z.string().trim().min(1).max(200).parse(row.site),sourceCode=String(row.siteCode??'').trim();
  const siteCode=bank==='UBL'&&isUps&&sourceCode==='9999'?'0999':sourceCode;
  z.string().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/).parse(siteCode);
  const masters=(await c.query('SELECT * FROM sites WHERE customer_id=$1 AND lower(code)=lower($2) AND lower(name)=lower($3)',[framework.customer_id,siteCode,siteName])).rows;
  if(masters.length>1)throw new HttpError(409,'More than one existing site matches. Review its address before importing.');
  const master=masters[0];
  const created=await repo.create(actor,{requestKey:randomUUID(),customerId:framework.customer_id,...(master?{siteId:master.id,siteVersion:master.version}:{}),siteName,siteCode,siteAddress:master?.location??'',siteContact:master?.contact_person??'',sitePhone:master?.contact_phone??'',region:master?.region??row.region??'',route:'direct-framework',frameworkId:framework.id,notes:'Management-authorised historical pending PO register import. Original customer evidence is not uploaded; retain source provenance. '+input.reason},c);
  const {r}=await repo.record(actor,created.id,c,true),basis=await frameworkBasis(pool,c,r,framework.id,{reference:po,date:poDate});
  if(row.grossContract==null||!new Decimal(row.grossContract).isFinite()||!new Decimal(row.grossContract).toDecimalPlaces(2).equals(new Decimal(basis.order.allocation.total).toDecimalPlaces(2)))throw new HttpError(409,'The source contract value differs from the approved framework. No IPO was imported.');
  basis.order.input.orderNumber=order;
  const historical={kind:'verified-register-import' as const,sourceId:source.id,sourceVersion:source.version,sourceSha256:source.source_sha256,sourceKey:row.key,importedBy:actor,reason:input.reason,hideFromIpoShared:true as const};
  const data={...r.data,basis,bulkHistoricalImport:true,historicalImport:historical,directPoDetails:{values:{orderNumber:order,siteName:r.site_name},source:'Historical source register',originalCustomerEvidenceUploaded:false}};
  const receiptId=randomUUID(),decisionId=randomUUID();
  const receiptInput={reference:po,date:poDate,basisType:'framework',frameworkId:framework.id,ipoNumber:number,confirmationType:'Historical source register',evidenceId:null,reviewed:true,notes:input.reason+' Original customer PO scan not uploaded; source register provenance retained.',historicalImport:historical};
  await c.query('INSERT INTO project_po_receipts(id,record_id,customer_id,reference,version,input,basis,differences,created_by) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)',[receiptId,r.id,r.customer_id,po,receiptInput,basis,[],actor]);
  await c.query("INSERT INTO project_order_decisions(id,receipt_id,record_id,outcome,reason,authorised_basis,created_by) VALUES($1,$2,$3,'Matched',$4,$5,$6)",[decisionId,receiptId,r.id,'Management-authorised register import; source contract equals approved configuration. Original PO upload remains absent.',basis,actor]);
  const issued=await repo.issue(c,user,r,data,basis,{id:receiptId,input:receiptInput},decisionId,historical);
  const savedData={...data,receiptId,ipoId:issued.ipo_id,operationsId:issued.operations_id};
  await c.query("UPDATE project_workflow_records SET stage='issued',version=version+1,data=$2,updated_at=now() WHERE id=$1",[r.id,savedData]);
  await c.query('INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,2,$3,$4,$5,$6,$7)',[randomUUID(),r.id,'Historical pending IPO imported',{stage:'issued',data:savedData},randomUUID(),sha(input),actor]);
  await c.query('INSERT INTO historical_pending_ipo_imports(id,board_site_id,board_version,accounts_source_id,source_key,source_sha256,source_row,framework_id,record_id,ipo_id,request_key,request_sha256,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[randomUUID(),input.boardSiteId,board.version,source.id,row.key,source.source_sha256,row,framework.id,r.id,issued.ipo_id,input.requestKey,sha(input),input.reason,actor]);
  await linkMaterialSource(pool,actor,{boardSiteId:input.boardSiteId,boardVersion:board.version,ipoId:issued.ipo_id,reason:'Historical import with exact register/IPO/order/PO/site identity. '+input.reason,requestKey:randomUUID()},c);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'historical.pending-ipo.import:'+input.boardSiteId+':'+issued.ipo_id]);
  return {ipoId:issued.ipo_id,recordId:r.id,unchanged:false};
 };
 return client?execute(client):transaction(pool,execute);
}
