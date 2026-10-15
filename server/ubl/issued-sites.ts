import type {Pool} from 'pg';
import {Decimal} from 'decimal.js';
import {OrdersRepository} from '../orders/repository.js';

/** One register over original UBL links and immutable new-workflow issuances. */
export async function issuedUblSites(pool:Pool,legacy:any[]){
 const issued=(await pool.query(`SELECT w.record_id,w.ipo_id,r.site_id,r.site_name,r.region,r.framework_id,s.code,p.reference,p.input,p.basis,p.created_at,i.number,i.snapshot FROM project_workflow_issuances w JOIN project_workflow_records r ON r.id=w.record_id JOIN customers c ON c.id=r.customer_id JOIN sites s ON s.id=r.site_id JOIN project_po_receipts p ON p.id=w.receipt_id JOIN internal_purchase_orders i ON i.id=w.ipo_id WHERE (r.data->>'localPreviewArchived') IS DISTINCT FROM 'true' AND upper(c.short_code)='UBL' AND p.basis->'order'->>'source'='Approved pre-agreed configuration' AND p.basis->'boq'->'survey'->>'family' IS DISTINCT FROM 'bess-only' ORDER BY p.created_at,w.record_id`)).rows;
 const knownSites=new Set(legacy.map(r=>r.site_id)),knownPos=new Set(legacy.map(r=>r.po_number)),knownIpos=new Set(legacy.map(r=>String(r.legacy_ipo_number).replace(/^CHP-/i,'')));
 const result=[];
 for(const r of issued){
  if(knownSites.has(r.site_id)||knownPos.has(r.reference)||knownIpos.has(String(r.number).replace(/^CHP-/i,'')))continue;
  const order=await new OrdersRepository(pool).get(r.ipo_id),s=order.snapshot,b=r.basis.boq;
  const gross=new Decimal(s.allocation.total),net=new Decimal(s.allocation.subtotal),cost=new Decimal(b.total),markup=net.minus(cost);
  const configuration=String(s.frameworkKey??r.basis.source?.key??'').match(/(?:20-20-30|25-20-30|30-30-40|35-30-40)/)?.[0];
  if(!configuration)continue;
  result.push({site_id:r.site_id,source_row:null,branch_code:s.siteCode,site_name:r.site_name,region:r.region,main_city:r.region,configuration_id:configuration,pricing_stage:'Revised',po_number:r.reference,po_issued_date:r.input.date,legacy_ipo_number:r.number,status:'Active',new_workflow_ipo_id:r.ipo_id,workflow_record_id:r.record_id,document_version:null,notes:'Issued through the approved PO journey. Selling values and cost basis are frozen at issuance.',source:{url:`/api/project-workflow/${r.record_id}/files/${s.input.workflowEvidenceId}`},baseline:{configuration,sellingIncludingGst:gross.toFixed(2),sellingExcludingGst:net.toFixed(2),budgetedCost:cost.toFixed(2),markupAmount:markup.toFixed(2),markupPercent:cost.gt(0)?markup.div(cost).mul(100).toFixed(2):'0',panelRate:b.lines.find((l:any)=>l.phase==='Solar Panels')?.rate??'Not entered',costBasis:'Saved approved BOQ at issuance; existing rates/history unchanged.',items:b.lines.map((l:any)=>({item:l.specification||l.description||l.itemId||l.key,quantity:l.qty,unit:l.unit,buying_rate_ex_gst:l.rate??'0',total_ex_gst:l.total}))},irr_review_flags:[]});
  knownSites.add(r.site_id);knownPos.add(r.reference);knownIpos.add(String(r.number).replace(/^CHP-/i,''));
 }
 return result;
}
