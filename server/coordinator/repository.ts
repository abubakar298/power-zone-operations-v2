import {finalizeCustomerBoq} from '../boq/lifecycle.js';
import { Decimal } from "decimal.js";
import { projectCatalog, projectContext } from "./projects.js";
import { resourceOwnership, ownedCondition } from "../http/permissions.js";
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
  async projects(actor: string) {
    return projectCatalog(this.pool, actor);
  }
  async project(actor: string, key: string) {
    const context = await projectContext(this.pool, actor, key);
    const role = (
      await this.pool.query("SELECT role FROM users WHERE id=$1", [actor])
    ).rows[0]?.role;
    const view = await this.overview(
      actor,
      ["Admin", "Management"].includes(role),
    );
    const ids = new Set(
      context.documents.flatMap((d) => [d.id, d.proposal_id].filter(Boolean)),
    );
    return {
      ...context,
      tasks: view.tasks.filter((t: any) =>
        [t.id, t.boq_revision_id, t.ipo_id, t.draft_id].some((id) =>
          ids.has(id),
        ),
      ),
    };
  }
  async overview(actor: string, team: boolean, includeTraining = false) {
    // Explicit sample-batch metadata is the only training classifier.
    const batches = (
      await this.pool.query("SELECT records FROM dashboard_sample_batches")
    ).rows;
    const trainingIds = new Set<string>(
      batches.flatMap((b) =>
        b.records.flatMap((r: any) =>
          [
            r.draftId,
            r.boqRevisionId,
            r.pricingId,
            r.quotationId,
            r.submissionId,
            r.ipoId,
          ].filter(Boolean),
        ),
      ),
    );
    const trainingCustomers = [
      ...new Set<string>(
        batches.flatMap((b) =>
          b.records
            .map((r: any) => String(r.customerId))
            .filter((id: string) => /^\d+$/.test(id)),
        ),
      ),
    ];
    const descendants = (
      await this.pool.query(
        `WITH training_boq AS (SELECT r.id FROM boq_revisions r JOIN boqs b ON b.id=r.boq_id WHERE b.customer_id::text=ANY($1::text[])),training_quote AS (SELECT q.id FROM quotation_versions q JOIN training_boq b ON b.id=q.boq_revision_id)
      SELECT id FROM training_boq UNION SELECT id FROM training_quote
      UNION SELECT id FROM survey_drafts WHERE inputs->>'customerId'=ANY($1::text[])
      UNION SELECT p.id FROM commercial_pricing_versions p JOIN training_boq b ON b.id=p.boq_revision_id
      UNION SELECT s.id FROM ipo_submissions s JOIN training_quote q ON q.id::text=s.input->>'quotationId'
      UNION SELECT i.id FROM internal_purchase_orders i JOIN training_boq b ON b.id::text=i.snapshot->>'boqRevisionId'
      UNION SELECT o.id FROM operations_boq_issuances o JOIN training_boq b ON b.id=o.boq_revision_id
      UNION SELECT v.id FROM cni_proposal_versions v JOIN cni_proposals p ON p.id=v.proposal_id WHERE p.customer_id::text=ANY($1::text[])`,
        [trainingCustomers],
      )
    ).rows;
    for (const row of descendants) trainingIds.add(row.id);
    const excluded = includeTraining ? [] : [...trainingIds];
    const pending = `WITH pending AS (
 SELECT d.id,'Survey / BOQ'::text AS kind,COALESCE(d.inputs->>'siteName','Survey draft') AS reference,COALESCE(d.inputs->>'siteName','') AS site,CASE WHEN s.id IS NULL THEN 'Draft' WHEN s.outcome IS NULL THEN 'Awaiting review' ELSE 'Changes requested' END AS status,COALESCE(s.decision_at,s.created_at,d.created_at) AS started_at,'boqs'::text AS target,d.id AS draft_id,NULL::uuid AS boq_revision_id,NULL::uuid AS ipo_id,NULL::uuid AS request_id,(SELECT name FROM customers WHERE id::text=d.inputs->>'customerId') AS customer
 FROM survey_drafts d LEFT JOIN LATERAL (SELECT r.id,r.created_at,c.created_at AS decision_at,c.outcome FROM boq_review_submissions r LEFT JOIN boq_review_decisions c ON c.submission_id=r.id WHERE r.draft_id=d.id ORDER BY r.created_at DESC LIMIT 1) s ON true
 WHERE ($2 OR d.owner_id=$1) AND NOT EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.draft_id=d.id) AND NOT EXISTS(SELECT 1 FROM boq_draft_finalizations f WHERE f.draft_id=d.id)
 UNION ALL
 SELECT b.id,'Commercial pricing',b.number,b.snapshot->'survey'->>'siteName','Approved BOQ: prepare pricing',b.created_at,'pricing',NULL,b.id,NULL,NULL,b.snapshot->'customer'->>'name' FROM boq_revisions b
 WHERE ($2 OR EXISTS(SELECT 1 FROM boq_draft_finalizations f JOIN survey_drafts d ON d.id=f.draft_id WHERE f.revision_id=b.id AND d.owner_id=$1)) AND NOT EXISTS(SELECT 1 FROM boq_revisions n WHERE n.boq_id=b.boq_id AND n.revision>b.revision) AND NOT EXISTS(SELECT 1 FROM commercial_pricing_versions p WHERE p.boq_revision_id=b.id) AND NOT EXISTS(SELECT 1 FROM internal_purchase_orders i WHERE i.snapshot->>'boqRevisionId'=b.id::text)
 UNION ALL
 SELECT p.id,'Quotation',p.number,p.snapshot->>'siteName','Pricing saved: prepare quotation',p.created_at,'quotes',NULL,p.boq_revision_id,NULL,NULL,p.snapshot->'customer'->>'name' FROM commercial_pricing_versions p WHERE ($2 OR p.created_by=$1) AND NOT EXISTS(SELECT 1 FROM commercial_pricing_versions n WHERE n.boq_revision_id=p.boq_revision_id AND n.version>p.version) AND NOT EXISTS(SELECT 1 FROM quotation_versions q WHERE q.pricing_id=p.id)
 UNION ALL
 SELECT r.id,'Quotation revision',q.number,q.snapshot->>'siteName',CASE WHEN r.costing_change AND f.revision_id IS NULL AND review.id IS NOT NULL AND review.outcome IS NULL THEN 'Awaiting review' WHEN r.costing_change AND f.revision_id IS NULL THEN 'BOQ revision required' ELSE 'Commercial revision required' END,COALESCE(review.decision_at,review.created_at,r.created_at),CASE WHEN r.costing_change AND f.revision_id IS NULL THEN 'boqs' ELSE 'pricing' END,CASE WHEN f.revision_id IS NULL THEN r.draft_id ELSE NULL END,COALESCE(f.revision_id,q.boq_revision_id),NULL,r.id,q.snapshot->'customer'->>'name' FROM quotation_revision_requests r JOIN quotation_versions q ON q.id=r.source_quotation_id LEFT JOIN boq_draft_finalizations f ON f.draft_id=r.draft_id LEFT JOIN survey_drafts d ON d.id=r.draft_id LEFT JOIN LATERAL (SELECT s.id,s.created_at,v.outcome,v.created_at AS decision_at FROM boq_review_submissions s LEFT JOIN boq_review_decisions v ON v.submission_id=s.id WHERE s.draft_id=r.draft_id ORDER BY s.draft_version DESC LIMIT 1) review ON true WHERE ($2 OR r.created_by=$1 OR d.owner_id=$1 OR q.created_by=$1) AND NOT EXISTS(SELECT 1 FROM quotation_revision_links l WHERE l.request_id=r.id)
 UNION ALL
 SELECT q.id,'Sale confirmation',q.number,q.snapshot->>'siteName',CASE WHEN e.kind='PO received' THEN 'Customer confirmed · IPO draft pending' WHEN e.kind='Submitted' THEN 'Awaiting quotation approval' WHEN e.kind='Changes requested' THEN 'Quotation changes requested' WHEN e.kind='Approved' AND NOT EXISTS(SELECT 1 FROM quotation_dispatch_records d WHERE d.quotation_id=q.id) THEN 'Approved quotation awaiting send' WHEN e.kind='Approved' THEN 'Awaiting PO / sale confirmation' ELSE 'Quotation ready: submit for approval' END,COALESCE(e.created_at,q.created_at),'orders',NULL,q.boq_revision_id,NULL,NULL,q.snapshot->'customer'->>'name' FROM quotation_versions q LEFT JOIN LATERAL(SELECT kind,created_at FROM coordination_events WHERE quotation_id=q.id ORDER BY created_at DESC,id DESC LIMIT 1)e ON true WHERE ($2 OR ${ownedCondition("quotation", "q.id", "$1")}) AND NOT EXISTS(SELECT 1 FROM quotation_versions n WHERE n.boq_revision_id=q.boq_revision_id AND n.version>q.version) AND NOT EXISTS(SELECT 1 FROM customer_purchase_orders p WHERE p.quotation_id=q.id) AND NOT EXISTS(SELECT 1 FROM ipo_submissions s WHERE s.input->>'quotationId'=q.id::text) AND NOT EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.source_quotation_id=q.id)
 UNION ALL
 SELECT s.id,'IPO evidence',s.snapshot->>'quotationNumber',s.snapshot->>'siteName','Awaiting evidence approval',s.created_at,'orders',NULL,NULL,NULL,NULL,s.snapshot->'customer'->>'name' FROM ipo_submissions s WHERE ($2 OR s.created_by=$1) AND NOT EXISTS(SELECT 1 FROM internal_purchase_orders i WHERE i.submission_id=s.id)
 UNION ALL
 SELECT i.id,'Operations issuance',i.number,i.snapshot->>'siteName','Complete Accounts and Operations handoff',i.created_at,'orders',NULL,NULL,i.id,NULL,i.snapshot->'customer'->>'name' FROM internal_purchase_orders i LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE ($2 OR i.created_by=$1 OR s.created_by=$1) AND (NOT EXISTS(SELECT 1 FROM operations_boq_issuances o WHERE o.ipo_id=i.id) OR NOT EXISTS(SELECT 1 FROM ipo_accounts_handoffs h WHERE h.ipo_id=i.id))
 UNION ALL
 SELECT p.id,'C&I proposal',v.number,v.snapshot->>'siteName',CASE WHEN a.action='Revision requested' THEN 'Quotation changes requested' WHEN a.action='Approved' AND NOT EXISTS(SELECT 1 FROM quotation_dispatch_records d WHERE d.cni_version_id=v.id) THEN 'Approved quotation awaiting send' WHEN a.action='Approved' THEN 'Awaiting PO / sale confirmation' ELSE 'Awaiting quotation approval' END,COALESCE(a.created_at,v.created_at),'quotes',NULL,NULL,NULL,NULL,v.snapshot->'customer'->>'name'
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
 (SELECT COUNT(*)::integer FROM boq_revisions b WHERE b.created_at>=now()-interval '30 days' AND NOT(b.id=ANY($3::uuid[])) AND ($2 OR EXISTS(SELECT 1 FROM boq_draft_finalizations f JOIN survey_drafts d ON d.id=f.draft_id WHERE f.revision_id=b.id AND d.owner_id=$1))) AS boqs,
 (SELECT COUNT(*)::integer FROM quotation_versions WHERE created_at>=now()-interval '30 days' AND NOT(id=ANY($3::uuid[])) AND ($2 OR created_by=$1)) AS quotations,
 (SELECT COUNT(*)::integer FROM internal_purchase_orders i LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE i.created_at>=now()-interval '30 days' AND NOT(i.id=ANY($3::uuid[])) AND ($2 OR i.created_by=$1 OR s.created_by=$1)) AS ipos,
 (SELECT COUNT(*)::integer FROM operations_boq_issuances WHERE created_at>=now()-interval '30 days' AND NOT(id=ANY($3::uuid[])) AND ($2 OR created_by=$1)) AS handoffs`,
        [actor, team, excluded],
      )
    ).rows[0];
    const stage = (t: any) =>
      t.status === "Approved quotation awaiting send"
        ? "Approved quotations awaiting send"
        : t.kind === "Survey / BOQ"
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
 FROM survey_drafts d LEFT JOIN boq_draft_finalizations f ON f.draft_id=d.id WHERE ($2 OR d.owner_id=$1) `,
        [actor, team],
      )
    ).rows;
    const submissionDetails = (
      await this.pool.query(
        "SELECT s.id,s.input->>'poNumber' AS po_reference,s.snapshot->'document'->>'filename' AS evidence_filename,s.input->>'evidenceType' AS evidence_type FROM ipo_submissions s WHERE s.id=ANY($1::uuid[])",
        [
          result.tasks
            .filter((t: any) => t.kind === "IPO evidence")
            .map((t: any) => t.id),
        ],
      )
    ).rows;
    const tasks = result.tasks.map((t: any) => ({
      ...t,
      ...(submissionDetails.find((s) => s.id === t.id) ?? {}),
      training: [t.id, t.draft_id, t.boq_revision_id, t.ipo_id].some((id) =>
        trainingIds.has(id),
      ),
      stage: stage(t),
      target_minutes: targets[stage(t)] ?? null,
      responsibility: ["Quotation approval", "IPO approval"].includes(stage(t))
        ? "Management"
        : stage(t) === "Customer confirmation"
          ? "Customer"
          : "Coordinator",
    }));
    for (const t of tasks) {
      if (
        t.kind === "Sale confirmation" &&
        [
          "Approved quotations awaiting send",
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
    const completed = timings.filter(
      (v: any) =>
        v.completed && (includeTraining || !trainingIds.has(v.draft_id)),
    );
    const intervals = (
      await this.pool.query(
        `SELECT 'approval' AS kind,EXTRACT(EPOCH FROM(a.created_at-s.created_at))/60 AS minutes FROM coordination_events s JOIN coordination_events a ON a.quotation_id=s.quotation_id AND a.kind IN('Approved','Changes requested') JOIN quotation_versions q ON q.id=s.quotation_id WHERE s.kind='Submitted' AND ($2 OR q.created_by=$1) AND NOT(q.id=ANY($3::uuid[]))
 UNION ALL SELECT 'ipo',EXTRACT(EPOCH FROM(s.created_at-e.created_at))/60 FROM coordination_events e JOIN ipo_submissions s ON s.input->>'quotationId'=e.quotation_id::text WHERE e.kind='PO received' AND ($2 OR s.created_by=$1) AND NOT(s.id=ANY($3::uuid[]))
 UNION ALL SELECT 'handoff',EXTRACT(EPOCH FROM(o.created_at-i.created_at))/60 FROM operations_boq_issuances o JOIN internal_purchase_orders i ON i.id=o.ipo_id WHERE ($2 OR o.created_by=$1) AND NOT(i.id=ANY($3::uuid[]))`,
        [actor, team, excluded],
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
      includesTraining: includeTraining,
      timingBasis: "Elapsed time; existing targets retained",
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
  async dispatchRecord(
    actor: string,
    input: { quotationId?: string; cniVersionId?: string },
  ) {
    const u = (
      await this.pool.query("SELECT role FROM users WHERE id=$1 AND active", [
        actor,
      ])
    ).rows[0];
    if (!u || !["Admin", "Management", "Coordinator"].includes(u.role))
      throw new HttpError(403, "Coordinator access required.");
    const q = input.quotationId
      ? (
          await this.pool.query(
            "SELECT created_by FROM quotation_versions WHERE id=$1",
            [input.quotationId],
          )
        ).rows[0]
      : (
          await this.pool.query(
            "SELECT p.created_by FROM cni_proposal_versions v JOIN cni_proposals p ON p.id=v.proposal_id WHERE v.id=$1",
            [input.cniVersionId],
          )
        ).rows[0];
    if (!q) throw new HttpError(404, "Quotation not found.");
    if (
      u.role === "Coordinator" &&
      (input.quotationId
        ? !(
            await this.pool.query(resourceOwnership.quotation, [
              input.quotationId,
              actor,
            ])
          ).rowCount
        : q.created_by !== actor)
    )
      throw new HttpError(403, "Choose your own quotation.");
    return (
      (
        await this.pool.query(
          "SELECT * FROM quotation_dispatch_records WHERE quotation_id=$1 OR cni_version_id=$2",
          [input.quotationId ?? null, input.cniVersionId ?? null],
        )
      ).rows[0] ?? null
    );
  }
  async dispatch(
    actor: string,
    input: {
      quotationId?: string;
      cniVersionId?: string;
      recipient: string;
      notes: string;
      evidenceIds?:string[];
    },
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(742019006)");
      const u = (
        await c.query("SELECT role FROM users WHERE id=$1 AND active", [actor])
      ).rows[0];
      if (!u || !["Admin", "Management", "Coordinator"].includes(u.role))
        throw new HttpError(403, "Coordinator access required.");
      let q: any;
      if (input.quotationId) {
        q = (
          await c.query(
            "SELECT q.*, (SELECT kind FROM coordination_events WHERE quotation_id=q.id ORDER BY created_at DESC,id DESC LIMIT 1) AS status FROM quotation_versions q WHERE id=$1",
            [input.quotationId],
          )
        ).rows[0];
        if (
          q &&
          (
            await c.query(
              "SELECT 1 FROM quotation_versions WHERE boq_revision_id=$1 AND version>$2",
              [q.boq_revision_id, q.version],
            )
          ).rowCount
        )
          throw new HttpError(409, "Choose the latest quotation.");
      } else {
        q = (
          await c.query(
            "SELECT v.*,p.created_by AS owner,(SELECT action FROM cni_proposal_actions WHERE version_id=v.id ORDER BY created_at DESC,id DESC LIMIT 1) AS status FROM cni_proposal_versions v JOIN cni_proposals p ON p.id=v.proposal_id WHERE v.id=$1",
            [input.cniVersionId],
          )
        ).rows[0];
        if (
          q &&
          (
            await c.query(
              "SELECT 1 FROM cni_proposal_versions WHERE proposal_id=$1 AND version>$2",
              [q.proposal_id, q.version],
            )
          ).rowCount
        )
          throw new HttpError(409, "Choose the latest quotation.");
      }
      if (!q) throw new HttpError(404, "Quotation not found.");
      if (
        u.role === "Coordinator" &&
        (input.quotationId
          ? !(
              await c.query(resourceOwnership.quotation, [
                input.quotationId,
                actor,
              ])
            ).rowCount
          : (q.owner ?? q.created_by) !== actor)
      )
        throw new HttpError(403, "Choose your own quotation.");
      if (q.status !== "Approved")
        throw new HttpError(
          409,
          "Only an approved quotation can be marked sent.",
        );
      const old = (
        await c.query(
          "SELECT * FROM quotation_dispatch_records WHERE quotation_id=$1 OR cni_version_id=$2",
          [input.quotationId ?? null, input.cniVersionId ?? null],
        )
      ).rows[0];
      if (old) {
        await c.query("COMMIT");
        return old;
      }
      const row = (
        await c.query(
          "INSERT INTO quotation_dispatch_records(id,quotation_id,cni_version_id,recipient,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            randomUUID(),
            input.quotationId ?? null,
            input.cniVersionId ?? null,
            input.recipient,
            input.notes,
            actor,
          ],
        )
      ).rows[0];
      const evidenceIds=[...new Set(input.evidenceIds??[])];if(evidenceIds.length){const uploads=await c.query("SELECT id FROM survey_uploads WHERE id=ANY($1::uuid[]) AND owner_id=$2",[evidenceIds,actor]);if(uploads.rowCount!==evidenceIds.length)throw new HttpError(403,'Select your uploaded dispatch evidence.');for(const uploadId of evidenceIds)await c.query('INSERT INTO quotation_dispatch_evidence(dispatch_id,upload_id) VALUES($1,$2)',[row.id,uploadId]);}
      if(input.quotationId)await finalizeCustomerBoq(c,input.quotationId,actor);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        "quotation.sent." + row.id,
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
  async event(
    actor: string,
    quotationId: string,
    kind: string,
    notes: string,
    external?: ExternalEvidence,
    acknowledgePriceChange = false,
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
      // Authority derives only from the immutable saved pricing and quotation, never a client flag.
      const pricing=(await c.query('SELECT snapshot FROM commercial_pricing_versions WHERE id=$1',[q.pricing_id])).rows[0]?.snapshot;
      const allowance=pricing?.discountAuthorization;
      const requested=q.snapshot?.discountAuthorization?.requestedBeforeTax;
      const delegatedDiscount=u.role==='Coordinator' && kind==='Approved' && allowance && pricing.policy?.costUpliftPercent==='5' && pricing.policy?.preapprovedCostDiscountPercent==='5' && requested!==undefined && new Decimal(requested).lte(allowance.preapprovedBeforeTax) && !q.snapshot?.input?.additionalItem && !q.snapshot?.revision;

      if (!management && q.created_by !== actor)
        throw new HttpError(403, "Choose your own quotation.");
      if (
        ["Approved", "Changes requested"].includes(kind) &&
        !management &&
        !external &&
        !delegatedDiscount
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
      const comparison = q.snapshot?.revision?.comparison;
      if (
        kind === "Approved" &&
        !external &&
        comparison?.previousPayable &&
        !new Decimal(comparison.previousPayable).eq(
          comparison.proposedPayable,
        ) &&
        !acknowledgePriceChange
      )
        throw new HttpError(
          409,
          "Review and acknowledge the changed payable before approving this revision.",
        );
      let previous = (
        await c.query(
          "SELECT * FROM coordination_events WHERE quotation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
          [quotationId],
        )
      ).rows[0];
      if(previous?.kind==='Submitted'&&u.role==='Coordinator'&&kind!=='Submitted'&&!external)throw new HttpError(403,'This quotation is with Management. Coordination has preview-only access until Management returns it.');
      if(!previous && delegatedDiscount){
        previous=(await c.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by) VALUES($1,$2,'Submitted',$3,$4) RETURNING *",[randomUUID(),quotationId,'Standard policy: discount within pre-approved 5% of cost allowance',actor])).rows[0];
      }
      if (!previous && external) {
        if (external.channel !== "WhatsApp" || !external.evidenceIds.length)
          throw new HttpError(
            400,
            "Attach the Management discount instruction screenshot before approving this saved version.",
          );
        previous = (
          await c.query(
            "INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by) VALUES($1,$2,'Submitted',$3,$4) RETURNING *",
            [
              randomUUID(),
              quotationId,
              "Saved version covered by prior Management instruction",
              actor,
            ],
          )
        ).rows[0];
      }
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
          "INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by,created_at)VALUES($1,$2,$3,$4,$5,clock_timestamp())RETURNING *",
          [randomUUID(), quotationId, kind, delegatedDiscount ? `${notes}${notes?' · ':''}Coordinator approval within standard discount allowance (policy v${allowance.policyVersion})` : notes, actor],
        )
      ).rows[0];
      if (external) await recordExternal(c, actor, quotationId, null, external);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `coordination.${kind}`,
      ]);
      if(['Submitted','Approved','Changes requested'].includes(kind)){
        const linked=(await c.query(`SELECT r.* FROM project_workflow_records r WHERE r.stage NOT IN('issued','order_exception','customer_tracking') AND (
          r.data->>'quotationId'=$1 OR r.data->>'latestQuotationId'=$1 OR
          EXISTS(SELECT 1 FROM boq_draft_finalizations f JOIN boq_revisions base ON base.id=f.revision_id JOIN boq_revisions quoted ON quoted.id=$2 WHERE f.draft_id::text=r.data->>'draftId' AND base.boq_id=quoted.boq_id) OR
          EXISTS(SELECT 1 FROM framework_revision_sources s JOIN boq_revisions base ON base.id=s.boq_revision_id JOIN boq_revisions quoted ON quoted.id=$2 WHERE s.record_id=r.id AND base.boq_id=quoted.boq_id)
        ) FOR UPDATE`,[quotationId,q.boq_revision_id])).rows;
        const stage=kind==='Submitted'?'management_review':kind==='Approved'?'approved_dispatch':'commercial_revision';
        for(const r of linked){let data={...r.data,latestQuotationId:quotationId,quotationId,returnReason:kind==='Changes requested'?notes:null};const configuration=(await c.query('SELECT target_framework_id,snapshot FROM framework_configuration_revisions WHERE boq_revision_id=$1',[q.boq_revision_id])).rows[0];if(configuration&&kind==='Approved'){data={...data,basis:configuration.snapshot.basis};await c.query('UPDATE project_workflow_records SET framework_id=$2 WHERE id=$1',[r.id,configuration.target_framework_id]);}await c.query('UPDATE project_workflow_records SET stage=$2,data=$3,version=version+1,updated_at=now() WHERE id=$1',[r.id,stage,data]);await c.query('INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),r.id,r.version+1,`quotation-${kind}`,{stage,reason:notes||kind,data},randomUUID(),JSON.stringify({quotationId,kind}),actor]);}
      }
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
