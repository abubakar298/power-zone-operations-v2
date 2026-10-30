import {temporaryNegativeDoBalanceAllowed} from './do-negative-balance.js';
import {nextWarehouseClosing} from './warehouse-ledger.js';
import {deferDispatch,dispatchPosted} from './signed-dispatch.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {Decimal} from 'decimal.js';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {requireWarehouseAccess,lockWarehouseAuthority,warehouseNumber} from './warehouse-access.js';
import {warehouseLedgerKey} from './warehouse-source.js';
import {warehousePosition} from './warehouse-ledger.js';
import {materialDraftInputSchema} from './material-drafts.js';
import {sameUnit} from '../../shared/stock-units.js';

const positive=z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/).refine(v=>new Decimal(v).gt(0),'Enter a positive counted quantity.').transform(v=>new Decimal(v).toString());
const optionalQuantity=positive.nullable();
const serial=z.string().trim().max(200).nullable();
const reason=z.string().trim().min(3).max(2000);
const version=z.number().int().positive();
export const replacementCaseInputSchema=z.object({originalDispatchId:z.uuid(),originalLineKey:z.uuid(),siteId:z.uuid().optional(),warehouse:z.string().trim().min(1).max(200),quantity:positive,expectedOriginalReturnQuantity:optionalQuantity,originalSerial:serial,reason,requestKey:z.uuid()}).strict();
export const replacementIssueInputSchema=z.object({caseId:z.uuid(),caseVersion:version,requestKey:z.uuid(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),authorityVersion:version,ledgerRevision:z.number().int().nonnegative(),quantity:positive,replacementSerial:serial,reason,transport:materialDraftInputSchema.shape.transport}).strict();
export const replacementReturnInputSchema=z.object({caseId:z.uuid(),caseVersion:version,requestKey:z.uuid(),warehouse:z.string().trim().min(1).max(200),evidenceId:z.uuid(),quantity:positive,receivedItemId:z.string().trim().min(1).max(200).nullable().optional(),receivedUnit:z.string().trim().min(1).max(40).nullable().optional(),receivedSerial:serial,date:z.iso.date(),reason}).strict();
export const replacementUsableInputSchema=z.object({returnId:z.uuid(),caseVersion:version,requestKey:z.uuid(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),authorityVersion:version,ledgerRevision:z.number().int().nonnegative(),evidenceId:z.uuid(),quantity:positive,usableConfirmed:z.literal(true),itemIdentityConfirmed:z.literal(true),reason}).strict();
const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const latest=`SELECT c.*,v.version,v.snapshot AS current_snapshot FROM inventory_material_replacement_cases c JOIN LATERAL(SELECT version,snapshot FROM inventory_material_replacement_case_versions WHERE case_id=c.id ORDER BY version DESC LIMIT 1)v ON true`;
function wholeItems(unit:string,quantity:string){if(sameUnit(unit,'No.')&&!new Decimal(quantity).isInteger())throw new HttpError(422,'Record whole items for this final stock ID and unit.');}
function contextSites(snapshot:any){return(snapshot.sites??[]).map((s:any)=>({siteId:s.siteId,registeredSiteId:s.registeredSiteId,ipo:s.ipo,orderNumber:s.orderNumber,customerPo:s.customerPo,siteName:s.siteName,customer:s.customer,installation:s.installation}));}

/** A replacement is an explicit new physical OUT against its original committed
 * DO, even after the site completed. Faulty holdings and usable stock are separate. */
