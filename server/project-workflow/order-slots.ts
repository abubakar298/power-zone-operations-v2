import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';
import {validOrderPosition} from '../../shared/direct-po-reading.js';
import {growingProgramme,isExtraOrder} from '../../shared/extra-programme-orders.js';
import {slotRanges} from '../../shared/order-slot-ranges.js';
import {correctedOrderNumber} from './order-number-corrections.js';

/** Bank programme order slots (owner request, 24 Nov 2026).
 * A shared UPS IPO such as CHP-163 holds a fixed number of order slots, written on each IPO as "154/250".
 * A slot is free again when its site is cancelled: by the Operations head (Cancel site, with the customer's
 * proof) or in the reviewed source register (cancelled). Nobody has to release it by hand.
 * A transferred order (the register's "site has been shifted to IPO …") lives on under its new IPO, which counts
 * it there: its old number is neither free nor listed as a cancelled site (user, 26 Nov 2026).
 * The next new or renewed order may then use the same slot number. The cancelled order's IPO, documents and
 * history are never changed or deleted: it stays listed under Coordination → Cancelled Sites. */

type Db=Pool|PoolClient;
/** The dedicated Direct PO UPS agreements whose IPO number is shared by many orders. */
export const upsKeys=['MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10'];
type Row=Record<string,any>;
export type SlotIdentity={programme:string;customer:string;ipo:string;total:number;unit:number;order:string};
export type ActiveSlotOrder=SlotIdentity&{site:string;siteCode:string;ipoId:string|null};
export type CancelledOrderSite=SlotIdentity&{id:string;source:'Operations'|'Reviewed register';outcome:'Cancelled'|'Transferred';site:string;siteCode:string;po:string;
 ipoId:string|null;recordId:string|null;projectKey:string|null;cancelledAt:string|null;cancelledBy:string|null;reason:string};
/** capacity = the programme's target (250); extra = active orders above it (UBL UPS 250 grows, shared/extra-programme-orders.ts). */
export type SlotProgramme={key:string;customer:string;ipo:string;capacity:number;extra:number;inUse:number;freeCount:number;free:number[]};
export type CancelledSiteRow=CancelledOrderSite&{sr:number;slot:'Free'|'In use again';reusedBy:{site:string;siteCode:string}|null};
export type OrderSlotSummary={programmes:SlotProgramme[];sites:CancelledSiteRow[]};

const text=(v:unknown)=>String(v??'').trim();
const same=(a:unknown,b:unknown)=>text(a).replace(/\s+/g,' ').toLowerCase()===text(b).replace(/\s+/g,' ').toLowerCase();

/** "CHP-163" + "154/250" → programme CHP-163 · 250, slot 154. A revised IPO (-R1) keeps its original's slots.
 * An extra order above the target ("251/250", growing programmes only) is slot 251 of the same programme. */
export function slotIdentity(customer:unknown,ipo:unknown,order:unknown):SlotIdentity|null{
 const number=text(ipo).toUpperCase().replace(/-R\d+$/,''),position=text(order);
 if(!number||!(validOrderPosition(position)||isExtraOrder(position)))return null;
 const [unit,total]=position.split('/').map(Number),bank=text(customer).toUpperCase();
 return {programme:`${bank}|${number}|${total}`,customer:bank,ipo:number,total,unit,order:position};
}

/** Pure: which slots are free, and the cancelled sites numbered SR# 1, 2, 3… oldest cancellation first,
 * so a later cancellation never renumbers the earlier rows. `closed` = numbers of transferred orders (never free).
 * Only a growing programme (UBL UPS 250) shows orders above its target as extra orders. */
export function orderSlotSummary(active:ActiveSlotOrder[],cancelled:CancelledOrderSite[],closed:SlotIdentity[]=[]):OrderSlotSummary{
 const groups=new Map<string,SlotIdentity>();
 for(const order of [...active,...cancelled])if(!groups.has(order.programme))groups.set(order.programme,order);
 const programmes=[...groups.values()].map(g=>{
  const used=new Set(active.filter(a=>a.programme===g.programme).map(a=>a.unit)),highest=Math.max(g.total,...used);
  const shut=new Set(closed.filter(c=>c.programme===g.programme).map(c=>c.unit));
  const free=Array.from({length:highest},(_,i)=>i+1).filter(unit=>!used.has(unit)&&!shut.has(unit));
  const growing=!!growingProgramme(`1/${g.total}`,{customer:g.customer});
  return {key:g.programme,customer:g.customer,ipo:g.ipo,capacity:g.total,extra:growing?[...used].filter(unit=>unit>g.total).length:0,inUse:used.size,freeCount:free.length,free};
 }).sort((a,b)=>a.customer.localeCompare(b.customer)||a.ipo.localeCompare(b.ipo,'en',{numeric:true})||a.capacity-b.capacity);
 const sites=[...cancelled].sort((a,b)=>text(a.cancelledAt).localeCompare(text(b.cancelledAt))||a.ipo.localeCompare(b.ipo)||a.unit-b.unit||a.id.localeCompare(b.id)).map((site,index)=>{
  const reuse=active.find(a=>a.programme===site.programme&&a.unit===site.unit);
  return {...site,sr:index+1,slot:reuse?'In use again' as const:'Free' as const,reusedBy:reuse?{site:reuse.site,siteCode:reuse.siteCode}:null};
 });
 return {programmes,sites};
}

