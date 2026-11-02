import type {Pool,PoolClient} from 'pg';
/** Programme identity is resolved from saved foreign keys and issued IPOs. No PO/name joins,
 * copied financial rows, synthetic IPOs or updates to frozen legacy approvals. */
export const SOLAR_PROGRAMME='UBL Solar 70';
export function solarConfiguration(value:unknown){return typeof value==='string'?value.match(/(?:^|[^0-9])(20-20-30|25-20-30|30-30-40|35-30-40)(?=$|[^0-9])/)?.[1]??null:null;}
export function solarWorkflow(r:any){
 if(String(r.customer_code).toUpperCase()!=='UBL'||r.data?.localPreviewArchived===true)return false;
 const family=r.family??r.data?.basis?.boq?.survey?.family??r.data?.surveyInputs?.family;
 if(family==='bess-only'||r.framework_type==='bank-ups')return false;
 return r.framework_type==='ubl-solar'||r.legacy_type==='ubl'||
  !!solarConfiguration(r.configuration_key??r.data?.basis?.source?.key)&&r.data?.basis?.source?.type==='framework'||
  ['solar-hybrid','solar-on-grid'].includes(family);
}
export async function ublProgrammeLinks(pool:Pool|PoolClient){
 const [legacy,workflow,boards,closures]=await Promise.all([
  pool.query('SELECT site_id,legacy_ipo_number,configuration_id,status,site_name FROM ubl_effective_site_orders'),
  pool.query(`SELECT r.id,r.site_id,r.site_name,r.site_code,r.region,r.stage,r.legacy_type,r.legacy_id,r.created_at,r.updated_at,
   jsonb_build_object('localPreviewArchived',r.data->'localPreviewArchived','basis',jsonb_build_object('source',r.data#>'{basis,source}','boq',jsonb_build_object('survey',jsonb_build_object('family',r.data#>'{basis,boq,survey,family}'))),'surveyInputs',jsonb_build_object('family',r.data#>'{surveyInputs,family}')) data,
   c.short_code customer_code,f.payload->>'type' framework_type,COALESCE(r.data#>>'{basis,source,key}',f.configuration_key) configuration_key,
   COALESCE(r.data#>>'{basis,boq,survey,family}',f.payload#>>'{boq,survey,family}') family,
   w.ipo_id,i.number ipo_number,i.snapshot#>>'{allocation,total}' agreed_total,p.reference po_number,p.input->>'date' po_date
   FROM project_workflow_records r JOIN customers c ON c.id=r.customer_id
   LEFT JOIN project_framework_versions f ON f.id=r.framework_id
   LEFT JOIN LATERAL(SELECT * FROM project_workflow_issuances WHERE record_id=r.id ORDER BY created_at DESC LIMIT 1)w ON true
   LEFT JOIN internal_purchase_orders i ON i.id=w.ipo_id LEFT JOIN project_po_receipts p ON p.id=w.receipt_id
   WHERE upper(c.short_code)='UBL' AND r.data->>'localPreviewArchived' IS DISTINCT FROM 'true' ORDER BY r.created_at,r.id`),
  pool.query(`SELECT DISTINCT ON(site_id) site_id,version,jsonb_build_object('origin',snapshot->'origin','sourceKey',snapshot->'sourceKey','stage',snapshot->'stage','partial',snapshot->'partial','completed',snapshot->'completed','deliveryDate',snapshot->'deliveryDate','qc',jsonb_build_object('civil',snapshot#>'{qc,civil}','handover',snapshot#>'{qc,handover}','signoff',snapshot#>'{qc,signoff}'),'qcJob',snapshot->'qcJob','superseded',snapshot->'superseded') snapshot FROM operations_board_versions ORDER BY site_id,version DESC`),
  pool.query('SELECT DISTINCT ON(job_key) job_key,stage,created_at FROM accounts_active_job_closures ORDER BY job_key,version DESC')
 ]);
 const links=new Map<string,any>();
 for(const l of legacy.rows){const number='CHP-'+String(l.legacy_ipo_number).replace(/^CHP-/i,'');links.set('ubl:'+l.site_id,{jobKey:'ubl:'+l.site_id,siteId:l.site_id,siteName:l.site_name,ipo:number,configuration:l.configuration_id,programme:SOLAR_PROGRAMME,status:l.status,workflowIds:[],boardIds:[]});}
 for(const r of workflow.rows.filter(solarWorkflow)){
  const number=r.ipo_number,original=number?legacy.rows.find(l=>String(l.legacy_ipo_number).replace(/^CHP-/i,'')===number.replace(/^CHP-/i,'')):r.legacy_type==='ubl'?legacy.rows.find(l=>l.site_id===r.site_id):undefined;
  const jobKey=original?'ubl:'+original.site_id:r.ipo_id?'ipo:'+r.ipo_id:'workflow:'+r.id;
  const previous=links.get(jobKey);const link={...previous,jobKey,siteId:r.site_id,siteName:r.site_name,siteCode:r.site_code,region:r.region,ipo:number??previous?.ipo??null,ipoId:r.ipo_id??previous?.ipoId??null,configuration:solarConfiguration(r.configuration_key)??previous?.configuration??null,programme:SOLAR_PROGRAMME,status:previous?.status??(r.stage==='declined'?'Cancelled':r.ipo_id?'Active':'Pre-IPO'),workflowId:r.id,workflowIds:[...(previous?.workflowIds??[]),r.id],workflowStage:r.stage,agreedTotal:r.agreed_total??null,poNumber:r.po_number??null,poDate:r.po_date??null,createdAt:r.created_at,boardIds:previous?.boardIds??[]};links.set(jobKey,link);
 }
 for(const l of links.values()){
  const matches=boards.rows.filter(b=>!b.snapshot.superseded&&(l.ipoId&&b.snapshot.origin?.ipoId===l.ipoId||l.ipo&&b.site_id==='registered-UBL:SOLAR:'+String(l.ipo).replace(/^CHP-/i,'')));
  l.boardIds=matches.map(b=>b.site_id);
  // Ambiguous live/imported boards remain visible, never merged by name or guessed PO.
  l.operations=matches.length===1?matches[0].snapshot:null;l.operationsVersion=matches.length===1?matches[0].version:null;
  l.closure=closures.rows.find(c=>c.job_key===l.jobKey)??null;
  l.flags=matches.length>1?['More than one Operations record; review the exact IPO linkage.']:[];
 }
 return [...links.values()];
}
export function programmeOperation(link:any){
 const s=link.operations;if(!s)return null;
 const completed=s.completed===true||s.stage==='completed',full=s.stage==='delivered'||completed;
 return {solarDelivery:s.deliveryDate??'',equipmentDelivery:full?s.deliveryDate??'':'',startDate:s.qc?.civil?.date??'',completionDate:completed?s.qc?.handover?.date??s.qc?.signoff?.date??s.qcJob?.date??'':'',estimatedDate:'',installationStatus:completed?'Installation completed':s.partial||full||s.qc?.civil?'Work in Progress':'Awaiting data',remarks:'Current Operations / QC record',evidence:''};
}

