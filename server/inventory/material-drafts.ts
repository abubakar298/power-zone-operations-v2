import {withInventoryReceiving} from '../operations-board/inventory-delivery.js';
import {warehouseNumber} from './warehouse-access.js';
import {ParentReconciliationRepository} from './parent-reconciliation.js';
import approvedParentLedger from './approved-parent-ledger.json' with {type:'json'};
import {requireOpenParent} from './parent-open.js';
import approvedSiteLedger from './approved-site-ledger.json' with {type:'json'};
import {inventoryOperationsBatches} from './operations-batches.js';
import {plannedInventoryDelivery,plannedInventoryInstallation} from '../operations-board/batch-delivery.js';
import {MinimumStockRepository} from './minimum-stock.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {HttpError} from '../http/errors.js';
import {transaction} from '../db/transaction.js';
import {approvedMaterialIdentities} from './source-links.js';
import {checkMaterialSourceLink} from './source-link-policy.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import {approvedEarthingBasis} from '../../shared/material-preparation.js';

const quantity=z.union([z.literal(''),z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/)]);
export const materialDraftInputSchema=z.object({
 id:z.uuid().optional(),version:z.number().int().nonnegative(),requestKey:z.uuid(),
 revisionReason:z.string().trim().min(3).max(2000).optional(),
 kind:z.enum(['fixed','variable']),parent:z.boolean(),warehouse:z.string().trim().min(1).max(200),
 sites:z.array(z.object({sourceKind:z.enum(['store-boq','headsup','linked-ipo']),basisId:z.uuid(),basisVersion:z.literal(1),siteId:z.uuid()}).strict()).min(1).max(1000),
 lines:z.array(z.object({documentPolicyVersion:z.literal(2).optional(),key:z.uuid(),itemId:z.string().trim().max(200),description:z.string().trim().max(1000),unit:z.string().trim().max(40),out:quantity,sites:z.array(z.uuid()).min(1).max(1000),section:z.enum(['customer','internal']).optional(),fixedGroup:z.enum(['bess','panels','other']).optional(),basisLine:z.number().int().nonnegative().max(2000).optional()}).strict()).max(2000),
 transport:z.object({issuedTo:z.string().trim().max(200),vehicle:z.string().trim().max(100),driver:z.string().trim().max(200),driverIdentity:z.string().trim().max(100)}).strict(),
}).strict();
export type MaterialDraftInput=z.infer<typeof materialDraftInputSchema>;
export type MaterialSource={installationOnly?:boolean;sourceKind:'store-boq'|'headsup'|'linked-ipo';registeredSiteId?:string;storeHandoffId?:string;basisId:string;basisVersion:1;siteId:string;ipo:string|null;orderNumber?:string;customerPo?:string;dispatchDate?:string|null;installationDate?:string|null;siteName:string;customer:string;installation:boolean|null;authorization:'approved-store-boq'|'approved-ipo-boq'|'forecast-only';items:unknown[]};
type Source=MaterialSource;
const latest=`SELECT d.id,v.version,v.snapshot,v.created_at,(SELECT number FROM inventory_parent_preparation_references WHERE draft_id=d.id) AS number FROM inventory_material_drafts d JOIN LATERAL(SELECT * FROM inventory_material_draft_versions WHERE draft_id=d.id ORDER BY version DESC LIMIT 1)v ON true`;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class MaterialDraftRepository{
 constructor(private pool:Pool){}
 private async access(actor:string,c:Pool|PoolClient=this.pool,temporary=false){
  const u=(await c.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
  if(!u?.active)throw new HttpError(401,'Your access has ended.');
  if(['Admin','Management'].includes(u.role))return {owner:true,warehouses:[] as string[]};
  const grants=u.role==='Inventory'?(await c.query("SELECT warehouse FROM inventory_material_access WHERE user_id=$1 AND capability=ANY($2::text[])",[actor,temporary?['dispatcher','storekeeper']:['dispatcher']])).rows:[];
  if(!grants.length)throw new HttpError(403,'Material issuance preparation is not assigned to this account.');
  return {owner:false,warehouses:grants.map(r=>r.warehouse as string)};
 }
 private scope(access:Awaited<ReturnType<MaterialDraftRepository['access']>>,warehouse:string){if(!access.owner&&!access.warehouses.includes(warehouse))throw new HttpError(403,'This warehouse is outside your assigned material-issuance scope.');}
 private async sources(c:Pool|PoolClient=this.pool,continuations:ReadonlySet<string>=new Set()):Promise<Source[]>{
  const confirmed=(await c.query(`SELECT s.id,s.snapshot,o.id AS operations_issuance_id,o.ipo_id,w.scope,i.number AS ipo_number,i.snapshot#>>'{input,orderNumber}' AS order_number,i.snapshot#>>'{input,poNumber}' AS po_number FROM store_boq_issuances s JOIN operations_boq_issuances o ON o.id=s.issuance_id JOIN internal_purchase_orders i ON i.id=o.ipo_id
   LEFT JOIN site_workflow w ON w.issuance_id=o.id WHERE (w.delivered_on IS NULL OR (i.id=ANY($1::uuid[]) AND w.scope='installation')) AND coalesce(w.stage,'')<>'closed'
   AND NOT EXISTS(SELECT 1 FROM archived_sample_ipos a WHERE a.ipo_id=i.id AND a.restored_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM test_workflow_archives a WHERE a.records->'localPreviewDocumentIds' ? i.id::text OR a.records->'localPreviewDocumentIds' ? s.id::text OR a.records->'localPreviewDocumentIds' ? o.id::text)`,[[...continuations]])).rows;
  const advance=(await c.query(`SELECT h.id,h.number,r.id record_id,r.site_name,r.data,site FROM headsup_department_handoffs h
   JOIN headsup_advance_members m ON m.handoff_id=h.id JOIN project_workflow_records r ON r.id=m.record_id
   JOIN LATERAL jsonb_array_elements(h.snapshot->'sites') site ON site->>'recordId'=r.id::text
   LEFT JOIN headsup_advance_final_links f ON f.record_id=r.id
   WHERE f.operations_id IS NULL AND r.stage NOT IN ('issued','declined') AND r.data->>'localPreviewArchived' IS DISTINCT FROM 'true'`)).rows;
  // Explicit projection: no selling rates, costs, margins or unrelated contacts.
  const items=(value:unknown)=>Array.isArray(value)?value.map((v:any)=>({key:v.key,description:v.description,brand:v.brand,specification:v.specification,qty:v.qty,unit:v.unit,boqQty:v.boqQty,boqUnit:v.boqUnit})):[];
  const linked:Source[]=[],heldIpos=new Set<string>();
  const links=(await c.query(`SELECT l.*,v.snapshot board,b.snapshot boq FROM inventory_material_source_links l
   JOIN LATERAL(SELECT snapshot FROM operations_board_versions WHERE site_id=l.board_site_id ORDER BY version DESC LIMIT 1)v ON true
   JOIN boq_revisions b ON b.id=l.boq_revision_id`)).rows;
  const registered=await withInventoryReceiving(c,(await c.query('SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC')).rows);
  const activeBatches=(await c.query('SELECT DISTINCT ON(batch_id) version,snapshot FROM operations_board_batch_versions ORDER BY batch_id,version DESC')).rows;
  const installationOnlyBoards=new Set([...inventoryOperationsBatches(activeBatches,registered,[]).flatMap(batch=>batch.stops.filter(stop=>stop.work==='labour').map(stop=>stop.boardSiteId)),...registered.filter(r=>r.snapshot.inventoryReceiving&&r.snapshot.installation===true&&!r.snapshot.completed&&r.snapshot.stage==='delivered').map(r=>r.site_id)]);
  const reference=(number:string,order:string)=>`${number}${order?' · '+order:''}`.trim().replace(/\s+/g,' ').toLowerCase();
  for(const source of confirmed){
   const known=registered.some(r=>reference(r.snapshot.ipo??'','')===reference(source.ipo_number,source.order_number??''));
   if(known&&!links.some(l=>l.ipo_id===source.ipo_id))heldIpos.add(source.ipo_id);
  }
  const approvedIpos=await approvedMaterialIdentities(c,links.map(link=>link.ipo_id));
  for(const link of links){
   link.board=registered.find(r=>r.site_id===link.board_site_id)?.snapshot??link.board;
   const ipo=approvedIpos.get(link.ipo_id);if(!ipo||ipo instanceof HttpError){heldIpos.add(link.ipo_id);continue;}
   const s=ipo.snapshot;
   const identity=checkMaterialSourceLink({...link.board,id:link.board_site_id},[{id:ipo.id,number:ipo.number,orderNumber:s.input?.orderNumber??'',poNumber:s.input?.poNumber??'',siteName:s.siteName??''}],(continuations.has(ipo.id)||installationOnlyBoards.has(link.board_site_id))&&link.board.installation===true);
   if(identity.status!=='eligible'||hash(s)!==link.ipo_sha256||hash(link.boq)!==link.boq_sha256){heldIpos.add(ipo.id);continue;}
   const existing=confirmed.find(r=>r.ipo_id===ipo.id);
   if(existing)heldIpos.add(ipo.id); // Preserve the stable link basis when a later Store handoff arrives.
   linked.push({installationOnly:installationOnlyBoards.has(link.board_site_id),sourceKind:'linked-ipo',storeHandoffId:existing?.id,registeredSiteId:link.board_site_id,basisId:link.id,basisVersion:1,siteId:ipo.id,ipo:ipo.number,orderNumber:String(s.input?.orderNumber??''),customerPo:String(s.input?.poNumber??''),siteName:s.siteName,customer:String(s.customer?.name??''),installation:link.board.installation===true?true:link.board.installation===false?false:null,dispatchDate:plannedInventoryDelivery({...link.board,id:link.board_site_id}),installationDate:plannedInventoryInstallation(link.board),authorization:'approved-ipo-boq',items:items(link.boq.lines)});
  }
  return [...confirmed.filter(r=>!heldIpos.has(r.ipo_id)).map(r=>({installationOnly:!!r.registeredSiteId&&installationOnlyBoards.has(r.registeredSiteId),sourceKind:'store-boq' as const,registeredSiteId:r.registeredSiteId,basisId:r.id,basisVersion:1 as const,siteId:r.ipo_id,ipo:r.ipo_number,dispatchDate:(()=>{const matches=registered.filter(b=>b.snapshot.origin?.ipoId===r.ipo_id&&b.snapshot.origin?.operationsIssuanceId===r.operations_issuance_id);return matches.length===1?plannedInventoryDelivery({...matches[0].snapshot,id:matches[0].site_id}):null;})(),installationDate:(()=>{const matches=registered.filter(b=>b.snapshot.origin?.ipoId===r.ipo_id&&b.snapshot.origin?.operationsIssuanceId===r.operations_issuance_id);return matches.length===1?plannedInventoryInstallation(matches[0].snapshot):null;})(),orderNumber:r.order_number??'',customerPo:r.po_number??'',siteName:String(r.snapshot.siteName),customer:String(r.snapshot.customer?.name??''),installation:r.registeredSiteId?(r.registeredInstallation===true?true:r.registeredInstallation===false?false:null):r.scope==='installation'?true:r.scope==='delivery_only'?false:null,authorization:'approved-store-boq' as const,items:items(r.snapshot.items)})),
   ...linked,...advance.map(r=>({sourceKind:'headsup' as const,basisId:r.id,basisVersion:1 as const,siteId:r.record_id,ipo:null,dispatchDate:null,siteName:r.site_name,customer:String(r.site.customer??''),installation:null,authorization:'forecast-only' as const,items:items(r.site.items)}))];
 }
 private async stockCatalogue(c:Pool|PoolClient=this.pool){
  const source=(await c.query("SELECT source_sha256,metadata FROM inventory_warehouse_sources WHERE metadata->>'canonicalIds' ~ '^[1-9][0-9]*$' ORDER BY created_at DESC,source_sha256 LIMIT 1")).rows[0];
  const map=new Map<string,{itemId:string;description:string;units:string[]}>(),warehouses=new Set<string>();
  if(source){
   for(const {payload:r} of (await c.query('SELECT payload FROM inventory_warehouse_source_balances WHERE source_sha256=$1 ORDER BY ledger_key',[source.source_sha256])).rows){
    const old=map.get(r.itemId);map.set(r.itemId,{itemId:r.itemId,description:old?.description??r.description,units:[...new Set([...(old?.units??[]),r.unit])]});warehouses.add(r.warehouse);
   }
   if(map.size!==Number(source.metadata.canonicalIds))throw new HttpError(409,'The reviewed stock catalogue is incomplete. Verify its source before selecting item IDs.');
  }else{
   for(const r of (await c.query("SELECT item_id,payload FROM inventory_catalogue_final_current WHERE payload->>'finalStockId'='true' ORDER BY item_id")).rows)map.set(r.item_id,{itemId:r.item_id,description:r.payload.stockDescription??r.payload.technicalDescription,units:r.payload.stockUnits??[]});
   for(const r of (await c.query('SELECT DISTINCT warehouse FROM inventory_material_access')).rows)warehouses.add(r.warehouse);
  }
  const candidates=new Map<string,Set<string>>();
  for(const row of (await c.query('SELECT alias,item_id FROM inventory_item_aliases_current ORDER BY alias,item_id')).rows){const targets=candidates.get(row.alias)??new Set<string>();targets.add(row.item_id);candidates.set(row.alias,targets);}
  const aliases=Object.fromEntries([...candidates].filter(([,targets])=>targets.size===1&&map.has([...targets][0])).map(([alias,targets])=>[alias,[...targets][0]]));
  return {catalogue:[...map.values()].sort((a,b)=>a.itemId.localeCompare(b.itemId)),aliases,warehouses:[...warehouses].sort()};
 }
 parentReconciliation(actor:string,id:string){return new ParentReconciliationRepository(this.pool).read(actor,id);}
 changeParentReconciliation(actor:string,input:unknown){return new ParentReconciliationRepository(this.pool).change(actor,input);}
 async reviewedPools(actor:string){const access=await this.access(actor);return {version:approvedParentLedger.version,preparedAt:approvedParentLedger.preparedAt,groups:approvedParentLedger.groups.filter(g=>access.owner||access.warehouses.includes(g.warehouse+' warehouse'))};}
 async siteLedger(actor:string){
  const access=await this.access(actor),data=structuredClone(approvedSiteLedger) as any;
  const normal=(w:string)=>w.toLowerCase().replace(/ warehouse$/,'');
  const warehouses=new Set(access.warehouses.map(normal));
  if(!access.owner){const sites=new Set(data.events.filter((e:any)=>warehouses.has(normal(e.warehouse))).map((e:any)=>e.siteId));data.events=data.events.filter((e:any)=>warehouses.has(normal(e.warehouse))||sites.has(e.siteId)&&e.kind==='local_purchase');data.unmappedReturns=data.unmappedReturns.filter((e:any)=>warehouses.has(normal(e.warehouse)));data.sites=data.sites.filter((s:any)=>sites.has(s.id));}
  const records=(await this.pool.query(`SELECT d.id,d.number,d.warehouse,d.created_at,d.snapshot FROM inventory_material_dispatches_active d WHERE NOT EXISTS(SELECT 1 FROM inventory_signed_dispatch_pending p WHERE p.document_kind='dispatch' AND p.document_id=d.id AND NOT EXISTS(SELECT 1 FROM inventory_signed_dispatch_postings z WHERE z.document_kind=p.document_kind AND z.document_id=p.document_id)) ORDER BY d.created_at`)).rows;
  for(const r of records){if(!access.owner&&!access.warehouses.includes(r.warehouse))continue;const sources=r.snapshot.sites??[];if(sources.length!==1)continue;const site=sources[0],id=site.siteId,ipo=[site.ipo,site.orderNumber].filter(Boolean).join(' · ');if(!data.sites.some((s:any)=>s.id===id))data.sites.push({id,site:site.siteName,customer:site.customer,ipo});for(const [index,line]of(r.snapshot.lines??[]).entries()){const eventId=r.id+':'+index;if(data.events.some((e:any)=>e.document===r.number&&e.itemId===line.itemId&&e.warehouse===r.warehouse))continue;data.events.push({id:eventId,siteId:id,site:site.siteName,customer:site.customer,ipo,itemId:line.itemId,description:line.description??line.itemId,unit:line.unit,date:new Date(r.created_at).toISOString().slice(0,10),document:r.number,documentType:'DO',kind:'issue',quantity:line.quantity??line.out,warehouse:r.warehouse,reference:'',notes:'Issued warehouse document',condition:'',evidence:'',sourceSheet:'',sourceType:'Saved warehouse issuance',status:'Issued',replacement:false,faulty:false});}}
  const receipts=(await this.pool.query(`SELECT r.id,r.number,r.snapshot->>'warehouse' AS warehouse,r.created_at,r.snapshot,v.snapshot AS preparation FROM inventory_material_receipts r JOIN LATERAL(SELECT snapshot FROM inventory_material_draft_versions WHERE draft_id=r.draft_id ORDER BY version DESC LIMIT 1)v ON true ORDER BY r.created_at`)).rows;
  for(const r of receipts){if(!access.owner&&!access.warehouses.includes(r.warehouse))continue;const sites=r.preparation.sites??[];if(sites.length!==1)continue;const site=sites[0];for(const [i,line]of(r.snapshot.lines??[]).entries()){if(data.events.some((e:any)=>e.document===r.number&&e.itemId===line.itemId&&e.warehouse===r.warehouse))continue;data.events.push({id:r.id+':'+i,siteId:site.siteId,site:site.siteName,customer:site.customer,ipo:[site.ipo,site.orderNumber].filter(Boolean).join(' · '),itemId:line.itemId,description:line.itemId,unit:line.unit,date:new Date(r.created_at).toISOString().slice(0,10),document:r.number,documentType:'IGP',kind:'return',quantity:line.quantity,warehouse:r.warehouse,reference:'',notes:r.snapshot.reason,condition:'',evidence:'/api/material-dispatches/evidence/'+r.snapshot.evidence.id,sourceSheet:'',sourceType:'Verified warehouse return',status:'Credited',replacement:false,faulty:false});}}
  data.nativeSites=(await this.pool.query(`${latest} ORDER BY v.created_at DESC`)).rows.filter((r:any)=>access.owner||access.warehouses.includes(r.snapshot.warehouse)).flatMap((r:any)=>r.snapshot.sites.map((s:any)=>({id:s.siteId,site:s.siteName,customer:s.customer,ipo:s.ipo??'',draftId:r.id,parent:r.snapshot.parent})));
  data.coverage.importedEvents=data.events.length;return data;
 }
 async transportChoices(actor:string,warehouse:string){
  const access=await this.access(actor);this.scope(access,warehouse);
  const choices=(await this.pool.query('SELECT kind,value,details FROM inventory_transport_choices WHERE warehouse=$1 ORDER BY kind,value',[warehouse])).rows;
  const versions=(await this.pool.query("SELECT DISTINCT v.snapshot->'transport' AS transport FROM inventory_material_draft_versions v WHERE v.snapshot->>'warehouse'=$1",[warehouse])).rows;
  const result=new Map(choices.map(r=>[r.kind+'|'+r.value,r]));
  for(const {transport:t} of versions)for(const kind of ['issuedTo','vehicle','driver'])if(t?.[kind]){const key=kind+'|'+t[kind];if(!result.has(key))result.set(key,{kind,value:t[kind],details:kind==='driver'?t.driverIdentity??'':''});}
  return {choices:[...result.values()]};
 }
 async saveTransportChoice(actor:string,value:unknown){
  const parsed=z.object({warehouse:z.string().trim().min(1).max(200),kind:z.enum(['issuedTo','vehicle','driver']),value:z.string().trim().min(1).max(200),details:z.string().max(100)}).strict().safeParse(value);
  if(!parsed.success)throw new HttpError(422,'Enter the warehouse and transport details.');const v=parsed.data;
  return transaction(this.pool,async c=>{await lockActiveActor(c,actor);const access=await this.access(actor,c);this.scope(access,v.warehouse);await c.query('INSERT INTO inventory_transport_choices(warehouse,kind,value,details,actor_id)VALUES($1,$2,$3,$4,$5) ON CONFLICT(warehouse,kind,value)DO NOTHING',[v.warehouse,v.kind,v.value,v.kind==='driver'?v.details:'',actor]);return {saved:true};});
 }
 async temporaryDocuments(actor:string){
  const access=await this.access(actor,this.pool,true),catalogue=await this.stockCatalogue();
  const rows=await this.pool.query('SELECT snapshot FROM inventory_temporary_documents WHERE ($1 OR warehouse=ANY($2::text[])) ORDER BY created_at DESC',[access.owner,access.warehouses]);
  return {documents:rows.rows.map(r=>r.snapshot),warehouses:access.owner?catalogue.warehouses:access.warehouses,items:catalogue.catalogue.map(r=>({id:r.itemId,description:r.description,unit:r.units[0]??''}))};
 }
 async saveTemporaryDocument(actor:string,value:unknown){
  const input=z.object({requestKey:z.uuid(),id:z.union([z.uuid(),z.literal('')]),version:z.number().int().nonnegative(),type:z.enum(['IGP','OGP','TRF','IRR','OTHER']),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),warehouse:z.string().trim().min(1).max(200),party:z.string().max(500),sourceReference:z.string().max(500),actualReference:z.string().max(500),notes:z.string().max(5000),detailsConfirmed:z.boolean(),lines:z.array(z.object({itemId:z.string().max(200),description:z.string().max(1000),quantity:z.union([z.literal(''),z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/)]),unit:z.string().max(40),remarks:z.string().max(2000)}).strict()).min(1).max(500)}).strict().safeParse(value);
  if(!input.success)throw new HttpError(422,'Check the temporary document, quantities and warehouse.');
  const v=input.data;if(v.detailsConfirmed&&!v.actualReference.trim())throw new HttpError(422,'Enter the actual reference before confirming details.');
  return transaction(this.pool,async c=>{await lockActiveActor(c,actor);const access=await this.access(actor,c,true);this.scope(access,v.warehouse);
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[v.requestKey]);
   const replay=(await c.query('SELECT input,snapshot FROM inventory_temporary_document_versions WHERE request_key=$1',[v.requestKey])).rows[0];
   if(replay){this.scope(access,replay.snapshot.warehouse);if(!isDeepStrictEqual(replay.input,v))throw new HttpError(409,'This save request was already used for different details.');return replay.snapshot;}
   const id=v.id||randomUUID(),old=v.id?(await c.query('SELECT * FROM inventory_temporary_documents WHERE id=$1 FOR UPDATE',[id])).rows[0]:undefined;
   if(v.id&&!old)throw new HttpError(404,'Temporary document not found.');
   if(old){this.scope(access,old.warehouse);if(old.version!==v.version)throw new HttpError(409,'This document changed. Reopen it before saving.');if(old.snapshot.type!==v.type)throw new HttpError(422,'The saved document type cannot change.');}
   else if(v.version!==0)throw new HttpError(409,'Create a new temporary document first.');
   const version=(old?.version??0)+1,sequence=old?null:(await c.query("SELECT nextval('inventory_temporary_document_number_seq') AS number")).rows[0].number;
   const snapshot={...v,id,version,number:old?.number??`TMP-${v.type}-${v.date.replaceAll('-','')}-${String(sequence).padStart(4,'0')}`,createdAt:old?.snapshot.createdAt??new Date().toISOString()};
   if(old)await c.query('UPDATE inventory_temporary_documents SET version=$2,warehouse=$3,snapshot=$4,updated_at=now() WHERE id=$1',[id,version,v.warehouse,snapshot]);
   else await c.query('INSERT INTO inventory_temporary_documents(id,version,number,warehouse,snapshot,created_by)VALUES($1,$2,$3,$4,$5,$6)',[id,version,snapshot.number,v.warehouse,snapshot,actor]);
   await c.query('INSERT INTO inventory_temporary_document_versions(document_id,version,snapshot,request_key,input,actor_id)VALUES($1,$2,$3,$4,$5,$6)',[id,version,snapshot,v.requestKey,v,actor]);return snapshot;
  });
 }
 minimumStock(actor:string,warehouse:unknown){return new MinimumStockRepository(this.pool).read(actor,warehouse);}
 saveMinimumStock(actor:string,input:unknown){return new MinimumStockRepository(this.pool).save(actor,input);}
 async warehouses(actor:string){
  const access=await this.access(actor);
  const rows=await this.pool.query(`SELECT DISTINCT payload->>'warehouse' AS warehouse FROM inventory_warehouse_source_balances WHERE source_sha256=(SELECT source_sha256 FROM inventory_warehouse_sources ORDER BY (coalesce(metadata->>'canonicalIds','') ~ '^[1-9][0-9]*$') DESC,created_at DESC,source_sha256 LIMIT 1) ORDER BY warehouse`);
  return {warehouses:rows.rows.map(r=>r.warehouse as string).filter(w=>access.owner||access.warehouses.includes(w))};
 }
 async catalogue(actor:string){await this.access(actor);return this.stockCatalogue();}
 async issueSaved(actor:string,id:string,input:unknown,stock:import('./material-stock.js').MaterialStockRepository){const {issueSavedParent}=await import('./site-material-issuance.js');return issueSavedParent(this.pool,this,stock,actor,id,input);}
 async intake(actor:string){
  const access=await this.access(actor),stock=await this.stockCatalogue();
  // Imported Accounts/Operations positioning is visible without pretending that
  // an IPO label establishes an approved, executable BOQ identity.
  const sources=await this.sources();
  const boardRows=await withInventoryReceiving(this.pool,(await this.pool.query(`SELECT DISTINCT ON(site_id) site_id,version,snapshot FROM operations_board_versions ORDER BY site_id,version DESC`)).rows);
  const batches=(await this.pool.query('SELECT DISTINCT ON(batch_id) version,snapshot FROM operations_board_batch_versions ORDER BY batch_id,version DESC')).rows;
  const operationsBatches=inventoryOperationsBatches(batches,boardRows,sources);
  const registeredPending=boardRows
   .filter(r=>!r.snapshot.superseded&&!r.snapshot.completed&&['received','awaiting'].includes(r.snapshot.stage)&&r.snapshot.sample!==true&&!sources.some(s=>s.registeredSiteId===r.site_id))
   .map(r=>({siteId:r.site_id,ipo:r.snapshot.ipo,siteName:r.snapshot.name,customer:r.snapshot.customer??'',installation:r.snapshot.installation,dispatchDate:plannedInventoryDelivery({...r.snapshot,id:r.site_id}),installationDate:plannedInventoryInstallation(r.snapshot),linkStatus:'approved-boq-link-required' as const,linkReview:r.snapshot.materialLinkReview??null}));
  return {access,sources,registeredPending,operationsBatches,catalogue:stock.catalogue,aliases:stock.aliases,warehouses:access.owner?stock.warehouses:access.warehouses,stockPosting:false};
 }
 /** Issuance revalidates pending source identity while locking the same rows
  * that Operations uses for delivery updates. Draft preparation alone does not. */
 async requirePendingSources(selected:MaterialSource[],c:PoolClient,continuingDraftId?:string){
  const registered=[...new Set(selected.map(s=>s.registeredSiteId).filter((v):v is string=>!!v))].sort();
  if(registered.length)await c.query('SELECT id FROM operations_board_sites WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[registered]);
  const ipoIds=selected.filter(s=>s.sourceKind!=='headsup').map(s=>s.siteId);
  if(ipoIds.length)await c.query('SELECT id FROM site_workflow WHERE ipo_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ipoIds]);
  const hasDispatch=continuingDraftId&&(await c.query('SELECT 1 FROM inventory_material_dispatches_active WHERE draft_id=$1 LIMIT 1',[continuingDraftId])).rowCount;
  const available=await this.sources(c,hasDispatch?new Set(selected.map(s=>s.siteId)):new Set());
  const resolved:MaterialSource[]=[];
  for(const saved of selected){
   const current=available.find(s=>s.siteId===saved.siteId&&s.sourceKind===saved.sourceKind&&s.basisId===saved.basisId&&s.basisVersion===saved.basisVersion);
   if(!current)throw new HttpError(409,'A selected site is no longer pending or its approved BOQ identity changed.');
   if(current.authorization==='forecast-only')throw new HttpError(409,'A forecast preparation needs approved material-issuance authority before stock can leave.');
   if(current.installation===null||current.installation!==saved.installation)throw new HttpError(409,'Confirm the approved installation or delivery-only scope before issuing material.');
   resolved.push(current);
  }
  return resolved;
 }
 async history(actor:string,id:string){const access=await this.access(actor);await this.detail(actor,id);const versions=(await this.pool.query('SELECT version,created_at,snapshot FROM inventory_material_draft_versions WHERE draft_id=$1 ORDER BY version DESC',[id])).rows;return {versions:versions.filter(r=>access.owner||access.warehouses.includes(r.snapshot.warehouse)).map(r=>({version:r.version,at:r.created_at,reason:r.snapshot.revisionReason??'Preparation saved',warehouse:r.snapshot.warehouse}))};}
 async list(actor:string){const access=await this.access(actor);const rows=(await this.pool.query(latest+' ORDER BY v.created_at DESC')).rows;return {access,drafts:rows.filter(r=>!r.snapshot.combinedPlan&&(access.owner||access.warehouses.includes(r.snapshot.warehouse))),stockPosting:false};}
 async detail(actor:string,id:string,c:Pool|PoolClient=this.pool){const access=await this.access(actor,c),row=(await c.query(latest+' WHERE d.id=$1',[id])).rows[0];if(!row)throw new HttpError(404,'Material draft not found.');this.scope(access,row.snapshot.warehouse);return {...row,stockPosting:false};}
 async save(actor:string,raw:MaterialDraftInput,client?:PoolClient){
  const input=materialDraftInputSchema.parse(raw);
  const execute=async(c:PoolClient)=>{
   await lockActiveActor(c,actor);
   const access=await this.access(actor,c);this.scope(access,input.warehouse);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.material.draft.request.'||$1,0))",[input.requestKey]);
   const replay=(await c.query('SELECT draft_id,version,request_fingerprint,created_by FROM inventory_material_draft_versions WHERE request_key=$1',[input.requestKey])).rows[0];
   if(replay){if(replay.created_by!==actor||replay.request_fingerprint!==hash(input))throw new HttpError(409,'This request key belongs to another material draft.');return {id:replay.draft_id,version:replay.version,stockPosting:false};}
   const id=input.id??randomUUID();
   let continuation=false;
   if(input.id){
    await c.query('SELECT id FROM inventory_material_drafts WHERE id=$1 FOR UPDATE',[id]);
    const current=(await c.query(latest+' WHERE d.id=$1',[id])).rows[0];
    if(!current)throw new HttpError(404,'Material draft not found.');this.scope(access,current.snapshot.warehouse);
    if(current.snapshot.combinedPlan)throw new HttpError(409,'Edit this issuance through its original site material preparation.');
    if(!client&&(await c.query('SELECT 1 FROM inventory_site_material_plan_versions WHERE fixed_draft_id=$1 OR variable_draft_id=$1 LIMIT 1',[id])).rowCount)throw new HttpError(409,'Edit both modules through the site material preparation.');
    if(current.version!==input.version)throw new HttpError(409,'This draft changed. Refresh before saving.');
    const identity=(sites:any[])=>sites.map(s=>`${s.sourceKind}:${s.basisId}:${s.basisVersion}:${s.siteId}`).sort().join('|');
    if(current.snapshot.kind!==input.kind||current.snapshot.parent!==input.parent||identity(current.snapshot.sites)!==identity(input.sites))throw new HttpError(409,'Keep this draft linked to its original material module and approved sites.');
    const issued=(await c.query(`SELECT l.line_key,l.item_id,l.unit,l.description,sum(l.quantity)::text issued FROM inventory_material_dispatch_lines_active l JOIN inventory_material_dispatches_active d ON d.id=l.dispatch_id WHERE d.draft_id=$1 GROUP BY l.line_key,l.item_id,l.unit,l.description`,[id])).rows;
    if(issued.length){
     continuation=true;
     if(current.snapshot.warehouse!==input.warehouse)throw new HttpError(409,'Issued material must retain its original warehouse. Prepare a separate dispatch for another warehouse.');
     for(const sent of issued){const row=input.lines.find(r=>r.key===sent.line_key),old=current.snapshot.lines.find((r:any)=>r.key===sent.line_key);
      if(!row||row.itemId!==sent.item_id||row.unit!==sent.unit||row.description!==sent.description||!isDeepStrictEqual([...row.sites].sort(),[...old.sites].sort()))throw new HttpError(409,'A dispatched row must retain its item, unit, variant and site allocation. Unissued rows can still be completed.');
      if(!row.out||new Decimal(row.out).lt(sent.issued))throw new HttpError(422,'A prepared quantity cannot be reduced below material already dispatched.');
     }
     if((!isDeepStrictEqual(current.snapshot.lines,input.lines)||!isDeepStrictEqual(current.snapshot.transport,input.transport))&&!input.revisionReason)throw new HttpError(422,'Give a reason for changing preparation after a physical dispatch.');
    }
   }else if(input.version!==0)throw new HttpError(409,'A new material draft starts at version zero.');
   if((input.kind==='fixed'&&(input.parent||input.sites.length!==1))||(!input.parent&&input.sites.length!==1))throw new HttpError(422,'Use one site for fixed materials; multiple variable sites require a Parent DO.');
   const sources=await this.sources(c,continuation?new Set(input.sites.map(s=>s.siteId)):new Set()),selected:Source[]=[];
   for(const site of input.sites){const source=sources.find(s=>s.sourceKind===site.sourceKind&&s.basisId===site.basisId&&s.siteId===site.siteId&&s.basisVersion===site.basisVersion);if(!source)throw new HttpError(409,'A selected IPO/BOQ is no longer pending or its approved basis changed.');selected.push(source);}
   const sites=new Set(selected.map(s=>s.siteId));if(sites.size!==selected.length)throw new HttpError(422,'Select each site once.');
   if(input.kind==='variable'&&selected.some(s=>s.installation===false))throw new HttpError(422,'Delivery-only product sales do not have cable variance.');
   const finalItems=new Map((await this.stockCatalogue(c)).catalogue.map(r=>[r.itemId,r]));
   const lineKeys=new Set<string>();
   for(const row of input.lines){
    if(lineKeys.has(row.key)||new Set(row.sites).size!==row.sites.length||row.sites.some(s=>!sites.has(s)))throw new HttpError(422,'Invalid or duplicate material row allocation.');lineKeys.add(row.key);
    if(row.basisLine!==undefined){
     const basis=selected.length===1?(selected[0].items[row.basisLine] as any):null;
     if(input.kind!=='fixed'||!basis)throw new HttpError(422,'This fixed row no longer has its approved BOQ reference.');
     if(approvedEarthingBasis(basis)){
      if(row.itemId!=='CH-Earthing'||row.unit!==basis.unit||row.out===''||!new Decimal(row.out).equals(basis.qty))throw new HttpError(422,'CH-Earthing must retain its approved BOQ identity, unit and quantity.');
     }
    }
    if(!row.itemId)continue;
    if(input.kind==='variable'&&row.fixedGroup)throw new HttpError(422,'Fixed BOQ rows belong in fixed material preparation.');
    const policy=materialDocumentPolicy(row);
    if(row.section&&policy.variableDispatch&&(policy.group==='internal-variable'?'internal':'customer')!==row.section)throw new HttpError(422,'Keep the item in its matching variable-material module.');
    if(policy.group==='non-stock')throw new HttpError(422,'Genset synchronisation is not a stock issuance item.');
    if(policy.approvedQuantityLocked){
     const approved=selected.flatMap(s=>s.items as any[]).filter(approvedEarthingBasis);
     if(input.kind!=='fixed'||selected.length!==1||approved.length!==1||(row.out!==''&&!new Decimal(row.out).equals(approved[0].qty)))throw new HttpError(422,'CH-Earthing must retain its approved BOQ quantity.');
    }else{
     const item=finalItems.get(row.itemId);
     if(!item)throw new HttpError(422,'Select a reviewed final stock ID. The row remains available for correction.');
     if(row.unit&&!item.units.includes(row.unit))throw new HttpError(422,'Select a recorded stock unit for this item. Quantities are not converted automatically.');
    }
    if(selected.every(s=>s.installation===true)&&policy.variableDispatch!==(input.kind==='variable'))throw new HttpError(422,'This item belongs in the other material module. Keep the BOQ row and correct its selection.');
   }
   const snapshot={kind:input.kind,parent:input.parent,warehouse:input.warehouse,sites:selected,lines:input.lines,transport:input.transport,...(input.revisionReason?{revisionReason:input.revisionReason}:{}),status:'draft',stockPosting:false};
   if(input.id)await requireOpenParent(c,input.id);
   if(!input.id)await c.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[id,actor]);
   await c.query('INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6)',[id,input.version+1,snapshot,input.requestKey,hash(input),actor]);
   if(input.parent&&!(await c.query('SELECT 1 FROM inventory_parent_preparation_references WHERE draft_id=$1',[id])).rowCount){const first=(await c.query('SELECT number FROM inventory_material_dispatches_active WHERE draft_id=$1 ORDER BY created_at,id LIMIT 1',[id])).rows[0];const number=first?.number??await warehouseNumber(c,'PDO',id);await c.query('INSERT INTO inventory_parent_preparation_references(draft_id,number)VALUES($1,$2)',[id,number]);}
   return {id,version:input.version+1,stockPosting:false};
  };
  return client?execute(client):transaction(this.pool,execute);
 }
}
