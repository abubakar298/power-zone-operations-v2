import type {Pool,PoolClient} from 'pg';
/** Resolve an explicitly registered original order without changing its immutable import,
 * creating another IPO, demanding stock or claiming a new technical survey occurred. */
export async function historicalApprovedOrder(db:Pool|PoolClient,siteId:string){
 const original=(await db.query('SELECT * FROM ubl_effective_site_orders WHERE site_id=$1',[siteId])).rows[0];
 if(original?.baseline&&original.status==='Active')return original;
 if(original?.status!=='Awaiting revised PO')return null;
 const saved=(await db.query("SELECT d.snapshot FROM ubl_workflow_requests r JOIN LATERAL(SELECT snapshot FROM ubl_workflow_documents WHERE request_id=r.id AND kind='Historical approved order' ORDER BY version DESC LIMIT 1)d ON true WHERE r.site_id=$1 AND r.stage='Existing order—Revised PO recorded' AND r.data->>'historicalOrderVerified'='true' AND r.data->>'originalOrderPreserved'='true'",[siteId])).rows;
 if(saved.length!==1)return null;
 const s={...saved[0].snapshot.site,baseline:saved[0].snapshot.baseline};
 if(!s?.baseline||String(s.legacy_ipo_number)!==String(original.legacy_ipo_number))return null;
 return {...original,...s,historicalOrder:true};
}
