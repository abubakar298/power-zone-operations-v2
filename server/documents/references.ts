import type { PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
export const documentTypes = ["QT","BOQ","PBQ","IPO","DO","INV","PO","SSR","TS","SR","IR","CR","AMC"] as const;
export type DocumentType = typeof documentTypes[number];
export function formatReference(type:DocumentType,year:number,sequence:number,customerCode:number,siteNumber:number,shortId:string,siteCode:string) {
  return `CPZ-${type}-${String(year).slice(-2)}-${String(sequence).padStart(3,"0")}-${String(customerCode).padStart(4,"0")}-${String(siteNumber).padStart(3,"0")} (${shortId}-${siteCode})`;
}
/** Short running references (owner-approved 20 Nov 2026, Atif's documentation standard): QT-5411, BOQ-1003,
 * IPO-163. No company, year, customer or site in the number; those stay separate fields. One running series per
 * code that never restarts; it starts after the number of references of that kind issued before the release.
 * Costing (PBQ) and customer BOQs share the BOQ series. Issued references never change. */
const shortSeries:Partial<Record<DocumentType,"QT"|"BOQ"|"IPO">>={QT:"QT",BOQ:"BOQ",PBQ:"BOQ",IPO:"IPO"};
export const isShortReference=(reference:string)=>/^(QT|BOQ|IPO)-\d+(-R\d+)?$/.test(reference);
/** A number made by the portal (long CPZ- or short form), as opposed to a typed or legacy one. */
export const isPortalReference=(reference:string)=>reference.startsWith("CPZ-")||isShortReference(reference);
/** Quotation and C&I version numbers. Short form: the first version is the base (QT-5411), later ones
 * QT-5411-R1, -R2, so a revision never takes a new number. Older CPZ families keep -R1, -R2 from the first. */
export function versionReference(base:string,ordinal:number){
  if(!isShortReference(base))return revisedReference(base,ordinal);
  const root=base.replace(/-R\d+$/,"");
  return ordinal<=1?root:`${root}-R${ordinal-1}`;
}
export function revisedReference(reference:string,revision:number) {
  if(isShortReference(reference)) return `${reference.replace(/-R\d+$/,"")}-R${revision}`;
  if(reference.startsWith("CPZ-")) return reference.replace(/(?:-R\d+)?( \([^)]*\))$/,`-R${revision}$1`);
  return reference.replace(/-(?:R|V)\d+$/,`-R${revision}`);
}
/** Must run inside the caller's business transaction; retries reuse the same root. */
export async function allocateReference(c:PoolClient,type:DocumentType,familyId:string,customerId:number,siteCode:string) {
  if(!documentTypes.includes(type)||!siteCode.trim())throw new HttpError(400,"A site code is required for document numbering.");
  await c.query("SELECT pg_advisory_xact_lock(742019040)");
  const prior=(await c.query("SELECT reference FROM document_reference_roots WHERE document_type=$1 AND family_id=$2 UNION ALL SELECT reference FROM document_reference_aliases WHERE document_type=$1 AND family_id=$2",[type,familyId])).rows[0];
  if(prior)return prior.reference as string;
  const customer=(await c.query("SELECT id,short_code FROM customers WHERE id=$1",[customerId])).rows[0];
  if(!customer)throw new HttpError(400,"Customer not found for document numbering.");
  const normalized=siteCode.trim().toLowerCase();
  await c.query(`INSERT INTO document_site_identities(customer_id,site_code,site_number)
    SELECT $1,$2,COALESCE(max(site_number),0)+1 FROM document_site_identities WHERE customer_id=$1
    ON CONFLICT(customer_id,site_code) DO NOTHING`,[customerId,normalized]);
  const site=(await c.query("SELECT site_number FROM document_site_identities WHERE customer_id=$1 AND site_code=$2",[customerId,normalized])).rows[0];
  const series=shortSeries[type];
  if(series){
    const reference=await nextShortReference(c,series);
    await c.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES($1,$2,$3)",[type,familyId,reference]);
    return reference;
  }
  const year=Number((await c.query("SELECT extract(year FROM now() AT TIME ZONE 'Asia/Karachi')::integer AS year")).rows[0].year);
  const seq=(await c.query(`INSERT INTO document_sequences(document_type,calendar_year,last_value) VALUES($1,$2,1)
    ON CONFLICT(document_type,calendar_year) DO UPDATE SET last_value=document_sequences.last_value+1 RETURNING last_value`,[type,year])).rows[0].last_value;
  const reference=formatReference(type,year,seq,customer.id,site.site_number,customer.short_code,siteCode.trim());
  await c.query("INSERT INTO document_reference_roots(document_type,family_id,reference) VALUES($1,$2,$3)",[type,familyId,reference]);
  return reference;
}
/** Next number of a short series. Year 0 in document_sequences is the running (never restarting) counter; it is
 * seeded once with the count of references of that kind issued before. A number already taken (for example a
 * typed IPO number) is skipped. Runs under the caller's numbering lock. */
async function nextShortReference(c:PoolClient,series:"QT"|"BOQ"|"IPO"){
  const types=Object.entries(shortSeries).filter(([,s])=>s===series).map(([type])=>type);
  for(;;){
    let value:number;
    if((await c.query("SELECT 1 FROM document_sequences WHERE document_type=$1 AND calendar_year=0",[series])).rowCount){
      value=Number((await c.query("UPDATE document_sequences SET last_value=last_value+1 WHERE document_type=$1 AND calendar_year=0 RETURNING last_value",[series])).rows[0].last_value);
    }else{
      value=Number((await c.query("SELECT count(*)::integer AS n FROM document_reference_roots WHERE document_type=ANY($1::text[])",[types])).rows[0].n)+1;
      await c.query("INSERT INTO document_sequences(document_type,calendar_year,last_value) VALUES($1,0,$2)",[series,value]);
    }
    const reference=`${series}-${value}`;
    if(!(await c.query("SELECT 1 FROM document_reference_roots WHERE lower(reference)=lower($1)",[reference])).rowCount)return reference;
  }
}
/** The root reference already given to a document family, or null (never allocates). */
export async function familyReference(c:PoolClient,type:DocumentType,familyId:string){
  return ((await c.query("SELECT reference FROM document_reference_roots WHERE document_type=$1 AND family_id=$2",[type,familyId])).rows[0]?.reference as string|undefined)??null;
}
export async function boqIdentity(c:PoolClient,revisionId:string) {
 const row=(await c.query("SELECT b.id AS family_id,b.customer_id,s.code AS site_code FROM boq_revisions r JOIN boqs b ON b.id=r.boq_id JOIN sites s ON s.id=b.site_id WHERE r.id=$1",[revisionId])).rows[0];
 if(!row)throw new HttpError(404,"BOQ identity not found.");return row;
}
