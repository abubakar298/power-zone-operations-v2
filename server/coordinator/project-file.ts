import type {Pool} from 'pg';
import {dispatchPosted} from '../inventory/signed-dispatch.js';

/** Project file (Atif's documentation standard): every record of one customer site, in the order the work
 * happens. Read-only. Documents are linked, never copied; issued records stay exactly as saved. */
export const projectFileStages=['Site survey','BOQ','Quotation','Purchase order','IPO','Material issue / DO','Delivery','Installation & QC','Invoice'] as const;
export type ProjectFileStage=typeof projectFileStages[number];
export type ProjectFileItem={id:string;stage:ProjectFileStage;title:string;detail:string;at:string|null;url:string|null};
type Trail={deliveryOrders:any[];sites:any[];invoices:any[]};
const stageOf:Record<string,ProjectFileStage>={draft:'Site survey',boq:'BOQ',quotation:'Quotation',cni:'Quotation',submission:'IPO',ipo:'IPO',issuance:'IPO',workflow:'Site survey'};
const operationsStage:Record<string,string>={received:'Received by Operations',awaiting:'Awaiting delivery',delivered:'Delivered · installation pending',completed:'Completed'};
const iso=(v:any)=>v instanceof Date?v.toISOString():v==null?null:String(v);

/** Downstream records of the site's IPOs: Inventory DOs, the Operations site and Accounts invoice entries. */
export async function projectFileTrail(pool:Pool,ipoIds:string[]):Promise<Trail>{
 if(!ipoIds.length)return {deliveryOrders:[],sites:[],invoices:[]};
 const sites=(await pool.query(`SELECT DISTINCT ON(site_id) site_id,snapshot->>'stage' AS stage,snapshot->'installation' AS installation,snapshot->'documents' AS documents,created_at
  FROM operations_board_versions WHERE snapshot->'origin'->>'ipoId'=ANY($1::text[]) ORDER BY site_id,version DESC`,[ipoIds])).rows;
 const siteIds=sites.map(s=>String(s.site_id));
 const dos=(await pool.query(`SELECT d.id,d.number,d.warehouse,d.created_at FROM inventory_material_dispatches_active d
  WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(d.snapshot->'sites') s WHERE s->>'siteId'=ANY($1::text[]) OR s->>'registeredSiteId'=ANY($2::text[])) ORDER BY d.created_at,d.number`,[ipoIds,siteIds])).rows;
 const deliveryOrders=[];for(const d of dos)deliveryOrders.push({...d,signed:await dispatchPosted(pool,'dispatch',d.id)});
 const invoices=(await pool.query(`SELECT id,pt_reference,milestone,entry_date FROM accounts_invoice_entries WHERE site_key=ANY($1::text[]) ORDER BY entry_date,created_at`,[[...ipoIds,...siteIds]])).rows;
 return {deliveryOrders,sites,invoices};
}

/** Groups the project's documents, attachments and downstream records under the standard stages.
 * `owner` (Admin/Management) also sees invoice entries and DO document links. */
export function projectFile(documents:any[],attachments:any[],trail:Trail,owner:boolean){
 const items:ProjectFileItem[]=[];
 for(const d of documents)items.push({id:d.id,stage:stageOf[d.resource]??'Site survey',title:d.number||d.type,detail:[d.type,d.version!=null?'version '+d.version:null,d.version_status??d.stage].filter(Boolean).join(' · '),at:iso(d.created_at),url:d.pdf_url??null});
 for(const a of attachments)items.push({id:a.id,stage:/customer po|approval evidence/i.test(a.type)?'Purchase order':'Site survey',title:a.filename,detail:a.type,at:iso(a.created_at),url:a.url});
 for(const d of trail.deliveryOrders)items.push({id:d.id,stage:'Material issue / DO',title:d.number,detail:`${d.warehouse} · ${d.signed?'signed copy received, stock out posted':'awaiting signed copy'}`,at:iso(d.created_at),url:owner?`/api/material-dispatches/issued/${d.id}/document.pdf`:null});
 for(const s of trail.sites){
  items.push({id:'site:'+s.site_id,stage:s.stage==='completed'?'Installation & QC':'Delivery',title:operationsStage[s.stage]??String(s.stage??'Operations'),detail:s.installation===false?'Delivery only (no installation)':'Operations site record',at:iso(s.created_at),url:null});
  for(const doc of Array.isArray(s.documents)?s.documents:[])items.push({id:'site:'+s.site_id+':'+doc.id,stage:'Installation & QC',title:String(doc.label??'Installation document'),detail:String(doc.location??''),at:doc.date??null,url:null});
 }
 if(owner)for(const i of trail.invoices)items.push({id:i.id,stage:'Invoice',title:i.pt_reference,detail:i.milestone==='delivery'?'Delivery invoice':'Completion invoice',at:iso(i.entry_date),url:null});
 return projectFileStages.map(stage=>({stage,items:items.filter(i=>i.stage===stage).sort((a,b)=>String(a.at??'').localeCompare(String(b.at??'')))}));
}
