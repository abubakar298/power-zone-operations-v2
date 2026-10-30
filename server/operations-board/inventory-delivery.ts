import type {Pool,PoolClient} from 'pg';
type Row={site_id:string;version:number;snapshot:any};
export type InventoryReceiving={dispatchId:string;number:string;evidenceId:string;name:string;mediaType:string;receivedAt:string;partial:boolean;sites:any[]};
/** Customer receipt is delivery evidence. A gate signature proves warehouse OUT
 * only. Identity uses registered site/IPO IDs, never names or shared PO labels.
 * This is a projection: do not invent delivery/QC dates or edit source history. */
export function projectInventoryReceiving(rows:Row[],receivings:InventoryReceiving[]):Row[]{
 return rows.map(row=>{
  const s=row.snapshot;
  const matches=(site:any)=>site.registeredSiteId?site.registeredSiteId===row.site_id:!!s.origin?.ipoId&&site.siteId===s.origin.ipoId&&rows.filter(other=>other.snapshot.origin?.ipoId===site.siteId&&!other.snapshot.superseded).length===1;
  const lastReturn=s.deliveryReturns?.at(-1)?.recordedAt;
  const proof=receivings.filter(r=>!r.partial&&r.sites.length===1&&matches(r.sites[0])&&(!lastReturn||r.receivedAt>lastReturn)).sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)).at(-1);
  if(!proof||s.superseded){if(!s.inventoryReceiving)return row;const {inventoryReceiving,...snapshot}=s;return {...row,snapshot};}
  return {...row,snapshot:{...s,stage:s.completed===true||s.stage==='completed'?s.stage:'delivered',completed:s.completed===true||s.installation===false,inventoryReceiving:{dispatchId:proof.dispatchId,number:proof.number,evidenceId:proof.evidenceId,name:proof.name,mediaType:proof.mediaType,receivedAt:proof.receivedAt}}};
 });
}
export async function withInventoryReceiving(c:Pool|PoolClient,rows:Row[]):Promise<Row[]>{
 if(!rows.length)return rows;
 const ids=rows.map(r=>r.site_id),ipos=rows.map(r=>r.snapshot.origin?.ipoId).filter(Boolean);
 const copies=(await c.query(`SELECT d.id AS "dispatchId",d.number,e.id AS "evidenceId",e.original_name AS name,e.media_type AS "mediaType",c.created_at AS "receivedAt",coalesce((d.snapshot->>'partialDelivery')::boolean,false) AS partial,d.snapshot->'sites' AS sites
 FROM inventory_gate_pass_copies c JOIN inventory_material_dispatches_active d ON d.id=c.document_id
 JOIN inventory_material_evidence e ON e.id=c.evidence_id AND e.warehouse=c.warehouse
 WHERE c.document_kind='dispatch' AND c.copy_kind='signed-customer' AND coalesce((d.snapshot->>'parent')::boolean,false)=false AND d.snapshot->>'kind'='fixed'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.snapshot->'sites') s WHERE s->>'registeredSiteId'=ANY($1::text[]) OR s->>'siteId'=ANY($2::text[]))`,[ids,ipos])).rows;
 return projectInventoryReceiving(rows,copies.map(r=>({...r,receivedAt:new Date(r.receivedAt).toISOString()})));
}
