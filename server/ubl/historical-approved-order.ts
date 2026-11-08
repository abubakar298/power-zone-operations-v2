import type {Pool,PoolClient} from 'pg';
/** Overlay only exact, verified historical orders; original imported rows stay immutable. */
export async function resolvedHistoricalOrderRows(db:Pool|PoolClient,rows:any[]){
 const pending=rows.filter(r=>r.status==='Awaiting revised PO');
 if(!pending.length)return rows;
 const saved=(await db.query("SELECT r.site_id,d.snapshot FROM ubl_workflow_requests r JOIN LATERAL(SELECT snapshot FROM ubl_workflow_documents WHERE request_id=r.id AND kind='Historical approved order' ORDER BY version DESC LIMIT 1)d ON true WHERE r.site_id=ANY($1::integer[]) AND r.stage='Existing order—Revised PO recorded' AND r.data->>'historicalOrderVerified'='true' AND r.data->>'originalOrderPreserved'='true'",[pending.map(r=>r.site_id)])).rows;
 return rows.map(original=>{
  if(original.status!=='Awaiting revised PO')return original;
  const matches=saved.filter(r=>String(r.site_id)===String(original.site_id));
  if(matches.length!==1)return original;
  const s={...matches[0].snapshot.site,baseline:matches[0].snapshot.baseline};
  if(!s.baseline||String(s.legacy_ipo_number)!==String(original.legacy_ipo_number))return original;
  return {...original,...s,historicalOrder:true};
 });
}
/** Resolve an explicitly registered original order without changing its immutable import,
 * creating another IPO, demanding stock or claiming a new technical survey occurred. */
export async function historicalApprovedOrder(db:Pool|PoolClient,siteId:string){
 const original=(await db.query('SELECT * FROM ubl_effective_site_orders WHERE site_id=$1',[siteId])).rows[0];
 if(original?.baseline&&original.status==='Active')return original;
 if(original?.status!=='Awaiting revised PO')return null;
 const [resolved]=await resolvedHistoricalOrderRows(db,[original]);
 return resolved.historicalOrder?resolved:null;
}
