type DeliverySite={id:string;stage:string;completed?:boolean;cancelled?:boolean;transferred?:boolean;superseded?:boolean;operationsTeam?:string|null;planningBatches?:{team?:string;kind?:string;deliveryDate?:string;cancelled?:boolean;stops:{siteId:string;kind?:string;cancelled?:boolean}[]}[]};
const validDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
/** A current saved delivery stop is a dispatch plan; vendor assignment is not
 * a second prerequisite after the same job has already been scheduled in a batch.
 * This is eligibility only: no status/date/evidence or record is inferred. */
export function canRecordSiteDelivery(site:DeliverySite){
 if(site.completed||site.cancelled||site.transferred||site.superseded)return false;
 if(site.stage==='awaiting')return true; // Preserve the individual dispatch workflow.
 if(site.stage!=='received')return false;
 return (site.planningBatches??[]).some(batch=>{
  if(batch.cancelled||!validDate(batch.deliveryDate)||batch.team&&batch.team!==site.operationsTeam)return false;
  const stop=batch.stops.find(stop=>stop.siteId===site.id);
  return !!stop&&!stop.cancelled&&['delivery','both'].includes(stop.kind??batch.kind??'');
 });
}
