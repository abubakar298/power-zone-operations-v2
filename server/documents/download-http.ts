import type{Request,RequestHandler}from'express';
import type{Pool}from'pg';
import{registeredDownloadName}from'./download-name.js';
import{filenameFromDisposition,type DownloadName}from'../../shared/download-name.js';
const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export async function exportContext(pool:Pool,req:Pick<Request,'originalUrl'|'body'|'query'>,extension:string,originalName=''):Promise<DownloadName>{
 const path=req.originalUrl.split('?')[0],ids=[...new Set([...(path.match(uuid)??[]),...[req.body?.quotationId,req.body?.pricingId,req.body?.boqRevisionId,req.body?.previewPricing?.boqRevisionId].filter((v:any)=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v))])];
 const type=/peachtree|\/pt\.pdf/i.test(path)?'PT Breakup':/\/ipo\.pdf|\/pack\.pdf/i.test(path)?'IPO and PT':/\/orders\//.test(path)?'IPO':/quotations/.test(path)?'Quotation':/proposal/.test(path)?'Quotation':/costing/.test(path)?'Costing Review':/boqs/.test(path)?'BOQ':/operations\/store/.test(path)?'Delivery Order':/operations/.test(path)?'Final BOQ':/invoice/i.test(path)?'Invoice':/dispatch/.test(path)?String(req.query?.kind)==='forms'?'Survey Forms':'Survey Dispatch':extension==='xlsx'?'Survey Report':/source\.pdf/.test(path)?'Approved BOQ':/files|uploads|evidence/.test(path)?'Evidence':'Report';
 const base:DownloadName={documentType:type,identity:path+(req.query?.kind?`:${req.query.kind}`:''),extension};
 if(/DRAFT/i.test(originalName))base.documentType+=' DRAFT';
 else if(/PREVIEW/i.test(originalName))base.documentType+=' Preview';
 const row=async(table:string,identities=ids)=>{if(!identities.length)return undefined;const found=(await pool.query(`SELECT to_jsonb(t)-'content'-'xlsx'-'report_pdf' AS value FROM ${table} t WHERE id::text=ANY($1::text[]) LIMIT 1`,[identities])).rows[0]?.value;return found?{...found,__download_namespace:table}:undefined;};
 let entity:any;
 if(path.startsWith('/api/project-workflow/')){
  if(/survey-submission-groups|approved-survey-groups|ubl-survey-packages/.test(path)){
   const isGroup=path.includes('survey-submission-groups'),group=await row(isGroup?'survey_submission_groups':'ubl_survey_review_packages');
   if(group){const members=(await pool.query(isGroup?'SELECT r.customer_id,r.site_name,r.site_code FROM survey_submission_group_members m JOIN project_workflow_records r ON r.id=m.record_id WHERE m.group_id=$1':'SELECT r.customer_id,r.site_name,r.site_code FROM project_workflow_records r WHERE r.data->>\'ublSurveyPackageId\'=$1',[group.id])).rows;base.site=members.length===1?members[0].site_name:`Combined ${members.length||''} Sites`.replace(/ +/g,' ');base.siteCode=members.length===1?members[0].site_code:undefined;entity={...group,customer_id:members[0]?.customer_id??5};}
  }else if(path.includes('survey-dispatch-previews'))entity=await row('survey_dispatch_previews');
  else if(path.includes('framework-reference-attachments')){entity=await row('framework_reference_attachments');if(entity){const f=(await pool.query('SELECT customer_id,configuration_key FROM project_framework_versions WHERE id=$1',[entity.framework_id])).rows[0];entity={...entity,...f};base.site='Agreement reference';base.documentType='PO Reference';}}
  else{const r=await row('project_workflow_records',ids.slice(0,1));if(r){base.customer=(await pool.query('SELECT short_code,name FROM customers WHERE id=$1',[r.customer_id])).rows[0]?.short_code;base.site=r.site_name;base.siteCode=r.site_code;entity=/\/documents\//.test(path)?await row('project_workflow_documents',ids.slice(-1)):/\/files\//.test(path)?await row('project_workflow_files',ids.slice(-1)):r;if(entity?.kind)base.documentType=entity.kind;}}
 }else if(path.startsWith('/api/orders/')){entity=await row(path.includes('/submissions/')?'ipo_submissions':path.includes('/documents/')?'customer_po_documents':'internal_purchase_orders');if(path.includes('/documents/')&&entity){const source=(await pool.query('SELECT q.snapshot FROM customer_purchase_orders p JOIN quotation_versions q ON q.id=p.quotation_id WHERE p.document_id=$1 LIMIT 1',[entity.id])).rows[0];if(source)entity={...entity,snapshot:source.snapshot};base.documentType='Customer PO';}}
 else if(path.startsWith('/api/commercial/'))entity=await row(path.includes('/cni/')?'cni_proposal_versions':path.includes('/pricing/')?'commercial_pricing_versions':'quotation_versions');
 else if(path.startsWith('/api/boqs/')){entity=await row(path.includes('/attachments/')?'survey_uploads':path.includes('/reviews/')?'boq_review_submissions':path.includes('/drafts/')?'survey_drafts':'boq_revisions');if(!entity&&ids.length&&!/reviews|drafts|attachments/.test(path)){const saved=(await pool.query('SELECT to_jsonb(r) AS value FROM boq_revisions r WHERE r.boq_id::text=ANY($1::text[]) ORDER BY r.revision DESC LIMIT 1',[ids])).rows[0]?.value;if(saved)entity={...saved,__download_namespace:'boq_revisions'};}}
 else if(path.startsWith('/api/operations/'))entity=await row(path.includes('/store/')?'store_boq_issuances':'operations_boq_issuances');
 else if(path.startsWith('/api/design/')){entity=await row(path.includes('/uploads/')?'survey_uploads':'design_surveys',ids.slice(0,1));}
 else if(path.startsWith('/api/survey-uploads/'))entity=await row('survey_uploads');
 else if(path.startsWith('/api/cni/'))entity=await row('cni_proposal_versions',ids.slice(-1));
 else if(path.startsWith('/api/inventory/files/')||path.startsWith('/api/accounts-workspace/evidence/')){
  entity=await row(path.startsWith('/api/inventory/')?'inventory_report_files':'job_closure_evidence');
  let job=entity?.job_key;if(entity?.report_id)job=(await pool.query('SELECT job_key FROM inventory_reports WHERE id=$1',[entity.report_id])).rows[0]?.job_key;
  if(job?.startsWith('ipo:')){const order=await row('internal_purchase_orders',[job.slice(4)]);if(order)entity={...entity,snapshot:order.snapshot};}
  if(/invoice/i.test(originalName))base.documentType='Invoice';
 }
 else if(path.startsWith('/api/ubl-workflow/')||path.startsWith('/api/ubl/workflow/')){entity=await row(path.includes('/attachments/')?'ubl_workflow_attachments':'ubl_workflow_documents',ids.slice(-1))??await row('ubl_workflow_requests',ids.slice(0,1));base.customer='UBL';if(path.includes('/sources/'))base.site='Combined Survey Source';}
 else if(path.startsWith('/api/ubl/')){
  base.customer='UBL';const siteId=path.match(/\/sites\/(\d+)\//)?.[1];
  if(siteId){const s=(await pool.query('SELECT * FROM ubl_effective_site_orders WHERE site_id=$1',[siteId])).rows[0];if(s){base.site=s.site_name;base.siteCode=s.branch_code;base.reference=s.legacy_ipo_number?`CHP-${s.legacy_ipo_number}`:undefined;base.identity=`ubl-site:${siteId}`;}}
  else base.site=`Configuration ${path.split('/')[3]??''}`;
 }
 if(entity){
  const s=entity.snapshot??entity.inputs??entity.data??{},nested=s.order??s.boq??s.source??s;
  const customer=s.customer??nested.customer,site=s.site??nested.site;
  base.identity=`${entity.__download_namespace??'export'}:${entity.id??base.identity}`;base.reference=entity.number??base.reference;base.revision=entity.version??entity.draft_version??entity.revision;
  base.customer=base.customer??customer?.shortCode??customer?.short_code??customer?.name??s.customerName??nested.customerName??(typeof customer==='string'?customer:undefined);
  base.site=base.site??s.siteName??s.site_name??site?.name??nested.siteName??s.survey?.siteName??entity.site_name;
  base.siteCode=base.siteCode??s.siteCode??s.branchCode??nested.siteCode??s.survey?.siteCode??entity.site_code;
  const customerId=entity.customer_id??s.customerId??s.survey?.customerId??customer?.id??nested.survey?.customerId;
  if(!base.customer&&customerId!==undefined){const c=(await pool.query('SELECT short_code,name FROM customers WHERE id=$1',[customerId])).rows[0];base.customer=c?.short_code||c?.name;}
  if(!base.site&&Array.isArray(s.sites)){base.site=s.sites.length===1?s.sites[0].siteName??s.sites[0].site:`Combined ${s.sites.length} Sites`;const c=s.sites[0]?.customer;base.customer=base.customer??s.sites[0]?.customerCode??c?.shortCode??c?.name??(typeof c==='string'?c:undefined);base.siteCode=s.sites.length===1?s.sites[0].code:undefined;}
  if(!base.site&&entity.request_id){const parent=await row('ubl_workflow_requests',[entity.request_id]);base.site=parent?.site_name;base.siteCode=parent?.branch_code;}
  if(entity.__download_namespace==='survey_uploads'){
    const linked=(await pool.query('SELECT DISTINCT b.customer_id,s.name,s.code FROM boq_uploads u JOIN boq_revisions r ON r.id=u.revision_id JOIN boqs b ON b.id=r.boq_id JOIN sites s ON s.id=b.site_id WHERE u.upload_id=$1',[entity.id])).rows;
    if(linked.length){base.site=linked.length===1?linked[0].name:`Combined ${linked.length} Sites`;base.siteCode=linked.length===1?linked[0].code:undefined;const c=(await pool.query('SELECT short_code FROM customers WHERE id=$1',[linked[0].customer_id])).rows[0];base.customer=c?.short_code;}
    else{const receipt=(await pool.query('SELECT customer_id,snapshot FROM customer_headsup_receipts WHERE evidence_id=$1 ORDER BY created_at LIMIT 1',[entity.id])).rows[0];if(receipt){base.customer=(await pool.query('SELECT short_code FROM customers WHERE id=$1',[receipt.customer_id])).rows[0]?.short_code;base.site='Heads-up Sites';base.documentType='Heads-up Evidence';}}
  }
 }
 // Unknown context is explicit; never invent a customer/site from a long internal ID.
 if(!entity&&!ids.length&&originalName)base.identity=path+':'+originalName;
 return base;
}
/** One outbound boundary covers every business PDF/Excel export without altering its bytes. */
export function friendlyExportNames(pool:Pool):RequestHandler{return(req,res,next)=>{
 const send=res.send.bind(res);
 res.send=((body:any)=>{
  const disposition=String(res.getHeader('Content-Disposition')??'inline'),mime=String(res.getHeader('Content-Type')??'');
  const name=filenameFromDisposition(disposition)||'';
  if(!req.authSession||res.statusCode>=400||!Buffer.isBuffer(body)||req.originalUrl.startsWith('/api/backups')||!(/pdf|spreadsheet|excel|csv|wordprocessing|zip|image\/(png|jpeg|webp)/i.test(mime)||/\.(pdf|xlsx?|csv|docx|zip|png|jpe?g|webp)$/i.test(name))){return send(body);}
  const extension=/pdf/i.test(mime)?'pdf':/spreadsheet/.test(mime)?'xlsx':/excel/.test(mime)?'xls':/csv/.test(mime)?'csv':/wordprocessing/.test(mime)?'docx':/zip/.test(mime)?'zip':/image\//.test(mime)?mime.split('/')[1].split(';')[0].replace('jpeg','jpg'):name.split('.').at(-1)||'pdf';
  void (async()=>{
   const context=res.locals.downloadContext??await exportContext(pool,req,extension,name);
   const filename=await registeredDownloadName(pool,{...context,extension});
   const ascii=filename.replace(/[^\x20-\x7e]/g,'_');
   res.setHeader('Content-Disposition',`${disposition.startsWith('inline')?'inline':'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
   send(body);
  })().catch(error=>{res.removeHeader('Content-Disposition');res.removeHeader('Content-Length');res.removeHeader('Content-Type');next(error)});
  return res;
 }) as typeof res.send;
 next();
};}
