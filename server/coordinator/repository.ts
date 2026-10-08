import { ownedCondition } from "../http/permissions.js";
import {
  validateExternal,
  recordExternal,
  type ExternalEvidence,
} from "../approvals/external.js";
import { randomUUID } from "node:crypto";
import { HttpError } from "../http/errors.js";
import type { Pool } from "pg";
export class CoordinatorRepository {
  constructor(private pool: Pool) {}
  async overview(actor: string, team: boolean) {
    const pending = `WITH pending AS (
 SELECT d.id,'Survey / BOQ'::text AS kind,COALESCE(d.inputs->>'siteName','Survey draft') AS reference,COALESCE(d.inputs->>'siteName','') AS site,CASE WHEN s.id IS NULL THEN 'Draft' WHEN s.outcome IS NULL THEN 'Awaiting review' ELSE 'Changes requested' END AS status,COALESCE(s.decision_at,s.created_at,d.created_at) AS started_at,'boqs'::text AS target,d.id AS draft_id,NULL::uuid AS boq_revision_id,NULL::uuid AS ipo_id,NULL::uuid AS request_id
 FROM survey_drafts d LEFT JOIN LATERAL (SELECT r.id,r.created_at,c.created_at AS decision_at,c.outcome FROM boq_review_submissions r LEFT JOIN boq_review_decisions c ON c.submission_id=r.id WHERE r.draft_id=d.id ORDER BY r.created_at DESC LIMIT 1) s ON true
 WHERE ($2 OR d.owner_id=$1) AND NOT EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.draft_id=d.id) AND NOT EXISTS(SELECT 1 FROM boq_draft_finalizations f WHERE f.draft_id=d.id)
 UNION ALL
 SELECT b.id,'Commercial pricing',b.number,b.snapshot->'survey'->>'siteName','Approved BOQ: prepare pricing',b.created_at,'pricing',NULL,b.id,NULL,NULL FROM boq_revisions b
 WHERE ($2 OR EXISTS(SELECT 1 FROM boq_draft_finalizations f JOIN survey_drafts d ON d.id=f.draft_id WHERE f.revision_id=b.id AND d.owner_id=$1)) AND NOT EXISTS(SELECT 1 FROM boq_revisions n WHERE n.boq_id=b.boq_id AND n.revision>b.revision) AND NOT EXISTS(SELECT 1 FROM commercial_pricing_versions p WHERE p.boq_revision_id=b.id)
 UNION ALL
 SELECT p.id,'Quotation',p.number,p.snapshot->>'siteName','Pricing saved: prepare quotation',p.created_at,'quotes',NULL,p.boq_revision_id,NULL,NULL FROM commercial_pricing_versions p WHERE ($2 OR p.created_by=$1) AND NOT EXISTS(SELECT 1 FROM commercial_pricing_versions n WHERE n.boq_revision_id=p.boq_revision_id AND n.version>p.version) AND NOT EXISTS(SELECT 1 FROM quotation_versions q WHERE q.pricing_id=p.id)
 UNION ALL
 SELECT r.id,'Quotation revision',q.number,q.snapshot->>'siteName',CASE WHEN r.costing_change AND f.revision_id IS NULL AND review.id IS NOT NULL AND review.outcome IS NULL THEN 'Awaiting review' WHEN r.costing_change AND f.revision_id IS NULL THEN 'BOQ revision required' ELSE 'Commercial revision required' END,COALESCE(review.decision_at,review.created_at,r.created_at),CASE WHEN r.costing_change AND f.revision_id IS NULL THEN 'boqs' ELSE 'pricing' END,CASE WHEN f.revision_id IS NULL THEN r.draft_id ELSE NULL END,COALESCE(f.revision_id,q.boq_revision_id),NULL,r.id FROM quotation_revision_requests r JOIN quotation_versions q ON q.id=r.source_quotation_id LEFT JOIN boq_draft_finalizations f ON f.draft_id=r.draft_id LEFT JOIN survey_drafts d ON d.id=r.draft_id LEFT JOIN LATERAL (SELECT s.id,s.created_at,v.outcome,v.created_at AS decision_at FROM boq_review_submissions s LEFT JOIN boq_review_decisions v ON v.submission_id=s.id WHERE s.draft_id=r.draft_id ORDER BY s.draft_version DESC LIMIT 1) review ON true WHERE ($2 OR r.created_by=$1 OR d.owner_id=$1 OR q.created_by=$1) AND NOT EXISTS(SELECT 1 FROM quotation_revision_links l WHERE l.request_id=r.id)
 UNION ALL
 SELECT q.id,'Sale confirmation',q.number,q.snapshot->>'siteName',CASE WHEN e.kind='PO received' THEN 'Customer confirmed · IPO draft pending' WHEN e.kind='Submitted' THEN 'Awaiting quotation approval' WHEN e.kind='Changes requested' THEN 'Quotation changes requested' WHEN e.kind='Approved' THEN 'Awaiting PO / sale confirmation' ELSE 'Quotation ready: submit for approval' END,COALESCE(e.created_at,q.created_at),'orders',NULL,q.boq_revision_id,NULL,NULL FROM quotation_versions q LEFT JOIN LATERAL(SELECT kind,created_at FROM coordination_events WHERE quotation_id=q.id ORDER BY created_at DESC,id DESC LIMIT 1)e ON true WHERE ($2 OR ${ownedCondition("quotation", "q.id", "$1")}) AND NOT EXISTS(SELECT 1 FROM quotation_versions n WHERE n.boq_revision_id=q.boq_revision_id AND n.version>q.version) AND NOT EXISTS(SELECT 1 FROM customer_purchase_orders p WHERE p.quotation_id=q.id) AND NOT EXISTS(SELECT 1 FROM ipo_submissions s WHERE s.input->>'quotationId'=q.id::text) AND NOT EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.source_quotation_id=q.id)
 UNION ALL
 SELECT s.id,'IPO evidence',s.snapshot->>'quotationNumber',s.snapshot->>'siteName','Awaiting evidence approval',s.created_at,'orders',NULL,NULL,NULL,NULL FROM ipo_submissions s WHERE ($2 OR s.created_by=$1) AND NOT EXISTS(SELECT 1 FROM internal_purchase_orders i WHERE i.submission_id=s.id)
 UNION ALL
 SELECT i.id,'Operations issuance',i.number,i.snapshot->>'siteName','Complete Accounts and Operations handoff',i.created_at,'orders',NULL,NULL,i.id,NULL FROM internal_purchase_orders i LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE ($2 OR i.created_by=$1 OR s.created_by=$1) AND (NOT EXISTS(SELECT 1 FROM operations_boq_issuances o WHERE o.ipo_id=i.id) OR NOT EXISTS(SELECT 1 FROM ipo_accounts_handoffs h WHERE h.ipo_id=i.id))
 UNION ALL
 SELECT p.id,'C&I proposal',v.number,v.snapshot->>'siteName',CASE WHEN a.action='Revision requested' THEN 'Quotation changes requested' WHEN a.action='Approved' THEN 'Awaiting PO / sale confirmation' ELSE 'Awaiting quotation approval' END,COALESCE(a.created_at,v.created_at),'quotes',NULL,NULL,NULL,NULL
 FROM cni_proposals p JOIN LATERAL(SELECT id,number,snapshot,created_at FROM cni_proposal_versions WHERE proposal_id=p.id ORDER BY version DESC LIMIT 1)v ON true LEFT JOIN LATERAL(SELECT action,created_at FROM cni_proposal_actions WHERE version_id=v.id ORDER BY created_at DESC,id DESC LIMIT 1)a ON true WHERE ($2 OR p.created_by=$1)
 )`;
    const result = (
      await this.pool.query(
        `${pending} SELECT (SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM (SELECT * FROM pending ORDER BY started_at,id) t) AS tasks,(SELECT COUNT(*)::integer FROM pending) AS total,(SELECT COALESCE(jsonb_object_agg(kind,n),'{}'::jsonb) FROM (SELECT kind,COUNT(*)::integer n FROM pending GROUP BY kind) c) AS counts`,
        [actor, team],
      )
    ).rows[0];
    const activity = (
      await this.pool.query(
        `SELECT
 (SELECT COUNT(*)::integer FROM boq_revisions b WHERE b.created_at>=now()-interval '30 days' AND ($2 OR EXISTS(SELECT 1 FROM boq_draft_finalizations f JOIN survey_drafts d ON d.id=f.draft_id WHERE f.revision_id=b.id AND d.owner_id=$1))) AS boqs,
 (SELECT COUNT(*)::integer FROM quotation_versions WHERE created_at>=now()-interval '30 days' AND ($2 OR created_by=$1)) AS quotations,
 (SELECT COUNT(*)::integer FROM internal_purchase_orders i LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE i.created_at>=now()-interval '30 days' AND ($2 OR i.created_by=$1 OR s.created_by=$1)) AS ipos,
 (SELECT COUNT(*)::integer FROM operations_boq_issuances WHERE created_at>=now()-interval '30 days' AND ($2 OR created_by=$1)) AS handoffs`,
        [actor, team],
      )
    ).rows[0];
    const stage = (t: any) =>
      t.kind === "Survey / BOQ"
        ? t.status === "Awaiting review"
          ? "Survey & Costing Preparation"
          : "Survey & Costing Preparation"
        : t.kind === "Commercial pricing" || t.kind === "Quotation"
          ? "Survey & Costing Preparation"
          : t.kind === "Quotation revision"
            ? t.status === "Awaiting review"
              ? "Survey & Costing Preparation"
              : "Revision required"
            : t.kind === "IPO evidence"
              ? "IPO approval"
              : t.kind === "Operations issuance"
                ? "Operations & Accounts Handoff"
                : t.status === "Quotation changes requested"
                  ? "Revision required"
                  : t.status === "Awaiting quotation approval"
                    ? "Quotation approval"
                    : t.status === "Customer confirmed · IPO draft pending"
                      ? "Customer confirmation"
                      : t.status === "Awaiting PO / sale confirmation"
                        ? "Customer confirmation"
                        : "Survey & Costing Preparation";
    const targets: Record<string, number> = {
      "Quotation approval": 20,
      "Operations & Accounts Handoff": 30,
    };
    const timings = (
      await this.pool.query(
        `SELECT d.id AS draft_id,f.revision_id,
 EXTRACT(EPOCH FROM(COALESCE((SELECT MIN(q.created_at) FROM quotation_versions q WHERE q.boq_revision_id=f.revision_id),now())-d.created_at))-COALESCE((SELECT SUM(EXTRACT(EPOCH FROM(COALESCE(c.created_at,now())-r.created_at))) FROM boq_review_submissions r LEFT JOIN boq_review_decisions c ON c.submission_id=r.id WHERE r.draft_id=d.id),0) AS active_seconds,
 EXISTS(SELECT 1 FROM quotation_versions q WHERE q.boq_revision_id=f.revision_id) AS completed
 FROM survey_drafts d LEFT JOIN boq_draft_finalizations f ON f.draft_id=d.id WHERE ($2 OR d.owner_id=$1)`,
        [actor, team],
      )
    ).rows;
    const tasks = result.tasks.map((t: any) => ({
      ...t,
      stage: stage(t),
      target_minutes: targets[stage(t)] ?? null,
      responsibility: [
        "Quotation approval",
        "IPO approval",
      ].includes(stage(t))
        ? "Management"
        : stage(t) === "Customer confirmation"
          ? "Customer"
          : "Coordinator",
    }));
    for (const t of tasks) {
      if (
        t.kind === "Sale confirmation" &&
        [
          "Survey & Costing Preparation",
          "Quotation approval",
          "Revision required",
        ].includes(t.stage)
      )
        t.target = "quotes";
      const timing = timings.find(
        (v: any) =>
          v.draft_id === t.draft_id ||
          (t.boq_revision_id && v.revision_id === t.boq_revision_id),
      );
      t.preparation_minutes =
        timing && !timing.completed
          ? Math.max(0, Number(timing.active_seconds) / 60)
          : null;
    }
    const completed = timings.filter((v: any) => v.completed);
    const intervals = (
      await this.pool.query(
        `SELECT 'approval' AS kind,EXTRACT(EPOCH FROM(a.created_at-s.created_at))/60 AS minutes FROM coordination_events s JOIN coordination_events a ON a.quotation_id=s.quotation_id AND a.kind IN('Approved','Changes requested') JOIN quotation_versions q ON q.id=s.quotation_id WHERE s.kind='Submitted' AND ($2 OR q.created_by=$1)
 UNION ALL SELECT 'ipo',EXTRACT(EPOCH FROM(s.created_at-e.created_at))/60 FROM coordination_events e JOIN ipo_submissions s ON s.input->>'quotationId'=e.quotation_id::text WHERE e.kind='PO received' AND ($2 OR s.created_by=$1)
 UNION ALL SELECT 'handoff',EXTRACT(EPOCH FROM(o.created_at-i.created_at))/60 FROM operations_boq_issuances o JOIN internal_purchase_orders i ON i.id=o.ipo_id WHERE ($2 OR o.created_by=$1)`,
        [actor, team],
      )
    ).rows;
    const metric = (kind: string, target: number) => {
      const r = intervals.filter((v: any) => v.kind === kind);
      return {
        target,
        completed: r.length,
        onTime: r.filter((v: any) => Number(v.minutes) <= target).length,
      };
    };
    const performance = {
      approval: metric("approval", 20),
      ipo: metric("ipo", 15),
      handoff: metric("handoff", 30),
      preparation: {
        target: 15,
        completed: completed.length,
        onTime: completed.filter((v: any) => Number(v.active_seconds) <= 900)
          .length,
      },
      targets: {
        quotationApproval: 20,
        ipoPreparation: 15,
        operationsHandoff: 30,
      },
    };
    const stageCounts: Record<string, number> = {};
    for (const t of tasks)
      stageCounts[t.stage] = (stageCounts[t.stage] ?? 0) + 1;
    return {
      ...result,
      tasks,
      stageCounts,
      performance,
      activity,
      scope: team ? "team" : "mine",
    };
  }
  async event(
    actor: string,
    quotationId: string,
    kind: string,
    notes: string,
    external?: ExternalEvidence,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(742019006)");
      const u = (
        await c.query("SELECT role FROM users WHERE id=$1 AND active", [actor])
      ).rows[0];
      if (!u) throw new HttpError(403, "Active account required.");
      const q = (
        await c.query("SELECT * FROM quotation_versions WHERE id=$1", [
          quotationId,
        ])
      ).rows[0];
      if (!q) throw new HttpError(404, "Quotation not found.");
      const management = ["Admin", "Management"].includes(u.role);
      if (!management && q.created_by !== actor)
        throw new HttpError(403, "Choose your own quotation.");
      if (
        ["Approved", "Changes requested"].includes(kind) &&
        !management &&
        !external
      )
        throw new HttpError(
          403,
          "Quotation decisions require management access.",
        );
      if (external) {
        if (kind !== "Approved")
          throw new HttpError(400, "External evidence records approval only.");
        await validateExternal(c, actor, q.created_by, external);
      }
      const previous = (
        await c.query(
          "SELECT * FROM coordination_events WHERE quotation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
          [quotationId],
        )
      ).rows[0];
      if (previous?.kind === kind) {
        if (external)
          throw new HttpError(409, "This quotation already has a decision.");
        await c.query("COMMIT");
        return previous;
      }
      if (
        (kind === "Submitted" && previous) ||
        (["Approved", "Changes requested"].includes(kind) &&
          previous?.kind !== "Submitted") ||
        (kind === "PO received" && previous?.kind !== "Approved")
      )
        throw new HttpError(
          409,
          "Complete the preceding stage first. A requested change needs a new quotation revision.",
        );
      if (
        await c
          .query(
            "SELECT 1 FROM quotation_versions WHERE boq_revision_id=$1 AND version>$2",
            [q.boq_revision_id, q.version],
          )
          .then((r) => r.rowCount)
      )
        throw new HttpError(409, "Choose the latest quotation version.");
      const row = (
        await c.query(
          "INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by)VALUES($1,$2,$3,$4,$5)RETURNING *",
          [randomUUID(), quotationId, kind, notes, actor],
        )
      ).rows[0];
      if (external) await recordExternal(c, actor, quotationId, null, external);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `coordination.${kind}`,
      ]);
      await c.query("COMMIT");
      return row;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
