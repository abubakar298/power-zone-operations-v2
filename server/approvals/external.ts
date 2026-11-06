import { z } from "zod";
import type { PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
export const externalEvidenceObject = z
  .object({
    channel: z.enum(["WhatsApp", "Verbal"]).default("WhatsApp"),
    approver: z.string().trim().min(1).max(100),
    comments: z.string().trim().min(1).max(2000),
    evidenceIds: z
      .array(z.uuid())
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length),
    confirmed: z.literal(true),
    decisionAt:z.iso.datetime({offset:true}).optional(),
  })
  .strict();
export const externalEvidenceSchema = externalEvidenceObject.refine(
  (v) => v.channel === "Verbal" || v.evidenceIds.length > 0,
  { message: "Attach WhatsApp approval screenshots." },
);
export type ExternalEvidence = z.infer<typeof externalEvidenceSchema>;
export async function validateExternal(
  c: PoolClient,
  actor: string,
  owner: string,
  evidence: ExternalEvidence,
) {
  const user = (
    await c.query("SELECT role,display_name,email FROM users WHERE id=$1 AND active FOR SHARE", [
      actor,
    ])
  ).rows[0];
  if (
    !user ||
    !["Admin", "Management", "Coordinator"].includes(user.role) ||
    (user.role === "Coordinator" && owner !== actor)
  )
    throw new HttpError(
      403,
      "Record approval only for your own submitted document.",
    );
  const normalized=(v:string)=>v.trim().toLocaleLowerCase().replace(/\s+/g," ");
  if(user.role==="Coordinator" && [user.display_name,user.email].some(v=>normalized(v)===normalized(evidence.approver)))
    throw new HttpError(403,"A Coordinator cannot record themselves as the Management approver.");
  if(evidence.decisionAt && new Date(evidence.decisionAt).getTime()>Date.now()+60000)
    throw new HttpError(400,"The approval decision date cannot be in the future.");
  const uploads = await c.query(
    "SELECT id FROM survey_uploads WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND mime IN('image/png','image/jpeg')",
    [evidence.evidenceIds, actor],
  );
  if (uploads.rowCount !== evidence.evidenceIds.length)
    throw new HttpError(403, "Attach your approval screenshots.");
}
export async function recordExternal(
  c: PoolClient,
  actor: string,
  quotationId: string | null,
  submissionId: string | null,
  evidence: ExternalEvidence,
) {
  const row = (
    await c.query(
      "INSERT INTO external_document_approvals(quotation_id,submission_id,approver,comments,recorded_by,channel,decision_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [
        quotationId,
        submissionId,
        evidence.approver,
        evidence.comments,
        actor,
        evidence.channel,
        evidence.decisionAt??null,
      ],
    )
  ).rows[0];
  for (const id of evidence.evidenceIds)
    await c.query(
      "INSERT INTO external_document_approval_files(approval_id,upload_id) VALUES($1,$2)",
      [row.id, id],
    );
  await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
    actor,
    `approval.external-chat.recorded:${quotationId ?? submissionId}`,
  ]);
}
