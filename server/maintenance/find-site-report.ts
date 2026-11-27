// Report behind server/maintenance/find-site.ts (read-only site locator). See that file for how to run it.
import type {Pool,PoolClient} from "pg";
import {qcMaterialHandoff} from "../accounts/qc-material-handoff.js";
import {withInventoryReceiving} from "../operations-board/inventory-delivery.js";
import {currentStage,siteBucket} from "../operations-board/workflow.js";
import {sitesAwaitingQcUsage} from "../inventory/qc-usage-pending.js";

/** One SQL condition: the row text contains the name, or the branch code as a whole number (leading zeros ignored). */
const match=(text:string)=>`((nullif($1::text,'') IS NOT NULL AND ${text} ILIKE '%'||$1::text||'%') OR (nullif($2::text,'') IS NOT NULL AND ${text} ~ ('(^|[^0-9])0*'||$2::text||'([^0-9]|$)')))`;
const bucketNames:Record<string,string>={received:"Assign team & vendors",awaiting:"Awaiting delivery",delivered:"Delivered (job completion in progress)",completed:"Completed",cancelled:"Cancelled"};
const when=(v:unknown)=>v?new Date(v as string).toISOString().slice(0,16).replace("T"," "):"—";

/** Prints where a site is in the portal. Read only: the caller runs it inside a READ ONLY transaction. */
export async function findSiteReport(c:PoolClient,search:{name:string;code:string},log:(text:string)=>void=console.log){
 const name=search.name.trim(),code=search.code.trim().replace(/^0+(?=\d)/,"");
 const line=(label:string,v:unknown)=>log(`    ${label.padEnd(26)} ${v===undefined||v===null||v===""?"—":String(v)}`);
 const p=[name,code];
 const heading=(title:string,n:number)=>log(`\n== ${title}: ${n} match${n===1?"":"es"}`);

 const ubl=(await c.query(`SELECT site_id,branch_code,site_name,main_city,legacy_ipo_number,po_number,status,configuration_id FROM ubl_site_orders WHERE ${match("(site_name||' '||branch_code)")} ORDER BY site_name`,p)).rows;
 heading("UBL site orders (customer order list)",ubl.length);
 for(const r of ubl){log(`  ${r.site_name} (${r.main_city}) · branch ${r.branch_code}`);line("UBL order status",r.status);line("Job / IPO","CHP-"+r.legacy_ipo_number);line("Customer PO",r.po_number);line("Configuration",r.configuration_id);}

 const requests=(await c.query(`SELECT r.id,r.site_name,r.branch_code,r.stage,r.data->>'ipoNumber' AS ipo,r.data->>'poNumber' AS po,
   (SELECT max(e.created_at) FROM ubl_workflow_events e WHERE e.request_id=r.id) AS last_change
  FROM ubl_workflow_requests r WHERE ${match("(r.site_name||' '||coalesce(r.branch_code,''))")} ORDER BY r.site_name`,p)).rows;
 heading("UBL intake workflow (survey, quote, BOQ)",requests.length);
 for(const r of requests){log(`  ${r.site_name} · branch ${r.branch_code??"—"}`);line("Workflow stage",r.stage);line("IPO",r.ipo);line("Customer PO",r.po);line("Last change",when(r.last_change));}

 const records=(await c.query(`SELECT r.id,r.site_name,r.site_code,r.route,r.stage,r.updated_at,cu.name AS customer
  FROM project_workflow_records r LEFT JOIN customers cu ON cu.id=r.customer_id WHERE ${match("(r.site_name||' '||r.site_code)")} ORDER BY r.updated_at DESC`,p)).rows;
 heading("Project workflow (department workspace)",records.length);
 for(const r of records){log(`  ${r.site_name} · code ${r.site_code} · ${r.customer??""}`);line("Route",r.route);line("Stage",r.stage);line("Last change",when(r.updated_at));}

 const ipos=(await c.query(`SELECT id,number,created_at,snapshot#>>'{customer,name}' AS customer FROM internal_purchase_orders WHERE ${match("snapshot::text")} ORDER BY created_at DESC LIMIT 20`,p)).rows;
 heading("Internal purchase orders (IPOs)",ipos.length);
 for(const r of ipos){log(`  ${r.number} · ${r.customer??""}`);line("Issued",when(r.created_at));}

 const latest=(await c.query(`SELECT * FROM (SELECT DISTINCT ON(site_id) site_id,version,snapshot,action,created_at FROM operations_board_versions ORDER BY site_id,version DESC) v
  WHERE ${match("(v.site_id||' '||v.snapshot::text)")} ORDER BY v.created_at DESC`,p)).rows;
 const board=await withInventoryReceiving(c,latest);
 heading("Operations board (site page, delivery, installation, QC)",board.length);
 const qcPending=await sitesAwaitingQcUsage(c as unknown as Pool,board.map(r=>({id:r.site_id,ipo:r.snapshot.ipo??""})));
 for(const r of board){
  const s=r.snapshot,row=latest.find(x=>x.site_id===r.site_id)!,bucket=s.superseded?"superseded":siteBucket(s);
  log(`  ${s.name} · ${[s.ipo,s.customer].filter(Boolean).join(" · ")}`);
  line("Board id",r.site_id);
  line("Portal page","https://app.powerzone.systems/operations/sites/"+encodeURIComponent(r.site_id));
  line("Board column",s.superseded?"Superseded (replaced by another record)":bucketNames[bucket]??bucket);
  line("Current step",s.superseded?"—":currentStage(s));
  line("Team / project",[s.operationsTeam,s.projectType].filter(Boolean).join(" / "));
  line("Planned delivery",s.dispatchDate);line("Planned installation",s.installationPlanDate);
  line("Completed",s.completed===true?"Yes":"No");
  if(bucket==="completed"&&s.installation===true)line("QC material usage",qcPending.has(r.site_id)?"Waiting for QC (shows under Completed Jobs Awaiting QC)":"Recorded");
  line("Last board change",`${when(row.created_at)} · ${row.action}`);
  const dos=(await c.query(`SELECT d.number,d.created_at,(p.document_id IS NOT NULL) AS posted
   FROM inventory_material_dispatches_active d CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'sites') x
   LEFT JOIN inventory_signed_dispatch_postings p ON p.document_kind='dispatch' AND p.document_id=d.id
   WHERE x->>'registeredSiteId'=$1 OR (x->>'registeredSiteId' IS NULL AND x->>'siteId'=$2) ORDER BY d.created_at`,[r.site_id,s.origin?.ipoId??""])).rows;
  line("Delivery orders",dos.length?dos.map(d=>`${d.number} (${d.posted?"signed gate copy saved":"awaiting signed gate copy"})`).join(", "):"none issued in the portal");
  try{
   const handoff=await qcMaterialHandoff(c,"site:"+r.site_id);
   if(handoff){
    line("Accounts hand-off",handoff.ready?"Ready":"On hold");
    for(const h of handoff.holds)line("  hold",h);
    const closure=(await c.query("SELECT stage,created_at FROM accounts_active_job_closures WHERE job_key=ANY($1::text[]) ORDER BY version DESC LIMIT 1",[[handoff.jobKey,...handoff.aliases]])).rows[0];
    line("Accounts closure",closure?`${closure.stage} (${when(closure.created_at)})`:"not started");
   }
  }catch(e){line("Accounts hand-off","could not be worked out: "+(e as Error).message);}
 }
 const found=ubl.length+requests.length+records.length+ipos.length+board.length;
 if(!found)log("\nNo site matched. Try a shorter name, or the branch code alone.");
 return {found,board:board.map(r=>r.site_id)};
}

