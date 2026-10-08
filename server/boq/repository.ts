import { ownedCondition } from "../http/permissions.js";
import { ReviewRepository } from "./reviews.js";
import type { Pool, PoolClient } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { transaction } from "../db/transaction.js";
import { MastersRepository } from "../masters/repository.js";
import { calculate, type BoqSnapshot } from "./engine.js";
import { surveySchema, type Survey, type SurveyDraft } from "./schema.js";
import { HttpError } from "../http/errors.js";
export function fingerprint(value: unknown) {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value)))))
    .digest("hex");
}
export class BoqRepository {
  constructor(private pool: Pool) {}
  reviews() {
    return new ReviewRepository(this.pool, this);
  }
  async history(id: string) {
    const base = await this.get(id);
    return (
      await this.pool.query(
        "SELECT id,number,revision,revision_reason,created_at,snapshot->>\'total\' AS total FROM boq_revisions WHERE boq_id=$1 ORDER BY revision DESC",
        [base.boq_id],
      )
    ).rows;
  }
  async drafts(owner: string) {
    return (
      await this.pool.query(
        `SELECT d.*,(SELECT jsonb_build_object('designer',u.display_name,'sent_at',h.created_at,'notes',h.inputs->>'notes','attachments',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename)) FROM survey_uploads a WHERE h.inputs->'uploadIds' ? a.id::text)) FROM design_survey_handoffs h JOIN users u ON u.id=h.created_by WHERE h.draft_id=d.id) AS design_source,s.id AS review_id,s.draft_version AS submitted_version,COALESCE(v.outcome,'Awaiting review') AS review_status,v.comments FROM survey_drafts d LEFT JOIN LATERAL(SELECT * FROM boq_review_submissions WHERE draft_id=d.id ORDER BY draft_version DESC LIMIT 1) s ON true LEFT JOIN boq_review_decisions v ON v.submission_id=s.id WHERE d.owner_id=$1 AND d.id NOT IN(SELECT draft_id FROM boq_draft_finalizations) ORDER BY d.updated_at DESC LIMIT 100`,
        [owner],
      )
    ).rows;
  }
  async draftForReport(owner: string, id: string) {
    const row = (
      await this.pool.query(
        "SELECT inputs FROM survey_drafts WHERE id=$1 AND owner_id=$2 AND id NOT IN (SELECT draft_id FROM boq_draft_finalizations)",
        [id, owner],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Survey draft not found.");
    return row.inputs;
  }
  async draft(
    owner: string,
    id: string | undefined,
    version: number,
    inputs: SurveyDraft,
    baseRevisionId?: string,
    reason = "",
    revisionOrigin?: string,
  ) {
    return transaction(this.pool, async (c) => {
      await this.actor(c, owner);
      const existingDraft = id
        ? (
            await c.query(
              "SELECT * FROM survey_drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
              [id, owner],
            )
          ).rows[0]
        : undefined;
      if (id && !existingDraft) throw new HttpError(404, "Draft not found.");
      const base = existingDraft?.base_revision_id ?? baseRevisionId;
      if (
        baseRevisionId &&
        existingDraft &&
        baseRevisionId !== existingDraft.base_revision_id
      )
        throw new HttpError(409, "Revision identity cannot change.");
      if (
        id &&
        (
          await c.query(
            "SELECT 1 FROM boq_review_submissions s LEFT JOIN boq_review_decisions v ON v.submission_id=s.id WHERE s.draft_id=$1 AND v.submission_id IS NULL",
            [id],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "This draft is awaiting review. A reviewer must request changes before it can be edited.",
        );
      if (base) {
        const original = (
          await c.query("SELECT * FROM boq_revisions WHERE id=$1", [base])
        ).rows[0];
        if (!original)
          throw new HttpError(404, "Original BOQ revision not found.");
        if (
          inputs.customerId !== original.snapshot.survey.customerId ||
          inputs.siteCode !== original.snapshot.survey.siteCode
        )
          throw new HttpError(
            400,
            "A revision must retain the original customer and site code.",
          );
      }
      await this.uploads(c, owner, inputs.uploadIds, base);
      if (id) {
        const row = (
          await c.query(
            "UPDATE survey_drafts SET inputs=$1,version=version+1,updated_at=now(),revision_reason=$5,revision_origin=COALESCE(revision_origin,$6) WHERE id=$2 AND owner_id=$3 AND version=$4 AND id NOT IN (SELECT draft_id FROM boq_draft_finalizations) RETURNING id,version",
            [
              inputs,
              id,
              owner,
              version,
              reason,
              base ? (revisionOrigin ?? null) : null,
            ],
          )
        ).rows[0];
        if (!row)
          throw new HttpError(
            409,
            "This draft changed or was saved. Reload the latest draft.",
          );
        return row;
      }
      const next = randomUUID();
      await c.query(
        "INSERT INTO survey_drafts(id,owner_id,inputs,base_revision_id,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,$6)",
        [
          next,
          owner,
          inputs,
          base ?? null,
          reason,
          base ? (revisionOrigin ?? null) : null,
        ],
      );
      return { id: next, version: 1 };
    });
  }
  async preview(s: Survey) {
    const result = calculate(s, await new MastersRepository(this.pool).list());
    return { snapshot: result, fingerprint: fingerprint(result) };
  }
  private async actor(c: PoolClient, id: string) {
    const u = (
      await c.query("SELECT active FROM users WHERE id=$1 FOR SHARE", [id])
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Your access has ended.");
  }
  async uploads(c: PoolClient, owner: string, ids: string[], base?: string) {
    if (!ids.length) return;
    if (new Set(ids).size !== ids.length)
      throw new HttpError(400, "Duplicate attachment.");
    const n = (
      await c.query(
        "SELECT count(*) FROM survey_uploads WHERE id=ANY($1::uuid[]) AND (owner_id=$2 OR EXISTS(SELECT 1 FROM design_survey_handoffs h WHERE h.assigned_to=$2 AND h.inputs->'uploadIds' ? survey_uploads.id::text) OR id IN(SELECT upload_id FROM boq_uploads WHERE revision_id=$3))",
        [ids, owner, base ?? null],
      )
    ).rows[0].count;
    if (Number(n) !== ids.length)
      throw new HttpError(403, "One or more attachments are unavailable.");
  }
  async save(owner: string, id: string, _version: number, _expected: string) {
    const existing = (
      await this.pool.query(
        "SELECT r.* FROM boq_draft_finalizations f JOIN survey_drafts d ON d.id=f.draft_id JOIN boq_revisions r ON r.id=f.revision_id WHERE f.draft_id=$1 AND d.owner_id=$2",
        [id, owner],
      )
    ).rows[0];
    if (existing) return existing;
    throw new HttpError(
      409,
      "Submit the costing for review. Approval saves the exact reviewed BOQ.",
    );
  }
  async finalize(c: PoolClient, actor: string, d: any, snapshot: BoqSnapshot) {
    const s = snapshot.survey;
    let boq: string, revision: number, number: string;
    if (d.base_revision_id) {
      const base = (
        await c.query("SELECT * FROM boq_revisions WHERE id=$1", [
          d.base_revision_id,
        ])
      ).rows[0];
      const latest = (
        await c.query(
          "SELECT * FROM boq_revisions WHERE boq_id=$1 ORDER BY revision DESC LIMIT 1",
          [base.boq_id],
        )
      ).rows[0];
      if (latest.id !== base.id)
        throw new HttpError(
          409,
          "A newer BOQ revision exists. Start from the latest revision.",
        );
      if (!d.revision_reason.trim())
        throw new HttpError(400, "Enter a revision reason.");
      if (
        s.customerId !== base.snapshot.survey.customerId ||
        s.siteCode !== base.snapshot.survey.siteCode
      )
        throw new HttpError(400, "Revision identity cannot change.");
      boq = base.boq_id;
      revision = base.revision + 1;
      number = base.number.replace(/-R\d+$/, `-R${revision}`);
    } else {
      const existingSite = (
        await c.query(
          "SELECT id,status FROM sites WHERE customer_id=$1 AND lower(code)=lower($2) FOR UPDATE",
          [s.customerId, s.siteCode],
        )
      ).rows[0];
      if (existingSite && existingSite.status !== "Active")
        throw new HttpError(
          409,
          "This site is inactive. Select an active site.",
        );
      if (
        existingSite &&
        (
          await c.query("SELECT 1 FROM boqs WHERE site_id=$1", [
            existingSite.id,
          ])
        ).rowCount
      )
        throw new HttpError(
          409,
          "This customer already has a BOQ for this site. Use the Revision workflow for an existing BOQ.",
        );
      const site =
        existingSite?.id ??
        (await c.query("SELECT COALESCE(max(id),0)+1 AS id FROM sites")).rows[0]
          .id;
      if (!existingSite)
        await c.query(
          "INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,$2,$3,$4,$5,'Active')",
          [site, s.customerId, s.siteName, s.siteCode, s.location],
        );
      boq = randomUUID();
      revision = 0;
      number = `${snapshot.customer.shortCode}-${s.siteCode}-001-R0`;
      await c.query(
        "INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) VALUES($1,$2,$3,$4,1,$5)",
        [boq, d.id, site, s.customerId, actor],
      );
    }
    const saved = (
      await c.query(
        "INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          randomUUID(),
          boq,
          revision,
          number,
          snapshot,
          actor,
          d.base_revision_id ? d.revision_reason : "Initial BOQ",
          d.revision_origin,
        ],
      )
    ).rows[0];
    for (const upload of s.uploadIds)
      await c.query(
        "INSERT INTO boq_uploads(revision_id,upload_id) VALUES($1,$2)",
        [saved.id, upload],
      );
    await c.query(
      "INSERT INTO boq_draft_finalizations(draft_id,revision_id) VALUES($1,$2)",
      [d.id, saved.id],
    );
    await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
      actor,
      `boq.${number}.approved`,
    ]);
    return saved;
  }
  async list(actor?: string) {
    return (
      await this.pool.query(
        `SELECT r.id,r.number,r.revision,r.revision_reason,r.boq_id,r.created_at,r.snapshot->'customer'->>'id' AS customer_id,r.snapshot->'customer'->>'name' AS customer,r.snapshot->'survey'->>'siteName' AS site,r.snapshot->>'total' AS total FROM boq_revisions r ${actor ? `WHERE ${ownedCondition("boq", "r.id", "$1")}` : ""} ORDER BY created_at DESC LIMIT 200`,
        actor ? [actor] : [],
      )
    ).rows;
  }
  async get(id: string) {
    const r = (
      await this.pool.query("SELECT * FROM boq_revisions WHERE id=$1", [id])
    ).rows[0];
    if (!r) throw new HttpError(404, "BOQ not found.");
    return r;
  }
  async upload(owner: string, name: string, mime: string, bytes: Buffer) {
    return transaction(this.pool, async (c) => {
      await this.actor(c, owner);
      const quota = (
        await c.query(
          "SELECT count(*) FROM survey_uploads WHERE owner_id=$1 AND created_at>now()-interval '1 hour'",
          [owner],
        )
      ).rows[0].count;
      if (Number(quota) >= 20)
        throw new HttpError(429, "Upload limit reached. Try again later.");
      const id = randomUUID();
      await c.query(
        "INSERT INTO survey_uploads(id,owner_id,filename,mime,size,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          owner,
          name,
          mime,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          bytes,
        ],
      );
      return { id, filename: name, mime, size: bytes.length };
    });
  }
  async attachment(owner: string, id: string) {
    const r = (
      await this.pool.query(
        "SELECT * FROM survey_uploads WHERE id=$1 AND (owner_id=$2 OR EXISTS(SELECT 1 FROM design_survey_handoffs h WHERE h.assigned_to=$2 AND h.inputs->'uploadIds' ? $1::text) OR EXISTS(SELECT 1 FROM boq_uploads bu JOIN boq_revisions br ON br.id=bu.revision_id JOIN boqs b ON b.id=br.boq_id JOIN survey_drafts sd ON sd.id=b.draft_id WHERE bu.upload_id=$1 AND (b.created_by=$2 OR sd.owner_id=$2 OR br.created_by=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))) OR EXISTS(SELECT 1 FROM external_document_approval_files ef JOIN external_document_approvals ea ON ea.id=ef.approval_id WHERE ef.upload_id=$1 AND (ea.recorded_by=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))) OR EXISTS(SELECT 1 FROM costing_approval_evidence e JOIN costing_approval_instructions a ON a.submission_id=e.submission_id WHERE e.upload_id=$1 AND (a.recorded_by=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))) OR EXISTS(SELECT 1 FROM boq_review_submissions s JOIN survey_drafts d ON d.id=s.draft_id WHERE (s.snapshot->'survey'->'uploadIds') ? $1::text AND (d.owner_id=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')))))",
        [id, owner],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "Attachment not found.");
    return r;
  }
}
