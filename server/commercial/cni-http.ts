import { allocateReference, revisedReference } from "../documents/references.js";
import { snapshotCniCost, reviewCni } from "./cni-costing.js";
import { Router, type RequestHandler } from "express";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { requireOwnedResource, managementOnly } from "../http/permissions.js";
import { priceCni, cniPolicy } from "./cni-policy.js";
import { buildCniPdf } from "./cni-report.js";
const schema=z.object({
 customerId:z.number().int().nonnegative(), siteName:z.string().trim().min(1).max(200),
 siteCode:z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
 quantity:z.number().int().min(1).max(1000), presentation:z.enum(["Inclusive","Separate"]),
 discount:z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).default("0"),
 validityDays:z.number().int().min(1).max(90).default(7),
 proposalId:z.uuid().optional(), expectedVersion:z.number().int().positive().optional(),
}).strict();
export function cniHttp(pool:Pool,requireSession:RequestHandler) {
 const r=Router();r.use(requireSession);
 r.use((req,_res,next)=>{if(req.method!=="GET"&&!equalSecrets(req.get("X-CSRF-Token")??"",req.authSession!.csrfToken)) throw new HttpError(403,"Refresh and try again.");next();});
 const parse=<T>(s:z.ZodType<T>,v:unknown)=>{const p=s.safeParse(v);if(!p.success)throw new HttpError(400,p.error.issues[0].message);return p.data;};
 const own=async(req:any,id:string)=>{if(req.authSession.user.role==="Coordinator") await requireOwnedResource(pool,req.authSession.user.id,"cni",id);};
 r.get("/",async(req,res)=>{
  const actor=req.authSession!.user;
  const rows=await pool.query(`SELECT p.id,p.customer_id,v.id AS version_id,v.version,v.number,v.snapshot,v.created_at,
   (SELECT action FROM cni_proposal_actions WHERE version_id=v.id ORDER BY created_at DESC,id DESC LIMIT 1) AS action
   FROM cni_proposals p JOIN LATERAL (SELECT * FROM cni_proposal_versions WHERE proposal_id=p.id ORDER BY version DESC LIMIT 1) v ON true
   WHERE ($1::boolean OR p.created_by=$2) ORDER BY v.created_at DESC`,[actor.role!=="Coordinator",actor.id]);
  res.json({proposals:rows.rows,policy:cniPolicy});
 });
 r.get("/:id",async(req,res)=>{
  const id=parse(z.uuid(),req.params.id);await own(req,id);
  const versions=await pool.query("SELECT id,proposal_id,version,number,snapshot,created_by,created_at FROM cni_proposal_versions WHERE proposal_id=$1 ORDER BY version DESC",[id]);
  if(!versions.rowCount)throw new HttpError(404,"Proposal not found.");
  const actions=await pool.query("SELECT a.* FROM cni_proposal_actions a JOIN cni_proposal_versions v ON v.id=a.version_id WHERE v.proposal_id=$1 ORDER BY a.created_at",[id]);
  res.json({id,versions:versions.rows,actions:actions.rows});
 });
 r.post("/",async(req,res)=>{
  const v=parse(schema,req.body);const actor=req.authSession!.user;
  if(v.proposalId)await own(req,v.proposalId);
  let pricing;try {pricing=priceCni({quantity:v.quantity,discount:v.discount,presentation:v.presentation,taxRate:cniPolicy.taxRate});}catch(e){throw new HttpError(400,(e as Error).message);}
  const client=await pool.connect();
  try {
   await client.query("BEGIN");
   const customer=await client.query("SELECT id,name,short_code,contact_person,phone,email,address,city,province FROM customers WHERE id=$1 AND status='Active'",[v.customerId]);
   if(!customer.rowCount)throw new HttpError(400,"Select an active customer.");
   const id=v.proposalId??randomUUID();let version=1;
   if(v.proposalId){
    const existing=await client.query("SELECT * FROM cni_proposals WHERE id=$1 FOR UPDATE",[id]);
    if(!existing.rowCount)throw new HttpError(404,"Proposal not found.");
    if(existing.rows[0].customer_id!==v.customerId)throw new HttpError(400,"Revisions must retain the original customer.");
    const last=await client.query("SELECT max(version) AS version FROM cni_proposal_versions WHERE proposal_id=$1",[id]);
    if(last.rows[0].version!==v.expectedVersion)throw new HttpError(409,"This proposal changed. Reload before revising.");
    version=Number(last.rows[0].version)+1;
   } else await client.query("INSERT INTO cni_proposals(id,created_by,customer_id) VALUES($1,$2,$3)",[id,actor.id,v.customerId]);
   const prior=v.proposalId?(await client.query("SELECT number,snapshot FROM cni_proposal_versions WHERE proposal_id=$1 ORDER BY version DESC LIMIT 1",[id])).rows[0]:undefined;
   const siteCode=v.siteCode??prior?.snapshot.siteCode;
   if(!siteCode)throw new HttpError(400,"Enter the site code for this proposal.");
   if(prior?.snapshot.siteCode&&prior.snapshot.siteCode!==siteCode)throw new HttpError(400,"Revision site identity cannot change.");
   const versionId=randomUUID(),number=prior&&!prior.number.startsWith("CPZ-")?`CNI-${id.slice(0,8).toUpperCase()}-V${version}`:revisedReference(await allocateReference(client,"QT",id,v.customerId,siteCode),version);
   const snapshot={customer:customer.rows[0],siteName:v.siteName,siteCode,pricing,validityDays:v.validityDays,preparedBy:actor.display_name,issuedDate:new Date().toISOString(),pdfTemplate:"PHOTON-APPROVED-1"};
   await client.query("INSERT INTO cni_proposal_versions(id,proposal_id,version,number,snapshot,internal_cost_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[versionId,id,version,number,snapshot,snapshotCniCost(v.quantity),actor.id]);
   await client.query("INSERT INTO cni_proposal_actions(id,version_id,action,created_by) VALUES($1,$2,'Approval requested',$3)",[randomUUID(),versionId,actor.id]);
   await client.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)",[actor.id,`C&I ${number}: quotation approval requested`]);
   await client.query("COMMIT");res.status(201).json({id,versionId,number,version,snapshot});
  } catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 });
 r.get("/:id/financial-review",managementOnly,async(req,res)=>{
  const id=parse(z.uuid(),req.params.id);
  const row=await pool.query("SELECT id,snapshot,internal_cost_snapshot FROM cni_proposal_versions WHERE proposal_id=$1 ORDER BY version DESC LIMIT 1",[id]);
  if(!row.rowCount)throw new HttpError(404,"Proposal not found.");
  if(req.query.versionId&&parse(z.uuid(),req.query.versionId)!==row.rows[0].id)throw new HttpError(409,"Proposal changed. Reload the review.");
  res.json(reviewCni(row.rows[0].snapshot.pricing,row.rows[0].internal_cost_snapshot));
 });
 r.post("/:id/financial-preview",managementOnly,async(req,res)=>{
  const id=parse(z.uuid(),req.params.id);
  const adjustment=parse(z.union([z.object({versionId:z.uuid().optional(),discount:z.string().regex(/^\d{1,14}(\.\d{1,2})?$/)}).strict(),z.object({versionId:z.uuid().optional(),targetMarkup:z.string().regex(/^\d{1,3}(\.\d{1,2})?$/)}).strict()]),req.body);
  const row=await pool.query("SELECT id,snapshot,internal_cost_snapshot FROM cni_proposal_versions WHERE proposal_id=$1 ORDER BY version DESC LIMIT 1",[id]);
  if(!row.rowCount)throw new HttpError(404,"Proposal not found.");
  if(adjustment.versionId&&adjustment.versionId!==row.rows[0].id)throw new HttpError(409,"Proposal changed. Reload the review.");
  try{res.json(reviewCni(row.rows[0].snapshot.pricing,row.rows[0].internal_cost_snapshot,adjustment));}catch(e){throw new HttpError(400,(e as Error).message);}
 });
 r.post("/:id/review",managementOnly,async(req,res)=>{
  const id=parse(z.uuid(),req.params.id);
  const v=parse(z.object({versionId:z.uuid(),action:z.enum(["Approved","Revision requested"]),remarks:z.string().trim().max(2000),recommendedDiscount:z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).optional()}).strict(),req.body);
  if(v.action==="Revision requested"&&!v.remarks)throw new HttpError(400,"Enter revision instructions.");
  const client=await pool.connect();try{
   await client.query("BEGIN");await client.query("SELECT id FROM cni_proposals WHERE id=$1 FOR UPDATE",[id]);
   const latest=await client.query("SELECT * FROM cni_proposal_versions WHERE proposal_id=$1 ORDER BY version DESC LIMIT 1",[id]);
   if(latest.rows[0]?.id!==v.versionId)throw new HttpError(409,"Only the latest proposal can be reviewed.");
   const action=await client.query("SELECT action FROM cni_proposal_actions WHERE version_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[v.versionId]);
   if(action.rows[0]?.action!=="Approval requested")throw new HttpError(409,"This proposal is not awaiting quotation approval.");
   const instructions=v.recommendedDiscount===undefined?{}:{recommendedDiscount:reviewCni(latest.rows[0].snapshot.pricing,latest.rows[0].internal_cost_snapshot,{discount:v.recommendedDiscount}).recommendedDiscount};
   if(v.action==="Approved"&&v.recommendedDiscount!==undefined&&v.recommendedDiscount!==latest.rows[0].snapshot.pricing.discount){
    const prior=latest.rows[0],snapshot={...prior.snapshot,pdfTemplate:"PHOTON-APPROVED-1",pricing:priceCni({quantity:prior.snapshot.pricing.quantity,presentation:prior.snapshot.pricing.presentation,taxRate:prior.snapshot.pricing.taxRate,discount:v.recommendedDiscount})};
    const nextId=randomUUID(),version=prior.version+1,number=prior.number.startsWith("CPZ-")?revisedReference(prior.number,version):prior.number.replace(/-V\d+$/,`-V${version}`);
    await client.query("INSERT INTO cni_proposal_actions(id,version_id,action,remarks,instructions,created_by) VALUES($1,$2,'Revision requested',$3,$4,$5)",[randomUUID(),v.versionId,"Management created adjusted quotation",instructions,req.authSession!.user.id]);
    await client.query("INSERT INTO cni_proposal_versions(id,proposal_id,version,number,snapshot,internal_cost_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[nextId,id,version,number,snapshot,prior.internal_cost_snapshot,req.authSession!.user.id]);
    await client.query("INSERT INTO cni_proposal_actions(id,version_id,action,remarks,instructions,created_by) VALUES($1,$2,'Approved',$3,$4,$5)",[randomUUID(),nextId,v.remarks,instructions,req.authSession!.user.id]);
    await client.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)",[req.authSession!.user.id,`C&I ${number}: Management created and approved adjusted quotation`]);
    await client.query("COMMIT");res.json({ok:true,versionId:nextId});return;
   }
   await client.query("INSERT INTO cni_proposal_actions(id,version_id,action,remarks,instructions,created_by) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),v.versionId,v.action,v.remarks,instructions,req.authSession!.user.id]);
   await client.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)",[req.authSession!.user.id,`C&I ${latest.rows[0].number}: ${v.action}`]);
   await client.query("COMMIT");res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 });
 r.get("/:id/versions/:versionId/proposal.pdf",async(req,res)=>{
  const id=parse(z.uuid(),req.params.id),versionId=parse(z.uuid(),req.params.versionId);await own(req,id);
  const row=await pool.query("SELECT * FROM cni_proposal_versions WHERE id=$1 AND proposal_id=$2",[versionId,id]);
  if(!row.rowCount)throw new HttpError(404,"Proposal not found.");
  const action=await pool.query("SELECT action FROM cni_proposal_actions WHERE version_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[versionId]);
  const s=row.rows[0].snapshot;
  const draft=action.rows[0]?.action!=="Approved";
  res.type("application/pdf").set("Content-Disposition",`inline; filename="${row.rows[0].number}${draft?'-DRAFT':''}.pdf"`).send(buildCniPdf(s,row.rows[0].number,draft));
 });
 return r;
}
