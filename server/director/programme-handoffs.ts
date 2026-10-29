import type {Pool} from 'pg';
import {z} from 'zod';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import {submissionDate,invoiceIdentity} from '../accounts/billing-model.js';

type Row=Record<string,any>;
export type ProgrammeHandoff={site_id:string;created_at:Date|string;snapshot:Row;fileIds:string[];receiving:{partial:boolean;createdAt:string}[];variableIssued:boolean;variableSigned?:boolean};
const date=(v:unknown):string|null=>z.iso.date().safeParse(v).success?String(v):null;
const validFile=(ref:any,files:Set<string>)=>typeof ref?.id==='string'&&files.has(ref.id);
/** Reporting only: upload timestamps are never substituted for delivery or QC dates. */
export function programmeHandoffState(observation:ProgrammeHandoff){
 const s=observation.snapshot,files=new Set(observation.fileIds),returns=s.deliveryReturns??[];
 const lastReturn=returns.at(-1);
 const afterReturn=!lastReturn?.recordedAt||String(s.deliveryRecordedAt??'')>lastReturn.recordedAt;
 const currentDeliveries=lastReturn?.scope==='partial'?(s.deliveries??[]).slice(lastReturn.priorDeliveries?.length??0):(s.deliveries??[]);
 const deliveries=currentDeliveries.filter((d:any)=>afterReturn&&date(d.deliveryDate)&&validFile(d.signedDo,files));
 const historicalDelivery=(s.documents??[]).find((d:any)=>d.id===`${observation.site_id}:historical-delivery-documents`&&date(d.evidenceDate??d.date)&&(!lastReturn?.recordedAt||String(d.createdAt??'')>lastReturn.recordedAt)&&validFile(d.evidence?.[0],files));
 const receiving=observation.receiving.filter(r=>!lastReturn?.recordedAt||r.createdAt>lastReturn.recordedAt);
 const returned=lastReturn?.scope==='full'&&!deliveries.length&&!receiving.length&&!historicalDelivery;
 const rollback=!!lastReturn&&(!afterReturn&&!historicalDelivery&&!receiving.some(r=>!r.partial));
 const full=deliveries.filter((d:any)=>!d.partial).at(-1);
 const delivered=!returned&&!!(full||historicalDelivery||receiving.some(r=>!r.partial));
 const partial=!returned&&!delivered&&!!(deliveries.length||receiving.length||lastReturn?.scope==='partial');
 const type=s.projectType??(/ups/i.test(String(s.type??''))?'ups':null);
 const names=type==='ups'?['job']:type==='bess'?['cabinet','panel','bessTesting','handover']:['civil','electrical','testing','signoff'];
 const entries=names.map(n=>n==='job'?s.qcJob:s.qc?.[n]),final=entries.at(-1);
 const checks=type!=='ups'||['mounting','electrical','testingTraining','signoff'].every(k=>final?.checks?.[k]===true);
 const qcDates=entries.every(e=>date(e?.date))&&entries.every((e,i)=>!i||e.date>=entries[i-1].date);
 const signed=validFile(final?.acknowledgement,files)&&(!observation.variableIssued||observation.variableSigned===true||validFile(final?.variableSignoff,files));
 const historicalHandover=(s.documents??[]).find((d:any)=>d.id===`${observation.site_id}:historical-handover-documents`&&date(d.evidenceDate??d.date)&&validFile(d.evidence?.[0],files)&&(!observation.variableIssued||validFile(d.evidence?.[2],files)));
 const installed=!returned&&s.installation===true&&!s.scopePending&&s.completed===true&&!!((qcDates&&checks&&signed)||historicalHandover);
 const scheduled=!delivered&&!!(date(s.dispatchDate)||(s.planningBatches??[]).some((b:any)=>b.stops?.some((stop:any)=>stop.siteId===observation.site_id&&date(stop.plannedDate))));
 return {delivered,partialDelivery:partial,installed,scheduled,returned,rollback,deliveryDate:date(full?.deliveryDate)??date(historicalDelivery?.evidenceDate??historicalDelivery?.date),installationDate:installed?(date(final?.date)??date(historicalHandover?.evidenceDate??historicalHandover?.date)):null};
}
/** Exact source/IPO identities only. Confirmed historical milestones survive an
 * incomplete later snapshot; an explicit full delivery return is an exception. */
