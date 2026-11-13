import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {HttpError} from '../http/errors.js';

type Db=Pool|PoolClient;
const uuid=(v:unknown)=>z.uuid().safeParse(v).success?String(v):undefined;

/** View-only BOQ details are granted per account (migration 306; Moaz only, 13 Nov 2026). */
export async function isBoqViewer(c:Db,actor:string){
 return Boolean((await c.query('SELECT 1 FROM operations_boq_viewers v JOIN users u ON u.id=v.user_id AND u.active WHERE v.user_id=$1',[actor])).rowCount);
}

/** The BOQ copy issued to Operations for this site: items and quantities only, never
 * rates, costs or prices. The caller has already checked the site is in the actor's scope. */
export async function siteBoqDetails(c:Db,actor:string,siteId:string,site:Record<string,any>){
 if(!await isBoqViewer(c,actor))throw new HttpError(403,'BOQ details are not available for this account.');
 const refs=site.legacySourceReferences??{};
 let ipoId=uuid(site.origin?.ipoId)??uuid(refs.ipoId);
 if(!ipoId){
  // Same rule as Accounts invoicing: one explicit material-source link, else none.
  const links=(await c.query('SELECT DISTINCT ipo_id FROM inventory_material_source_links WHERE board_site_id=$1',[siteId])).rows;
  if(links.length===1)ipoId=uuid(links[0].ipo_id);
 }
 const issuanceId=uuid(site.origin?.operationsIssuanceId)??uuid(refs.operationsIssuanceId);
 const row=ipoId||issuanceId?(await c.query(`SELECT o.number,o.created_at,o.snapshot,i.number AS ipo_number FROM operations_boq_issuances o JOIN internal_purchase_orders i ON i.id=o.ipo_id
  WHERE ($1::uuid IS NOT NULL AND o.ipo_id=$1::uuid) OR ($1::uuid IS NULL AND o.id=$2::uuid) ORDER BY o.created_at DESC,o.id DESC LIMIT 1`,[ipoId??null,issuanceId??null])).rows[0]:undefined;
 if(!row)return {linked:false as const};
 const s=row.snapshot??{};
 return {linked:true as const,issuanceNumber:row.number,issuedAt:new Date(row.created_at).toISOString(),ipoNumber:row.ipo_number,boqNumber:s.boqNumber??null,siteName:s.siteName??site.name??'',siteCode:s.siteCode??null,
  // Whitelisted fields only.
  items:(Array.isArray(s.items)?s.items:[]).map((l:any)=>({description:String(l.description??l.key??''),brand:l.brand??null,specification:l.specification??null,qty:l.qty==null?null:String(l.qty),unit:l.unit??null}))};
}