/** Add only issued native Solar jobs missing from the reviewed source. Existing amounts,
 * invoice numbers, receipts and submission evidence always remain authoritative. */
export function withProgrammeAccounts(snapshot:any,links:any[]){
 const existing=(snapshot.registers??[]).flatMap((r:any)=>r.rows??[]),siteRows=snapshot.sites?.rows??[];
 const additions=links.filter(l=>l.ipoId&&l.status==='Active'&&!existing.some((r:any)=>r.key==='UBL:SOLAR:'+String(l.ipo).replace(/^CHP-/i,''))).map(l=>({key:'UBL:SOLAR:'+String(l.ipo).replace(/^CHP-/i,''),customer:'UBL',kind:'Solar / BESS',program:'Solar 70',site:l.siteName,siteCode:l.siteCode,ipo:l.ipo,po:l.poNumber,grossContract:l.agreedTotal,delivered:false,installed:false,cancelled:false,transferred:false,invoiceReferences:[],accountsReferences:[],advance:{invoiceAmount:null,submitted:false,received:false},completion:{invoiceAmount:null,submitted:false,received:false},flags:l.flags,sources:[],mappingStatus:'Exact issued workflow IPO',workflowId:l.workflowId,jobKey:l.jobKey}));
 return {...snapshot,registers:[...(snapshot.registers??[]),...(additions.length?[{program:'Solar 70',rows:additions}]:[])],sites:{...snapshot.sites,rows:[...siteRows,...additions.filter(a=>!siteRows.some((r:any)=>r.key===a.key))]}};
}