export function applyProgrammeHandoffs(snapshot:Row,observations:ProgrammeHandoff[],invoices:Row[]=[]):Row{
 const evidence=snapshot.evidence?.rows??[];
 return {...snapshot,registers:(snapshot.registers??[]).map((register:Row)=>({...register,rows:register.rows.map((row:Row)=>{
  if(row.cancelled||row.transferred)return row;
  const candidates=observations.filter(o=>o.site_id==='registered-'+row.key||o.snapshot.sourceKey===row.key||row.key==='issued:'+o.snapshot.origin?.ipoId);
  const flags=[...(row.flags??[])];let projected={...row};
  if(candidates.length===1){
   const observation=candidates[0],state=programmeHandoffState(observation);
   projected={...row,installationRequired:observation.snapshot.installation,delivered:state.returned?false:!state.rollback&&row.delivered===true||state.delivered,partialDelivery:state.returned?false:!state.rollback&&row.delivered===true?false:state.partialDelivery||row.partialDelivery===true,installed:state.returned?false:row.installed===true||(state.installed&&(state.delivered||row.delivered===true&&!state.rollback)),scheduled:state.scheduled,deliveryDate:state.deliveryDate??row.deliveryDate??null,installationDate:state.installationDate??row.installationDate??null};
   if(state.returned){projected.deliveryDate=null;projected.installationDate=null;flags.push('All material returned; nothing delivered. Delivery must be confirmed again.');}
   else if(!projected.delivered&&observation.snapshot.stage!=='received')flags.push('Customer-signed DO required to confirm delivery.');
   if(!projected.installed&&observation.snapshot.completed===true&&observation.snapshot.installation!==false)flags.push('QC acknowledgement, applicable sign-offs and completion date require confirmation.');
   projected.recordKey=row.recordKey??observation.site_id;
  }else if(candidates.length>1)flags.push('Multiple Operations identities require review; historical stages retained.');
  const customer=row.customer==='MBL'||String(row.key).startsWith('MBL:')?'Meezan Bank Limited':'United Bank Limited';
  const refs=[...(row.invoiceReferences??[]),...(row.verifiedInvoiceReferences??[])].map(invoiceIdentity).filter(Boolean);
  const historical=!String(row.key).startsWith('issued:');
  const confirmedDates=evidence.filter((e:Row)=>e.customer===customer&&e.status==='submitted'&&refs.includes(invoiceIdentity(e.invoice))).map((e:Row)=>submissionDate(e.date)).filter(Boolean);
  if(row.kind==='UPS'){
   const submittedDate=confirmedDates.at(-1)??submissionDate(row.invoiceStatus);
   projected.singleInvoiceSubmitted=row.singleInvoiceSubmitted===true&&(historical||refs.length>0&&!!submittedDate);
   if(row.singleInvoiceSubmitted===true&&!submittedDate)flags.push('Actual invoice submission date/reference needs Accounts confirmation.');
  }else if(row.program==='Solar 70'){
   for(const phase of ['advance','completion'])if(row[phase]){
    const stage=row[phase],confirmedDate=submissionDate(stage.submissionEvidence);
    projected[phase]={...stage,submitted:stage.submitted===true&&(historical||!!confirmedDate)};
    if(stage.submitted===true&&!confirmedDate)flags.push(`${phase==='advance'?'Delivery':'Completion'} invoice submission date needs Accounts confirmation.`);
   }
  }
  const linkedIds=new Set([row.key,'registered-'+row.key,...(candidates.length===1?[candidates[0].site_id]:[])]);
  const recorded=invoices.filter(e=>linkedIds.has(e.site_key)&&typeof e.pt_reference==='string'&&e.pt_reference.trim());
  return {...projected,invoiceReferences:[...new Set([...(row.verifiedInvoiceReferences??[]),...(row.invoiceReferences??[]),...recorded.map(e=>e.pt_reference.trim())])],flags:[...new Set(flags)]};
 })}))};
}
/** Bounded metadata reads. File contents and the stock ledger are never loaded. */
export async function latestProgrammeHandoffs(pool:Pool):Promise<ProgrammeHandoff[]>{
 const [versions,files,copies,dispatches]=await Promise.all([
  pool.query(`SELECT DISTINCT ON(site_id) site_id,created_at,jsonb_build_object(
   'sourceKey',snapshot->'sourceKey','origin',snapshot->'origin','type',snapshot->'type','projectType',snapshot->'projectType',
   'stage',snapshot->'stage','completed',snapshot->'completed','installation',snapshot->'installation','scopePending',snapshot->'scopePending',
   'deliveryRecordedAt',snapshot->'deliveryRecordedAt','dispatchDate',snapshot->'dispatchDate','planningBatches',snapshot->'planningBatches','deliveryReturns',snapshot->'deliveryReturns',
   'deliveries',snapshot->'deliveries','qc',snapshot->'qc','qcJob',snapshot->'qcJob','documents',snapshot->'documents') AS snapshot
   FROM operations_board_versions ORDER BY site_id,version DESC`),
  pool.query('SELECT site_id,id FROM operations_board_files'),
  pool.query(`SELECT d.snapshot->'sites' AS sites,d.snapshot->'parent' AS parent,d.snapshot->'partialDelivery' AS partial,c.created_at,c.copy_kind,c.source_site_id
   FROM inventory_gate_pass_copies c JOIN inventory_material_dispatches d ON d.id=c.document_id
   JOIN inventory_material_evidence e ON e.id=c.evidence_id AND e.warehouse=c.warehouse
   WHERE c.document_kind='dispatch' AND c.copy_kind IN ('signed-customer','customer-signoff')`),
  pool.query(`SELECT snapshot->'sites' AS sites,snapshot->'lines' AS lines FROM inventory_material_dispatches`),
 ]);
 return versions.rows.map(v=>{
  const matches=(site:any)=>site.registeredSiteId===v.site_id||!!v.snapshot.origin?.ipoId&&site.siteId===v.snapshot.origin.ipoId;
  const receiving=copies.rows.filter(c=>c.copy_kind==='signed-customer'&&c.parent!==true&&c.sites?.length===1&&matches(c.sites[0])).map(c=>({partial:c.partial===true,createdAt:new Date(c.created_at).toISOString()}));
  const variableIssued=dispatches.rows.some(d=>(d.sites??[]).some((site:any)=>matches(site)&&(d.lines??[]).some((line:any)=>line.sites?.includes(site.siteId)&&Number(line.out)>0&&materialDocumentPolicy(line).customerUsageSignoff)));
  const variableSigned=copies.rows.some(c=>c.copy_kind==='customer-signoff'&&(c.sites??[]).some((site:any)=>matches(site)&&c.source_site_id===site.siteId));
  return {...v,variableSigned,fileIds:files.rows.filter(f=>f.site_id===v.site_id).map(f=>f.id),receiving,variableIssued};
 });
}
