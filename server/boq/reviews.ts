import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { MastersRepository } from "../masters/repository.js";
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
    return row;
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
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019002)");
      await this.actor(c, actor, true);
      const submission = (
        await c.query("SELECT * FROM boq_review_submissions WHERE id=$1", [id])
      ).rows[0];
      if (!submission) throw new HttpError(404, "Review not found.");
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
        if (decision.outcome === "Approved" && outcome === "Approved")
          return {
            saved: (
              await c.query(
                "SELECT r.* FROM boq_draft_finalizations f JOIN boq_revisions r ON r.id=f.revision_id WHERE f.draft_id=$1",
                [d.id],
              )
            ).rows[0],
          };
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
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `boq.review.${id}.${outcome === "Approved" ? "approved" : "changes-requested"}`,
      ]);
      return { status: outcome, saved };
    });
  }
}