export class MaterialReplacementsRepository{
 constructor(private pool:Pool){}
 private async current(c:Pool|PoolClient,id:string,actor:string,locking=false,printing=false){
  if(locking)await c.query('SELECT id FROM inventory_material_replacement_cases WHERE id=$1 FOR UPDATE',[id]);
  const row=(await c.query(latest+' WHERE c.id=$1',[id])).rows[0];
  if(!row)throw new HttpError(404,'Replacement case not found.');
  await requireWarehouseAccess(actor,row.warehouse,c,printing);return row;
 }
 private checkVersion(row:any,expected:number){if(row.version!==expected)throw new HttpError(409,'This replacement case changed. Refresh before continuing.');}
 private async record(c:PoolClient,row:any,action:string,reason:string,actor:string,changes:Record<string,unknown>){
  const snapshot={...row.current_snapshot,...changes};await c.query('INSERT INTO inventory_material_replacement_case_versions(case_id,version,action,snapshot,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)',[row.id,row.version+1,action,snapshot,reason,actor]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.replacement.'+action+':'+row.id]);return row.version+1;
 }
 private async evidence(c:PoolClient,id:string,warehouse:string){const row=(await c.query('SELECT id,warehouse,sha256,original_name FROM inventory_material_evidence WHERE id=$1',[id])).rows[0];if(!row||row.warehouse!==warehouse)throw new HttpError(422,'Attach counted or inspection evidence for this exact warehouse.');return row;}
 async list(actor:string,warehouse:string){
  await requireWarehouseAccess(actor,warehouse,this.pool,true);
  return{warehouse,cases:(await this.pool.query(`SELECT c.id,c.warehouse,c.item_id,c.unit,c.original_dispatch_id,c.original_line_key,v.version,v.snapshot,c.created_at FROM inventory_material_replacement_cases c JOIN LATERAL(SELECT version,snapshot FROM inventory_material_replacement_case_versions WHERE case_id=c.id ORDER BY version DESC LIMIT 1)v ON true WHERE c.warehouse=$1 ORDER BY c.created_at DESC,c.id LIMIT 500`,[warehouse])).rows,stockPosting:false};
 }
 async detail(actor:string,id:string){
  const row=await this.current(this.pool,id,actor,false,true);
  const dispatches=(await this.pool.query('SELECT id,number,quantity::text,snapshot,created_at FROM inventory_material_replacement_dispatches WHERE case_id=$1 ORDER BY created_at,id',[id])).rows;
  // Destination-store evidence is shown only to users assigned to that warehouse.
  const returns=[];for(const r of(await this.pool.query('SELECT id,number,warehouse,quantity::text,snapshot,created_at FROM inventory_material_replacement_returns WHERE case_id=$1 ORDER BY created_at,id',[id])).rows){try{await requireWarehouseAccess(actor,r.warehouse,this.pool,true);}catch(error){if(error instanceof HttpError&&error.status===403)continue;throw error;}const released=(await this.pool.query('SELECT coalesce(sum(quantity),0)::text AS quantity FROM inventory_material_replacement_usable_releases WHERE return_id=$1',[r.id])).rows[0].quantity;returns.push({...r,stockPosted:await dispatchPosted(this.pool,'replacement-in',r.id),usableReleased:new Decimal(released).toString(),heldQuantity:await dispatchPosted(this.pool,'replacement-in',r.id)?new Decimal(r.quantity).minus(released).toString():'0'});}
  // Only expose releases for the physical receipts already authorised above.
  // Inspection history is a read model, not a second gate-in or a financial record.
  const releases=(await this.pool.query(`SELECT r.id,r.return_id AS "returnId",r.quantity::text,r.created_at AS "createdAt",r.evidence_id AS "evidenceId",r.inspected_by AS "inspectedBy",u.display_name AS "inspectedByName",r.snapshot->>'reason' AS reason FROM inventory_material_replacement_usable_releases r JOIN users u ON u.id=r.inspected_by WHERE r.case_id=$1 AND r.return_id=ANY($2::uuid[]) ORDER BY r.created_at,r.id`,[id,returns.map(r=>r.id)])).rows;
  return{id:row.id,version:row.version,snapshot:{...row.current_snapshot,physicalReturnedQuantity:returns.reduce((n,r)=>n.plus(r.stockPosted?r.quantity:0),new Decimal(0)).toString()},dispatches,returns,releases,holdingIsAvailableStock:false};
 }
 async open(actor:string,raw:z.infer<typeof replacementCaseInputSchema>){
  const input=replacementCaseInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.replacement.case.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT id,warehouse,created_by,request_fingerprint FROM inventory_material_replacement_cases WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){await requireWarehouseAccess(actor,replay.warehouse,c);if(replay.created_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to a different replacement case.');return{id:replay.id,version:1,stockPosted:false};}
   const original=(await c.query(`SELECT d.id,d.number,d.warehouse,d.draft_id,d.snapshot,l.line_key,l.item_id,l.unit,l.description,l.quantity::text,l.source_sha256,l.ledger_key FROM inventory_material_dispatches_active d JOIN inventory_material_dispatch_lines_active l ON l.dispatch_id=d.id WHERE d.id=$1 AND l.line_key=$2`,[input.originalDispatchId,input.originalLineKey])).rows[0];
   if(!original)throw new HttpError(404,'Select an item from its original committed material DO.');if(!await dispatchPosted(c,'dispatch',original.id))throw new HttpError(409,'The original material DO is awaiting its signed gate copy.');
   await requireWarehouseAccess(actor,original.warehouse,c);await requireWarehouseAccess(actor,input.warehouse,c);
   wholeItems(original.unit,input.quantity);if(input.expectedOriginalReturnQuantity!==null)wholeItems(original.unit,input.expectedOriginalReturnQuantity);
   if(new Decimal(input.quantity).gt(original.quantity)||input.expectedOriginalReturnQuantity!==null&&new Decimal(input.expectedOriginalReturnQuantity).gt(original.quantity))throw new HttpError(422,'The replacement or expected original return exceeds this original DO line.');
   const preparedLine=(original.snapshot.lines??[]).find((line:any)=>line.key===original.line_key),eligible=contextSites(original.snapshot).filter((site:any)=>!Array.isArray(preparedLine?.sites)||preparedLine.sites.includes(site.siteId));
   if(input.siteId&&!eligible.some((site:any)=>site.siteId===input.siteId))throw new HttpError(422,'Select the exact site assigned to this original DO line.');
   if(!input.siteId&&eligible.length>1)throw new HttpError(422,'Select which original Parent DO site needs this replacement.');
   const sites=input.siteId?eligible.filter((site:any)=>site.siteId===input.siteId):eligible;
   const other=(await c.query('SELECT count(*)::int AS n FROM inventory_material_replacement_cases WHERE original_dispatch_id=$1 AND original_line_key=$2',[original.id,original.line_key])).rows[0].n;
   const flags=[...(sites.length!==1?['Original site destination is unverified; a physical replacement cannot be dispatched yet.']:[]),...(!input.originalSerial?['Original item serial is unverified; no serial was inferred.']:[]),...(input.expectedOriginalReturnQuantity===null?['Expected original return quantity is unverified.']:[]),...(other?['Other replacement cases exist for this original DO line; verify this is a separate incident.']:[])];
   const id=randomUUID(),snapshot={warehouse:input.warehouse,original:{dispatchId:original.id,number:original.number,draftId:original.draft_id,warehouse:original.warehouse,lineKey:original.line_key,itemId:original.item_id,unit:original.unit,description:original.description,quantity:original.quantity,sourceSha256:original.source_sha256,serial:input.originalSerial},sites,replacementQuantity:input.quantity,expectedOriginalReturnQuantity:input.expectedOriginalReturnQuantity,issuedQuantity:'0',physicalReturnedQuantity:'0',usableReleasedQuantity:'0',originalReturnIdentity:'Not confirmed from warehouse inspection',flags,reason:input.reason};
   await c.query('INSERT INTO inventory_material_replacement_cases(id,original_dispatch_id,original_line_key,original_warehouse,warehouse,item_id,unit,original_quantity,replacement_quantity,expected_return_quantity,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,original.id,original.line_key,original.warehouse,input.warehouse,original.item_id,original.unit,original.quantity,input.quantity,input.expectedOriginalReturnQuantity,snapshot,input.requestKey,fingerprint(input),actor]);
   await c.query("INSERT INTO inventory_material_replacement_case_versions(case_id,version,action,snapshot,reason,created_by) VALUES($1,1,'opened',$2,$3,$4)",[id,snapshot,input.reason,actor]);
   await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.replacement.opened:'+id]);return{id,version:1,stockPosted:false};
  });
 }
 async issue(actor:string,raw:z.infer<typeof replacementIssueInputSchema>){
  const input=replacementIssueInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.replacement.out.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT id,number,warehouse,request_fingerprint,created_by FROM inventory_material_replacement_dispatches WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){await requireWarehouseAccess(actor,replay.warehouse,c);if(replay.created_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to another replacement dispatch.');return{id:replay.id,number:replay.number,stockPosted:await dispatchPosted(c,'replacement-out',replay.id)};}
   const row=await this.current(c,input.caseId,actor,true);this.checkVersion(row,input.caseVersion);wholeItems(row.unit,input.quantity);
   if(row.current_snapshot.sites?.length!==1)throw new HttpError(409,'Verify the exact original site destination before dispatching the replacement.');
   await lockWarehouseAuthority(c,row.warehouse,input.sourceSha256,input.authorityVersion);
   const issued=(await c.query('SELECT coalesce(sum(quantity),0)::text AS quantity FROM inventory_material_replacement_dispatches WHERE case_id=$1',[row.id])).rows[0].quantity;
   if(new Decimal(issued).plus(input.quantity).gt(row.replacement_quantity))throw new HttpError(409,'The planned replacement quantity has already been dispatched.');
   const key=warehouseLedgerKey(row.item_id,row.warehouse,row.unit),position=await warehousePosition(c,input.sourceSha256,key,true);
   if(!position)throw new HttpError(409,'Select the existing exact final item ID and warehouse unit. No item or unit substitution is inferred.');
   if(position.ledgerRevision!==input.ledgerRevision)throw new HttpError(409,'This warehouse balance changed. Refresh before issuing the replacement.');
   if(!temporaryNegativeDoBalanceAllowed()&&position.currentClosing!==null&&new Decimal(position.currentClosing).lt(input.quantity))throw new HttpError(409,'Verified usable stock is insufficient for this replacement. Faulty holdings are not available stock.');
   const id=randomUUID(),number=await warehouseNumber(c,'DO',id),snapshot={requiresSignedGate:true,stockPosting:false,kind:'replacement-out',warehouse:row.warehouse,caseId:row.id,caseVersion:row.version,original:row.current_snapshot.original,sites:row.current_snapshot.sites,lines:[{itemId:row.item_id,unit:row.unit,description:row.current_snapshot.original.description,quantity:input.quantity,serial:input.replacementSerial}],transport:input.transport,reason:input.reason,flags:[...row.current_snapshot.flags,...(!input.replacementSerial?['Replacement serial is unverified; no serial was inferred.']:[])],returnStatus:'Faulty return is separate; this dispatch credits no warehouse IN.'};
   await c.query('INSERT INTO inventory_material_replacement_dispatches(id,number,case_id,case_version,original_dispatch_id,original_line_key,warehouse,source_sha256,ledger_key,quantity,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,number,row.id,row.version,row.original_dispatch_id,row.original_line_key,row.warehouse,input.sourceSha256,key,input.quantity,snapshot,input.requestKey,fingerprint(input),actor]);
   await deferDispatch(c,actor,'replacement-out',id,row.warehouse,input.sourceSha256,input.authorityVersion,[{ledgerKey:key,quantity:input.quantity,kind:'replacement-out',draftId:row.current_snapshot.original.draftId,dispatchId:row.original_dispatch_id,lineKey:row.original_line_key,replacementDispatchId:id}]);
   await this.record(c,row,'replacement-out',input.reason,actor,{issuedQuantity:new Decimal(issued).plus(input.quantity).toString()});return{id,number,stockPosted:false,awaitingSignedGate:true};
  });
 }
 async receiveFaulty(actor:string,raw:z.infer<typeof replacementReturnInputSchema>){
  const input=replacementReturnInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.replacement.return.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT id,number,warehouse,case_id,request_fingerprint,counted_by FROM inventory_material_replacement_returns WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){await this.current(c,replay.case_id,actor);await requireWarehouseAccess(actor,replay.warehouse,c);if(replay.counted_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to another counted faulty return.');return{id:replay.id,number:replay.number,stockPosted:false,holdingRecorded:true};}
   const row=await this.current(c,input.caseId,actor,true);this.checkVersion(row,input.caseVersion);await requireWarehouseAccess(actor,input.warehouse,c);wholeItems(row.unit,input.quantity);
   const evidence=await this.evidence(c,input.evidenceId,input.warehouse);
   await c.query('SELECT line_key FROM inventory_material_dispatch_lines_active WHERE dispatch_id=$1 AND line_key=$2 FOR UPDATE',[row.original_dispatch_id,row.original_line_key]);
   const physical=(await c.query(`SELECT coalesce((SELECT sum(quantity) FROM inventory_material_receipt_lines WHERE dispatch_id=$1 AND line_key=$2),0)::text normal_returned,coalesce((SELECT sum(r.quantity) FROM inventory_material_replacement_returns r JOIN inventory_material_replacement_cases c ON c.id=r.case_id WHERE c.original_dispatch_id=$1 AND c.original_line_key=$2),0)::text faulty_returned`,[row.original_dispatch_id,row.original_line_key])).rows[0];
   if(new Decimal(physical.normal_returned).plus(physical.faulty_returned).plus(input.quantity).gt(row.original_quantity))throw new HttpError(409,'The original DO item has already been physically returned, including faulty holdings.');
   if((await c.query(`SELECT 1 FROM inventory_material_replacement_returns r JOIN inventory_material_replacement_cases c ON c.id=r.case_id WHERE c.original_dispatch_id=$1 AND c.original_line_key=$2 AND r.evidence_id=$3 UNION ALL SELECT 1 FROM inventory_material_receipts r JOIN inventory_material_receipt_lines l ON l.receipt_id=r.id WHERE l.dispatch_id=$1 AND l.line_key=$2 AND r.evidence_id=$3 LIMIT 1`,[row.original_dispatch_id,row.original_line_key,input.evidenceId])).rowCount)throw new HttpError(409,'This original-item counted-return evidence is already recorded.');
   if((await c.query('SELECT 1 FROM inventory_material_replacement_returns WHERE case_id=$1 AND evidence_id=$2',[row.id,evidence.id])).rowCount)throw new HttpError(409,'This counted-return evidence is already recorded for the case.');
   const returned=(await c.query('SELECT coalesce(sum(quantity),0)::text AS quantity FROM inventory_material_replacement_returns WHERE case_id=$1',[row.id])).rows[0].quantity,limit=row.expected_return_quantity??row.original_quantity;
   if(new Decimal(returned).plus(input.quantity).gt(limit))throw new HttpError(422,'The counted faulty return exceeds the separately recorded expected/original DO quantity.');
   const replacementUnit=input.receivedSerial&&(await c.query("SELECT 1 FROM inventory_material_replacement_dispatches d CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'lines') line WHERE d.case_id=$1 AND line->>'serial'=$2 LIMIT 1",[row.id,input.receivedSerial])).rowCount;
   const flags=[...(replacementUnit?['This serial identifies a later replacement unit; the original return identity is not established. Keep it held for a separate supported DO reference.']:[]),...(!input.receivedItemId||!input.receivedUnit?['Returned final item ID or unit is unverified; usable inspection must confirm the exact item.']:[]),...(input.receivedItemId&&input.receivedItemId!==row.item_id||input.receivedUnit&&!sameUnit(input.receivedUnit,row.unit)?['Received item ID or unit differs from the original; mapping must be resolved before usable credit.']:[]),...(!input.receivedSerial?['Returned serial is unverified; no serial was inferred.']:[]),...(input.receivedSerial&&row.current_snapshot.original.serial&&input.receivedSerial!==row.current_snapshot.original.serial?['Received serial differs from the recorded original serial; original-return identity remains flagged.']:[])];
   const id=randomUUID(),number=await warehouseNumber(c,'IGP',id),snapshot={requiresSignedIgp:true,kind:'faulty-return-held',warehouse:input.warehouse,caseId:row.id,sites:row.current_snapshot.sites,original:row.current_snapshot.original,itemId:row.item_id,unit:row.unit,expectedItemId:row.item_id,expectedUnit:row.unit,receivedItemId:input.receivedItemId??null,receivedUnit:input.receivedUnit??null,quantity:input.quantity,receivedSerial:input.receivedSerial,returnIdentity:replacementUnit?'replacement-unit':input.receivedSerial&&row.current_snapshot.original.serial===input.receivedSerial?'original-unit-recorded':'unverified',date:input.date,evidence:{id:evidence.id,sha256:evidence.sha256},reason:input.reason,flags,holdingStatus:'Faulty / awaiting usable inspection',availableStockCredit:false};
   await c.query('INSERT INTO inventory_material_replacement_returns(id,number,case_id,case_version,warehouse,quantity,evidence_id,snapshot,request_key,request_fingerprint,counted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,number,row.id,row.version,input.warehouse,input.quantity,evidence.id,snapshot,input.requestKey,fingerprint(input),actor]);
   await deferDispatch(c,actor,'replacement-in',id,input.warehouse,row.current_snapshot.original.sourceSha256,1,[]);
   await this.record(c,row,'faulty-return-awaiting-signed-igp',input.reason,actor,{pendingReturnQuantity:new Decimal(returned).plus(input.quantity).toString(),originalReturnIdentity:flags.length?'Return identity requires verification':'Received serial recorded; not inferred from outgoing replacement'});return{id,number,stockPosted:false,holdingRecorded:false,awaitingSignedIgp:true};
  });
 }
 async releaseUsable(actor:string,raw:z.infer<typeof replacementUsableInputSchema>){
  const input=replacementUsableInputSchema.parse(raw);
  return transaction(this.pool,async c=>{
   await lockActiveActor(c,actor);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.replacement.usable.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT id,warehouse,case_id,request_fingerprint,inspected_by FROM inventory_material_replacement_usable_releases WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){await this.current(c,replay.case_id,actor);await requireWarehouseAccess(actor,replay.warehouse,c);if(replay.inspected_by!==actor||replay.request_fingerprint!==fingerprint(input))throw new HttpError(409,'This request belongs to another usable-stock inspection.');return{id:replay.id,stockPosted:true};}
   const receipt=(await c.query('SELECT * FROM inventory_material_replacement_returns WHERE id=$1',[input.returnId])).rows[0];if(!receipt)throw new HttpError(404,'Counted faulty return not found.');if(!await dispatchPosted(c,'replacement-in',receipt.id))throw new HttpError(409,'Upload the signed faulty return IGP before releasing a holding.');
   const row=await this.current(c,receipt.case_id,actor,true);this.checkVersion(row,input.caseVersion);await requireWarehouseAccess(actor,receipt.warehouse,c);wholeItems(row.unit,input.quantity);
   if(receipt.snapshot.returnIdentity==='replacement-unit')throw new HttpError(409,'This is a later replacement-unit return, not a verified original-DO return. Keep the physical holding until its separate DO reference is supported.');
   if(receipt.snapshot.receivedItemId&&receipt.snapshot.receivedItemId!==row.item_id||receipt.snapshot.receivedUnit&&!sameUnit(receipt.snapshot.receivedUnit,row.unit))throw new HttpError(409,'Resolve the received item ID or unit mapping before releasing usable stock. No substitution is inferred.');
   if(receipt.snapshot.receivedSerial&&row.current_snapshot.original.serial&&receipt.snapshot.receivedSerial!==row.current_snapshot.original.serial)throw new HttpError(409,'Resolve the received serial mapping against the recorded original before releasing usable stock. The physical return remains held.');
   await lockWarehouseAuthority(c,receipt.warehouse,input.sourceSha256,input.authorityVersion);const evidence=await this.evidence(c,input.evidenceId,receipt.warehouse);
   const released=(await c.query('SELECT coalesce(sum(quantity),0)::text AS quantity FROM inventory_material_replacement_usable_releases WHERE return_id=$1',[receipt.id])).rows[0].quantity;
   if(new Decimal(released).plus(input.quantity).gt(receipt.quantity))throw new HttpError(409,'This usable release exceeds the counted quantity still held.');
   const key=warehouseLedgerKey(row.item_id,receipt.warehouse,row.unit),position=await warehousePosition(c,input.sourceSha256,key,true);
   if(!position)throw new HttpError(409,'Select the return warehouse exact item and unit from the accepted stock register.');
   if(position.ledgerRevision!==input.ledgerRevision)throw new HttpError(409,'This warehouse balance changed. Refresh before releasing usable stock.');
   const id=randomUUID(),snapshot={kind:'usable-inspection-release',caseId:row.id,returnId:receipt.id,warehouse:receipt.warehouse,itemId:row.item_id,unit:row.unit,quantity:input.quantity,evidence:{id:evidence.id,sha256:evidence.sha256},reason:input.reason,usableConfirmed:true,itemIdentityConfirmed:true,confirmedItemId:row.item_id,confirmedUnit:row.unit,recordedReceivedItemId:receipt.snapshot.receivedItemId??null,recordedReceivedUnit:receipt.snapshot.receivedUnit??null,originalSerial:row.current_snapshot.original.serial,receivedSerial:receipt.snapshot.receivedSerial,originalReturnIdentityFlags:receipt.snapshot.flags,remainingFaultyQuantity:new Decimal(receipt.quantity).minus(released).minus(input.quantity).toString()};
   await c.query('INSERT INTO inventory_material_replacement_usable_releases(id,return_id,case_id,case_version,original_dispatch_id,original_line_key,warehouse,source_sha256,ledger_key,quantity,evidence_id,snapshot,request_key,request_fingerprint,inspected_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[id,receipt.id,row.id,row.version,row.original_dispatch_id,row.original_line_key,receipt.warehouse,input.sourceSha256,key,input.quantity,evidence.id,snapshot,input.requestKey,fingerprint(input),actor]);
   const before=position.currentClosing,after=nextWarehouseClosing(before,input.quantity,1);
   await c.query("INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by,replacement_release_id) VALUES($1,$2,$3,$4,'replacement-usable-in',$5,$6,$7,$8,0,$9,$10,$11,$12)",[randomUUID(),input.sourceSha256,key,position.ledgerRevision+1,row.current_snapshot.original.draftId,row.original_dispatch_id,row.original_line_key,input.quantity,before,after,actor,id]);
   const total=(await c.query('SELECT coalesce(sum(quantity),0)::text AS quantity FROM inventory_material_replacement_usable_releases WHERE case_id=$1',[row.id])).rows[0].quantity;
   await this.record(c,row,'usable-release',input.reason,actor,{usableReleasedQuantity:new Decimal(total).toString()});return{id,stockPosted:true};
  });
 }
}
