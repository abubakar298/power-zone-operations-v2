export type SolarSite={site_id:number|string;site_name:string;branch_code?:string;configuration_id?:string;legacy_ipo_number?:string|number;po_number?:string|null;po_issued_date?:string|null;status:string;new_workflow_ipo_id?:string;irr_review_flags?:string[]};
export type SolarCheckpoint={key:string;operation?:{installationStatus?:string;solarDelivery?:string;equipmentDelivery?:string;startDate?:string;completionDate?:string};flags?:string[]};
export function solarDashboardRows(sites:SolarSite[],checkpoints:SolarCheckpoint[]){
 const seen=new Set<string>();
 return sites.filter(s=>{const key=String(s.site_id);if(seen.has(key))return false;seen.add(key);return true;}).map(s=>{
  const key=s.new_workflow_ipo_id?`ipo:${s.new_workflow_ipo_id}`:`ubl:${s.site_id}`;
  const checkpoint=checkpoints.find(c=>c.key===key),op=checkpoint?.operation;
  const cancelled=s.status==='Cancelled',awaitingRevision=s.status==='Awaiting revised PO';
  const received=Boolean(s.po_number?.trim()),active=s.status==='Active'&&received;
  const installed=active&&op?.installationStatus==='Installation completed';
  const hasDate=(value:string|undefined)=>Boolean(value&&/^\d{4}-\d{2}-\d{2}$/.test(value));
  const delivered=active&&(installed||hasDate(op?.solarDelivery)&&hasDate(op?.equipmentDelivery));
  const flags=[...new Set([...(s.irr_review_flags??[]),...(checkpoint?.flags??[])].filter(f=>typeof f==='string'&&f.trim()))];
  if(awaitingRevision)flags.push('Revised PO awaited');
  const ipo=String(s.legacy_ipo_number??'');
  return{key,site:s.site_name.replace(/^UBL\s+/i,''),branch:s.branch_code??'',configuration:s.configuration_id??'',ipo:/^\d+$/.test(ipo)?`CHP-${ipo}`:ipo,po:s.po_number??'',poDate:s.po_issued_date??'',status:s.status,received,active,cancelled,awaitingRevision,installed,delivered,partialDelivery:active&&!delivered&&(hasDate(op?.solarDelivery)||hasDate(op?.equipmentDelivery)),installationStatus:op?.installationStatus??'Awaiting data',solarDelivery:op?.solarDelivery??'',equipmentDelivery:op?.equipmentDelivery??'',startDate:op?.startDate??'',completionDate:op?.completionDate??'',flags};
 });
}
export type SolarDashboardRow=ReturnType<typeof solarDashboardRows>[number];
export function solarDashboardSummary(rows:SolarDashboardRow[]){return{registered:rows.length,received:rows.filter(r=>r.received).length,active:rows.filter(r=>r.active).length,installed:rows.filter(r=>r.installed).length,deliveryUnconfirmed:rows.filter(r=>r.active&&!r.delivered).length,flagged:rows.filter(r=>r.flags.length>0).length,cancelled:rows.filter(r=>r.cancelled).length,awaitingRevision:rows.filter(r=>r.awaitingRevision).length};}
