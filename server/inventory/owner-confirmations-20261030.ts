import type {Pool} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
import {ProjectWorkflowRepository} from '../project-workflow/repository.js';
import {linkMaterialSource,approvedMaterialIdentity} from './source-links.js';
import {importPendingIpo} from './pending-ipo-import.js';
const batch='owner.inventory-confirmations.20261030';
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ids={abbott:'live-ipo:5b1a79dd-f7b0-4b0d-b3d4-5718c33d3b27',newOld:'live-ipo:83768500-dfe1-470d-bab5-14d68896c488',newCurrent:'registered-MBL:CHP-233:20-site order:3/20',ghouri:'registered-MBL:CHP-338:60-site order:16/60',chungi:'registered-MBL:CHP-338:60-site order:19/60',archer:'registered-MBL:CHP-338:60-site order:3/60'};
/** Owner-confirmed, exact six-row repair only. No HTTP endpoint or stock posting. */
export async function applyOwnerSiteConfirmations(pool:Pool,actor:string,commit=false){
 return transaction(pool,async c=>{
  const user=await lockActiveActor(c,actor);if(!['Admin','Management'].includes(user.role))throw new HttpError(403,'Active owner authorization required.');
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('material.source.links',0))");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('operations.board.import',0))");
  if((await c.query('SELECT 1 FROM audit_log WHERE action=$1',[batch])).rowCount)return {unchanged:true,batch};
  const now=new Date().toISOString(),repo=new ProjectWorkflowRepository(pool),changed:any[]=[],linked:any[]=[];
  const protectedTables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'accounts_%' OR tablename LIKE 'stock_%' OR tablename LIKE 'inventory_warehouse_%' OR tablename IN('material_dispatches','warehouse_transfers','inventory_material_stock_entries')) ORDER BY tablename")).rows.map(r=>r.tablename as string);
  const fingerprints=async()=>{const out:Record<string,string>={};for(const t of protectedTables){const rows=(await c.query(`SELECT to_jsonb(r) AS r FROM ${t} r`)).rows.map(r=>JSON.stringify(r.r)).sort();out[t]=digest(rows);}return out;};
  const before=await fingerprints();
  const boards=new Map<string,any>();for(const id of Object.values(ids)){await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR UPDATE',[id]);const r=(await c.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];if(!r)throw Error('Missing confirmed site '+id);boards.set(id,r);}
  const writeBoard=async(id:string,patch:any,reason:string)=>{const r=boards.get(id);const s={...r.snapshot,...patch,history:[...(r.snapshot.history??[]),{date:now,description:reason}]};await c.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,r.version+1,s,'Owner site identity confirmed',reason,randomUUID(),actor]);boards.set(id,{version:r.version+1,snapshot:s});changed.push({id,version:r.version+1,reason});};
  const correction=async(ipoId:string,po:string,order:string,name:string)=>{
   const ipo=(await c.query('SELECT i.*,p.po_number FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id WHERE i.id=$1',[ipoId])).rows[0];if(!ipo)throw Error('Missing confirmed IPO');
   if(ipo.snapshot.input?.orderNumber!==(ipoId.endsWith('c488')?'3/60':'25/60')||ipo.snapshot.input?.poNumber!=='')throw Error('Original placeholder identity changed; review before applying.');
   const r=(await c.query('SELECT * FROM project_workflow_records WHERE id=$1',[ipo.snapshot.workflowRecordId])).rows[0];if(!r)throw Error('Original workflow provenance missing');
   const doc=await repo.document(c,r,actor,'IPO site identity correction',{ipoId,originalFingerprint:digest(ipo.snapshot),previousSiteCode:ipo.snapshot.siteCode,siteCode:ipo.snapshot.siteCode,previousSiteName:ipo.snapshot.siteName,siteName:name,previousPoNumber:ipo.snapshot.input.poNumber,previousSavedPoReference:ipo.po_number,poNumber:po,previousOrderNumber:ipo.snapshot.input.orderNumber,orderNumber:order,reason:'Owner confirmed shared bank PO and current order in site-by-site review,30October2026. Original IPO/BOQ/allocation and email approval preserved.',ownerConfirmationBatch:batch});
   changed.push({ipoId,correctionId:doc.id});return ipo;
  };
  const abbottIpo='5b1a79dd-f7b0-4b0d-b3d4-5718c33d3b27',newIpo='83768500-dfe1-470d-bab5-14d68896c488';
  await correction(abbottIpo,'1210037986','25/60','Abbottabad Road, Mansehra Branch');
  await writeBoard(ids.abbott,{customerPo:'1210037986',materialLinkReview:null},'Owner confirms common MBL UPS60 PO1210037986 forCHP-33825/60.');
  await correction(newIpo,'1210031784','3/20','New Chaali Barnch, Karachi');
  await writeBoard(ids.newCurrent,{customerPo:'1210031784',materialLinkReview:null,previousOrder:'3/60',sourceFlags:(boards.get(ids.newCurrent).snapshot.sourceFlags??[]).filter((s:string)=>!s.startsWith('Accounts link pending:'))},'Owner confirms New Chaali3/20 supersedes3/60 after extra-battery upgrade; common MBL UPS20 PO1210031784.');
  await writeBoard(ids.newOld,{superseded:true,supersededBy:ids.newCurrent,materialLinkReview:null},'Owner confirms same New Chaali order upgraded3/60 to3/20. Historical record retained; use canonical3/20 for active work.');
  for(const [id,ipo]of [[ids.abbott,abbottIpo],[ids.newCurrent,newIpo]]){const b=boards.get(id);const result=await linkMaterialSource(pool,actor,{boardSiteId:id,boardVersion:b.version,ipoId:ipo,reason:'Owner confirmed exact current site/order/common PO; original approved BOQ preserved. '+batch,requestKey:randomUUID()},c);linked.push({boardSiteId:id,ipoId:ipo,...result});}
  const ghouri=boards.get(ids.ghouri).snapshot;if(ghouri.stage!=='received'||ghouri.completed||ghouri.deliveryReturns?.at(-1)?.scope!=='full'||ghouri.deliveryDate)throw Error('Ghouri return state changed; no reissue authorization applied.');
  const source=(await c.query('SELECT version FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
  const framework=(await c.query("SELECT id FROM project_framework_current WHERE configuration_key='MBL-UPS-6-5'")).rows[0];if(!framework)throw Error('Approved MBL60 BOQ missing');
  for(const id of [ids.ghouri,ids.chungi,ids.archer]){
   const b=boards.get(id),result=await importPendingIpo(pool,actor,{boardSiteId:id,boardVersion:b.version,sourceVersion:source.version,frameworkId:framework.id,requestKey:randomUUID(),reason:'Owner confirms current MBL60 order, common PO1210037986 and approved6-5 BOQ. '+(id===ids.ghouri?'All material returned, nothing delivered; return date unknown. Existing return/warehouse verification retained; fresh dispatch permitted.':id===ids.archer?'3/60 supersedes older46/62; preserve history.':'')+' '+batch},c);
   linked.push({id,...result});await writeBoard(id,{materialLinkReview:null,...(id===ids.archer?{supersedesSourceKey:'MBL:CHP-220:62-site order:46/62'}:{})},'Owner confirmed MBL60 IPO/BOQ linked; no stock movement. '+batch);
  }
  const oldArcher='registered-MBL:CHP-220:62-site order:46/62',old=(await c.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[oldArcher])).rows[0];
  if(old){boards.set(oldArcher,old);await writeBoard(oldArcher,{superseded:true,supersededBy:ids.archer},'Owner confirms Archer Road3/60 supersedes46/62; keep earlier documents/history only.');}
  for(const item of linked){const ipoId=item.ipoId;const ipo=await approvedMaterialIdentity(c,ipoId);if(!ipo.snapshot.boqRevisionId||!ipo.snapshot.input.poNumber)throw Error('Unresolved approved identity');}
  const after=await fingerprints();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Protected Accounts/stock/dispatch records changed; rolling back batch.');
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,batch]);
  const result={batch,commit,changed,linked,protectedFingerprints:after,stockMovementsCreated:0};
  if(!commit){const e:any=new Error('DRY_RUN_SUCCESS');e.result=result;throw e;}
  return result;
 });
}