/** Operations cancellations: the 'Site cancelled' board event and its cancelled site version (never edited). */
export async function operationsCancellations(c:Db){
 const rows=(await c.query(`SELECT e.site_id,e.created_at,v.snapshot,
  (SELECT array_agg(l.ipo_id::text) FROM inventory_material_source_links l WHERE l.board_site_id=e.site_id) AS linked_ipos
  FROM operations_board_events e JOIN operations_board_versions v ON v.site_id=e.site_id AND v.version=e.site_version
  WHERE e.kind='Site cancelled' AND v.snapshot->>'cancelled'='true' ORDER BY e.created_at,e.site_id`)).rows;
 return rows.map(r=>{
  const s=r.snapshot??{},ipoIds=[...new Set([s.origin?.ipoId,...(r.linked_ipos??[])].filter(Boolean).map(String))];
  return {siteId:String(r.site_id),ipoIds,sourceKey:text(s.sourceKey)||(String(r.site_id).startsWith('registered-')?String(r.site_id).slice('registered-'.length):''),
   name:text(s.name),cancelledAt:new Date(s.cancellation?.cancelledAt??r.created_at).toISOString(),cancelledBy:text(s.cancellation?.cancelledBy)||null,reason:text(s.cancellation?.reason)};
 });
}

async function registerRows(c:Db):Promise<{rows:Row[];sourceDate:string|null}>{
 const source=(await c.query('SELECT source_date::text,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
 return {rows:(source?.snapshot?.registers??[]).flatMap((r:Row)=>r.rows??[]).filter((r:Row)=>r.kind==='UPS'),sourceDate:source?.source_date??null};
}
const registerCustomer=(r:Row)=>text(r.customer)||String(r.key??'').split(':')[0];

/** Every shared UPS order with its slot, split into active, cancelled and closed (transferred to another IPO). */
export async function loadOrderSlots(c:Db):Promise<{active:ActiveSlotOrder[];cancelled:CancelledOrderSite[];closed:SlotIdentity[]}>{
 const [operations,register,issued]=await Promise.all([operationsCancellations(c),registerRows(c),c.query(`SELECT i.id,i.number,i.created_at,i.snapshot,upper(cu.short_code) AS customer,cu.id AS customer_id,w.record_id
  FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id JOIN customers cu ON cu.id=p.customer_id
  LEFT JOIN project_workflow_issuances w ON w.ipo_id=i.id LEFT JOIN project_workflow_records r ON r.id=w.record_id
  WHERE i.snapshot->'approvedCommercialSource'->>'key'=ANY($1::text[]) AND r.data->>'localPreviewArchived' IS DISTINCT FROM 'true'
  ORDER BY i.created_at,i.id`,[upsKeys])]);
 const active:ActiveSlotOrder[]=[],cancelled:CancelledOrderSite[]=[],closed:SlotIdentity[]=[],byIpo=new Map<string,typeof operations[number]>(),byKey=new Map<string,typeof operations[number]>();
 for(const o of operations){for(const id of o.ipoIds)byIpo.set(id,o);if(o.sourceKey)byKey.set(o.sourceKey,o);}
 const listed=new Set<string>(),registerOrder=(ipo:unknown,order:unknown)=>`${text(ipo).toUpperCase()}|${text(order)}`;
 const registerCancelled=new Set<string>(),registerActive=new Set<string>();
 const cancel=(slot:SlotIdentity,o:typeof operations[number],site:Row)=>{
  if(listed.has(o.siteId))return;listed.add(o.siteId);
  cancelled.push({...slot,id:'operations:'+o.siteId,source:'Operations',outcome:'Cancelled',site:site.site||o.name,siteCode:site.siteCode,po:site.po,ipoId:site.ipoId??null,recordId:site.recordId??null,projectKey:site.projectKey??null,cancelledAt:o.cancelledAt,cancelledBy:o.cancelledBy,reason:o.reason});
 };
 for(const r of register.rows){
  const slot=slotIdentity(registerCustomer(r),r.ipo,r.orderNumber);if(!slot)continue;
  const site={site:text(r.site),siteCode:text(r.siteCode),po:text(r.po)},o=byKey.get(String(r.key));
  if(o)cancel(slot,o,site);
  else if(r.transferred===true&&r.cancelled!==true){registerCancelled.add(slot.customer+'|'+registerOrder(r.ipo,r.orderNumber));closed.push(slot);}
  else if(r.cancelled===true){
   registerCancelled.add(slot.customer+'|'+registerOrder(r.ipo,r.orderNumber));
   cancelled.push({...slot,id:'register:'+r.key,source:'Reviewed register',outcome:'Cancelled',...site,ipoId:null,recordId:null,projectKey:null,
    cancelledAt:register.sourceDate,cancelledBy:null,reason:text(r.cancellationOutcome)||text(r.cancellationReason)||text(r.transferOutcome)||text(r.outcome)});
  }else{active.push({...slot,...site,ipoId:null});registerActive.add(registerOrder(r.ipo,r.orderNumber));}
 }
 for(const i of issued.rows){
  const s=i.snapshot??{},typed=correctedOrderNumber({customer:i.customer,ipo:i.number,order:s.input?.orderNumber,siteCode:s.siteCode}),slot=slotIdentity(i.customer,i.number,typed);if(!slot)continue;
  const code=text(s.siteCode),site={site:text(s.siteName),siteCode:code,po:text(s.input?.poNumber),ipoId:String(i.id),recordId:i.record_id?String(i.record_id):null,projectKey:i.record_id&&code?JSON.stringify([String(i.customer_id),code.toUpperCase()]):null};
  const o=byIpo.get(String(i.id));
  if(o){cancel(slot,o,site);continue;}
  // Released without an Operations cancellation: an imported historical order the reviewed register cancels,
  // already listed from its register row. Same rule as ipo_order_slot_released (migration 309), kept in step by tests.
  const order=registerOrder(slot.ipo,typed),historical=![undefined,null,false,'',0].includes(s.historicalImport);
  if(historical&&registerCancelled.has(slot.customer+'|'+order)&&!registerActive.has(order))continue;
  active.push({...slot,site:site.site,siteCode:code,ipoId:site.ipoId});
 }
 return {active,cancelled,closed};
}

/** Pure: the free slots below an extra order ("253/250" → any of 1–252 not held by an active order of the same IPO
 * and not closed by a transfer). An IPO number with no orders yet has none. Empty for an order inside its target. */
export function freeSlotsBefore(active:ActiveSlotOrder[],slot:SlotIdentity,closed:SlotIdentity[]=[]):number[]{
 if(slot.unit<=slot.total)return [];
 const used=new Set(active.filter(a=>a.programme===slot.programme).map(a=>a.unit)),shut=new Set(closed.filter(c=>c.programme===slot.programme).map(c=>c.unit));
 return used.size?Array.from({length:slot.unit-1},(_,i)=>i+1).filter(unit=>!used.has(unit)&&!shut.has(unit)):[];
}

/** Freed slots first (owner, 25 Nov 2026): an extra order above the target of a growing programme
 * (shared/extra-programme-orders.ts) is refused while a lower slot of the same IPO is free. This also keeps
 * extra orders in sequence: 251, then 252, and so on. */
export async function requireFreedSlotsFirst(c:Db,context:{customerId:number;configurationKey:string}|undefined,ipo:string,order:string|null|undefined){
 if(!context||!order||!isExtraOrder(order)||!growingProgramme(order,{configurationKey:context.configurationKey}))return;
 const bank=(await c.query('SELECT short_code FROM customers WHERE id=$1',[context.customerId])).rows[0]?.short_code;
 const slot=slotIdentity(bank,ipo,order);if(!slot)return;
 const {active,closed}=await loadOrderSlots(c),free=freeSlotsBefore(active,slot,closed);
 if(free.length)throw new HttpError(409,`Order slot ${free[0]}/${slot.total} of IPO ${slot.ipo} is free. Use the free slot${free.length>1?'s':''} (${slotRanges(free)}) before order ${slot.order}.`);
}

/** IPOs whose slot is free again: the same rule the database insert guard uses (migration 309). */
export async function releasedIpoIds(c:Db,ids:string[]):Promise<Set<string>>{
 if(!ids.length)return new Set();
 return new Set((await c.query('SELECT id::text FROM unnest($1::uuid[]) AS x(id) WHERE ipo_order_slot_released(id)',[ids])).rows.map(r=>String(r.id)));
}

export async function cancelledSitesForCoordination(pool:Pool,actor:string):Promise<OrderSlotSummary>{
 const user=(await pool.query('SELECT role,active FROM users WHERE id=$1',[actor])).rows[0];
 if(!user?.active||!['Coordinator','Management','Admin'].includes(user.role))throw new HttpError(403,'Cancelled sites are available to Coordination and Management.');
 const {active,cancelled,closed}=await loadOrderSlots(pool);
 // Historical register orders have no IPO in the portal; link their project file when one exists for the same site code.
 const historical=cancelled.filter(s=>!s.projectKey&&s.siteCode);
 if(historical.length){
  const records=(await pool.query(`SELECT DISTINCT r.customer_id,upper(r.site_code) AS site_code,upper(cu.short_code) AS customer FROM project_workflow_records r JOIN customers cu ON cu.id=r.customer_id
   WHERE upper(cu.short_code)=ANY($1::text[]) AND upper(r.site_code)=ANY($2::text[])`,[[...new Set(historical.map(s=>s.customer))],[...new Set(historical.map(s=>s.siteCode.toUpperCase()))]])).rows;
  for(const s of historical){const match=records.filter(r=>r.customer===s.customer&&same(r.site_code,s.siteCode));if(match.length===1)s.projectKey=JSON.stringify([String(match[0].customer_id),s.siteCode.toUpperCase()]);}
 }
 return orderSlotSummary(active,cancelled,closed);
}
