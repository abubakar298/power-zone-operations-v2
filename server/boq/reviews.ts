import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { MastersRepository } from "../masters/repository.js";
import type { ApprovalInstructions } from "./instructions.js";
import { calculate } from "./engine.js";
import { surveySchema } from "./schema.js";
import { type BoqRepository, fingerprint } from "./repository.js";
export class ReviewRepository {
  constructor(
    private pool: Pool,
    private boqs: BoqRepository,
  ) {}
  private async actor(c: PoolClient, id: string, reviewer = false) {
    const user = (
      await c.query("SELECT active,role FROM users WHERE id=$1 FOR SHARE", [id])
    ).rows[0];
    if (!user?.active) throw new HttpError(401, "Your access has ended.");
    if (reviewer && !["Admin", "Management"].includes(user.role))
      throw new HttpError(403, "Admin or Management reviewer access required.");
    return user;
  }
  async list(actor: string) {
    return (
      await this.pool.query(
        `SELECT s.id,s.draft_id,s.draft_version,s.created_at,s.snapshot->'customer'->>'name' AS customer,s.snapshot->'survey'->>'siteName' AS site,s.snapshot->>'total' AS total,u.display_name AS submitted_by_name,COALESCE(v.outcome,'Awaiting review') AS status,v.comments,v.created_at AS reviewed_at,s.base_revision_id,s.revision_reason,f.revision_id FROM boq_review_submissions s JOIN survey_drafts d ON d.id=s.draft_id JOIN users u ON u.id=s.submitted_by LEFT JOIN boq_review_decisions v ON v.submission_id=s.id LEFT JOIN boq_draft_finalizations f ON f.draft_id=s.draft_id AND v.outcome='Approved' WHERE d.owner_id=$1 OR EXISTS(SELECT 1 FROM users WHERE id=$1 AND active AND role IN('Admin','Management')) ORDER BY s.created_at DESC LIMIT 200`,
        [actor],
      )
    ).rows;
  }
  async get(actor: string, id: string) {
    const row = (
      await this.pool.query(
        `SELECT s.*,d.owner_id,u.display_name AS submitted_by_name,COALESCE(v.outcome,'Awaiting review') AS status,v.comments,v.created_at AS reviewed_at,r.display_name AS reviewed_by_name,f.revision_id FROM boq_review_submissions s JOIN survey_drafts d ON d.id=s.draft_id JOIN users u ON u.id=s.submitted_by LEFT JOIN boq_review_decisions v ON v.submission_id=s.id LEFT JOIN users r ON r.id=v.reviewed_by LEFT JOIN boq_draft_finalizations f ON f.draft_id=s.draft_id AND v.outcome='Approved' WHERE s.id=$2 AND (d.owner_id=$1 OR EXISTS(SELECT 1 FROM users WHERE id=$1 AND active AND role IN('Admin','Management')))`,
        [actor, id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Review not found.");
    // History comes from immutable BOQ/quotation snapshots, never current masters.
    row.workflow_history = row.base_revision_id
      ? (
          await this.pool.query(
            `WITH RECURSIVE lineage AS (
            SELECT b.*,ARRAY[b.id] AS visited FROM boq_revisions b WHERE b.id=$1
            UNION ALL
            SELECT b.*,l.visited || b.id FROM lineage l
            JOIN boq_draft_finalizations f ON f.revision_id=l.id
            JOIN survey_drafts d ON d.id=f.draft_id
            JOIN boq_revisions b ON b.id=d.base_revision_id
            WHERE NOT b.id=ANY(l.visited)
          ) SELECT l.id,l.number,l.revision,l.created_at,l.revision_reason,l.revision_origin,
            l.snapshot->>'total' AS budgeted_cost,
            COALESCE(l.snapshot->'survey'->>'sourceMode','Survey') AS survey_type,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id',q.id,'number',q.number,'quoted_at',q.created_at,
              'net_total',q.snapshot->>'netTotal',
              'status',COALESCE((SELECT e.kind FROM coordination_events e WHERE e.quotation_id=q.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1),'Not submitted')
            ) ORDER BY q.version) FROM quotation_versions q WHERE q.boq_revision_id=l.id),'[]'::jsonb) AS quotations
          FROM lineage l ORDER BY l.revision,l.created_at`,
            [row.base_revision_id],
          )
        ).rows
      : [];
    row.revision_context =
      (
        await this.pool.query(
          `SELECT r.origin,r.reason,r.requested_by,q.number AS source_quotation,
        (SELECT e.notes FROM coordination_events e WHERE e.quotation_id=q.id AND e.kind='Changes requested' ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS management_feedback
       FROM quotation_revision_requests r JOIN quotation_versions q ON q.id=r.source_quotation_id WHERE r.draft_id=$1`,
          [row.draft_id],
        )
      ).rows[0] ?? null;
    row.revision_origin =
      (
        await this.pool.query(
          "SELECT revision_origin FROM survey_drafts WHERE id=$1",
          [row.draft_id],
        )
      ).rows[0]?.revision_origin ?? null;
    row.approval = (
      await this.pool.query(
        "SELECT a.*,u.display_name AS recorded_by_name FROM costing_approval_instructions a JOIN users u ON u.id=a.recorded_by WHERE submission_id=$1",
        [id],
      )
    ).rows[0];
    if (row.approval)
      row.approval.evidence = (
        await this.pool.query(
          "SELECT u.id,u.filename FROM costing_approval_evidence e JOIN survey_uploads u ON u.id=e.upload_id WHERE submission_id=$1",
          [id],
        )
      ).rows;
    return row;
  }
  async instructions(actor: string, revisionId: string) {
    const user = (
      await this.pool.query("SELECT active,role FROM users WHERE id=$1", [
        actor,
      ])
    ).rows[0];
    if (!user?.active) throw new HttpError(401, "Your access has ended.");
    return (
      (
        await this.pool.query(
          "SELECT a.*,u.display_name AS recorded_by_name FROM costing_approval_instructions a JOIN users u ON u.id=a.recorded_by WHERE revision_id=$1",
          [revisionId],
        )
      ).rows[0] ?? null
    );
  }
  async submit(actor: string, id: string, version: number, expected: string) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019002)");
      await this.actor(c, actor);
      const d = (
        await c.query(
          "SELECT * FROM survey_drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id, actor],
        )
      ).rows[0];
      if (!d) throw new HttpError(404, "Draft not found.");
      if (
        (
          await c.query(
            "SELECT 1 FROM boq_draft_finalizations WHERE draft_id=$1",
            [id],
          )
        ).rowCount
      )
        throw new HttpError(409, "This draft is already approved and saved.");
      const latest = (
        await c.query(
          "SELECT s.*,v.outcome FROM boq_review_submissions s LEFT JOIN boq_review_decisions v ON v.submission_id=s.id WHERE s.draft_id=$1 ORDER BY draft_version DESC LIMIT 1",
          [id],
        )
      ).rows[0];
      if (latest && !latest.outcome) {
        if (latest.draft_version === version && latest.fingerprint === expected)
          return latest;
        throw new HttpError(409, "This draft is already awaiting review.");
      }
      if (d.version !== version || latest?.draft_version === version)
        throw new HttpError(
          409,
          "Save and recalculate the revised draft before resubmitting.",
        );
      const parsed = surveySchema.safeParse(d.inputs);
      if (!parsed.success)
        throw new HttpError(
          400,
          "Complete all survey fields before submitting.",
        );
      if (parsed.data.uploadIds.length && !parsed.data.ocrReviewed)
        throw new HttpError(400, "Review source documents before submitting.");
      if (d.base_revision_id && !d.revision_reason.trim())
        throw new HttpError(400, "Enter a revision reason.");
      await this.boqs.uploads(
        c,
        actor,
        parsed.data.uploadIds,
        d.base_revision_id,
      );
      const snapshot = calculate(
        parsed.data,
        await new MastersRepository(c, true).list(),
      );
      if (fingerprint(snapshot) !== expected)
        throw new HttpError(
          409,
          "Reference data changed. Calculate and review the costing again.",
        );
      const submission = (
        await c.query(
          "INSERT INTO boq_review_submissions(id,draft_id,draft_version,snapshot,fingerprint,submitted_by,base_revision_id,revision_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            id,
            version,
            snapshot,
            expected,
            actor,
            d.base_revision_id,
            d.revision_reason,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `boq.review.${submission.id}.submitted`,
      ]);
      return submission;
    });
  }
  async decide(
    actor: string,
    id: string,
    outcome: "Approved" | "Changes requested",
    comments: string,
    instructions?: ApprovalInstructions,
    external?: { approver: string; evidenceIds: string[] },
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019002)");
      const user = await this.actor(c, actor, !external);
      if (
        external &&
        !["Admin", "Management", "Coordinator"].includes(user.role)
      )
        throw new HttpError(
          403,
          "Coordinator access required to record external approval.",
        );
      if (external && (!instructions || outcome !== "Approved"))
        throw new HttpError(
          400,
          "Record the approval instructions and evidence.",
        );
      const submission = (
        await c.query("SELECT * FROM boq_review_submissions WHERE id=$1", [id])
      ).rows[0];
      if (!submission) throw new HttpError(404, "Review not found.");
      if (
        external &&
        submission.submitted_by !== actor &&
        !["Admin", "Management"].includes(user.role)
      )
        throw new HttpError(
          403,
          "Record external approval only for your own submitted costing.",
        );
      if (external) {
        const evidence = await c.query(
          "SELECT id FROM survey_uploads WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND mime IN('image/png','image/jpeg')",
          [external.evidenceIds, actor],
        );
        if (
          !external.evidenceIds.length ||
          evidence.rowCount !== external.evidenceIds.length
        )
          throw new HttpError(403, "Attach your approval screenshots.");
      }
      const d = (
        await c.query("SELECT * FROM survey_drafts WHERE id=$1 FOR UPDATE", [
          submission.draft_id,
        ])
      ).rows[0];
      const decision = (
        await c.query(
          "SELECT * FROM boq_review_decisions WHERE submission_id=$1",
          [id],
        )
      ).rows[0];
      if (decision) {
        if (decision.outcome === "Approved" && outcome === "Approved") {
          const original = (
            await c.query(
              "SELECT * FROM costing_approval_instructions WHERE submission_id=$1",
              [id],
            )
          ).rows[0];
          if (
            instructions &&
            (!original ||
              original.recorded_by !== actor ||
              fingerprint(original.instructions) !==
                fingerprint(instructions) ||
              original.channel !== (external ? "External chat" : "In app") ||
              (external && original.claimed_approver !== external.approver))
          )
            throw new HttpError(
              409,
              "This approval is already saved. Its instructions cannot change.",
            );
          if (external) {
            const ids = (
              await c.query(
                "SELECT upload_id FROM costing_approval_evidence WHERE submission_id=$1",
                [id],
              )
            ).rows
              .map((x) => x.upload_id)
              .sort();
            if (
              JSON.stringify(ids) !==
              JSON.stringify([...external.evidenceIds].sort())
            )
              throw new HttpError(
                409,
                "This approval already has different evidence.",
              );
          }
          return {
            saved: (
              await c.query(
                "SELECT r.* FROM boq_draft_finalizations f JOIN boq_revisions r ON r.id=f.revision_id WHERE f.draft_id=$1",
                [d.id],
              )
            ).rows[0],
          };
        }
        throw new HttpError(409, "This submission has already been reviewed.");
      }
      if (d.version !== submission.draft_version)
        throw new HttpError(
          409,
          "The draft changed. Review its latest submission.",
        );
      if (outcome === "Changes requested" && !comments.trim())
        throw new HttpError(400, "Explain the requested changes.");
      await c.query(
        "INSERT INTO boq_review_decisions(submission_id,outcome,comments,reviewed_by) VALUES($1,$2,$3,$4)",
        [id, outcome, comments, actor],
      );
      let saved;
      if (outcome === "Approved")
        saved = await this.boqs.finalize(c, actor, d, submission.snapshot);
      if (saved && instructions) {
        const name = (
          await c.query("SELECT display_name FROM users WHERE id=$1", [actor])
        ).rows[0].display_name;
        await c.query(
          "INSERT INTO costing_approval_instructions(submission_id,revision_id,channel,claimed_approver,instructions,recorded_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            saved.id,
            external ? "External chat" : "In app",
            external?.approver ?? name,
            instructions,
            actor,
          ],
        );
        for (const uploadId of external?.evidenceIds ?? [])
          await c.query("INSERT INTO costing_approval_evidence VALUES($1,$2)", [
            id,
            uploadId,
          ]);
      }
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `boq.review.${id}.${external ? "external-approval-recorded" : outcome === "Approved" ? "approved" : "changes-requested"}`,
      ]);
      return { status: outcome, saved };
    });
  }
}
