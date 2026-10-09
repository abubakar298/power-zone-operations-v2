import type { PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
export const documentTypes = ["QT","BOQ","IPO","DO","INV","PO","SSR","TS","SR","IR","CR","AMC"] as const;
export type DocumentType = typeof documentTypes[number];
export function formatReference(type:DocumentType,year:number,sequence:number,customerCode:number,siteNumber:number,shortId:string,siteCode:string) {
  return `CPZ-${type}-${String(year).slice(-2)}-${String(sequence).padStart(3,"0")}-${String(customerCode).padStart(4,"0")}-${String(siteNumber).padStart(3,"0")} (${shortId}-${siteCode})`;
}
export function revisedReference(reference:string,revision:number) {
  if(reference.startsWith("CPZ-")) return reference.replace(/(?:-R\d+)?( \([^)]*\))$/,`-R${revision}$1`);
  return reference.replace(/-(?:R|V)\d+$/,`-R${revision}`);
}
/** Must run inside the caller's business transaction; retries reuse the same root. */
export async function allocateReference(c:PoolClient,type:DocumentType,familyId:string,customerId:number,siteCode:string) {
  if(!documentTypes.includes(type)||!siteCode.trim())throw new HttpError(400,"A site code is required for document numbering.");
  await c.query("SELECT pg_advisory_xact_lock(742019040)");
  const prior=(await c.query("SELECT reference FROM document_reference_roots WHERE document_type=$1 AND family_id=$2",[type,familyId])).rows[0];
  if(prior)return prior.reference as string;
  const customer=(await c.query("SELECT id,short_code FROM customers WHERE id=$1",[customerId])).rows[0];
  if(!customer)throw new HttpError(400,"Customer not found for document numbering.");
  const normalized=siteCode.trim().toLowerCase();
  await c.query(`INSERT INTO document_site_identities(customer_id,site_code,site_number)
    SELECT $1,$2,COALESCE(max(site_number),0)+1 FROM document_site_identities WHERE customer_id=$1
    ON CONFLICT(customer_id,site_code) DO NOTHING`,[customerId,normalized]);
  const site=(await c.query("SELECT site_number FROM document_site_identities WHERE customer_id=$1 AND site_code=$2",[customerId,normalized])).rows[0];
  const year=Number((await c.query("SELECT extract(year FROM now() AT TIME ZONE 'Asia/Karachi')::integer AS year")).rows[0].year);
  const seq=(await c.query(`INSERT INTO document_sequences(document_type,calendar_year,last_value) VALUES($1,$2,1)
    ON CONFLICT(document_type,calendar_year) DO UPDATE SET last_value=document_sequences.last_value+1 RETURNING last_value`,[type,year])).rows[0].last_value;
  const reference=formatReference(type,year,seq,customer.id,site.site_number,customer.short_code,siteCode.trim());
  await c.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES($1,$2,$3)",[type,familyId,reference]);
  return reference;
}
export async function boqIdentity(c:PoolClient,revisionId:string) {
 const row=(await c.query("SELECT b.id AS family_id,b.customer_id,s.code AS site_code FROM boq_revisions r JOIN boqs b ON b.id=r.boq_id JOIN sites s ON s.id=b.site_id WHERE r.id=$1",[revisionId])).rows[0];
 if(!row)throw new HttpError(404,"BOQ identity not found.");return row;
}
