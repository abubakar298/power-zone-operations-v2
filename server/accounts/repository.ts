import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { fingerprint } from "../boq/repository.js";
import { phaseBudgets } from "../director/repository.js";
import { InventoryRepository } from "../inventory/repository.js";
import { ublIpoSample } from "../ubl/ipo-sample.js";
import { DepartmentRepository } from "../departments/repository.js";
export const phases = [
  "Solar Panels",
  "Structure",
  "Inverter",
  "Batteries",
  "BMS",
  "EPC",
];
export const epcNames = [
  "Electrical Labour",
  "Earthing Cost",
  "Deliveries",
  "Installation Cost",
];
const amount = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const closureSchema = z
  .object({
    jobKey: z.string().max(100),
    version: z.number().int().nonnegative(),
    stage: z.enum(["Draft", "Awaiting Management"]),
    actual: z.record(z.string(), amount.or(z.literal(""))),
    epc: z.record(z.string(), amount.or(z.literal(""))),
    epcAggregate: amount.or(z.literal("")).optional(),
    epcDetails: z.boolean().optional(),
    remarks: z.string().trim().max(4000),
    acknowledgment: z.string().trim().max(1000),
    photos: z.string().trim().max(1000),
    ptReference: z.string().trim().max(1000),
    requestKey: z.uuid(),
  })
  .strict();
const D = (v: string) => new Decimal(v),
  m = (v: Decimal) => v.toFixed(2);
export function financialSummary(
  selling: string,
  budget: string,
  actual: string | null,
) {
  const markup = D(selling).sub(budget);
  const actualMarkup = actual === null ? null : D(selling).sub(actual);
  return {
    selling,
    budget,
    budgetedMarkup: m(markup),
    budgetedMarkupPercent: D(budget).isZero()
      ? null
      : m(markup.div(budget).mul(100)),
    actual,
    actualMarkup: actualMarkup === null ? null : m(actualMarkup),
    actualMarkupPercent:
      actual === null || D(actual).isZero()
        ? null
        : m(actualMarkup!.div(actual).mul(100)),
  };
}
export class AccountsRepository {
  constructor(private pool: Pool) {}
  async access(
    actor: string,
    c: Pool | PoolClient = this.pool,
    management = false,
  ) {
    const u = (
      await c.query("SELECT role,active FROM users WHERE id=$1", [actor])
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Your access has ended.");
    if (
      !(
        management
          ? ["Admin", "Management"]
          : ["Admin", "Management", "Accounts"]
      ).includes(u.role)
    )
      throw new HttpError(403, "Accounts access required.");
    return u.role as string;
  }
  async overview(actor: string) {
    await this.access(actor);
    const ipo = (
      await new DepartmentRepository(this.pool).portal(actor, "Accounts")
    ).records;
    const reviews = (
      await this.pool.query(
        "SELECT DISTINCT ON(ipo_id) * FROM accounts_ipo_reviews ORDER BY ipo_id,version DESC",
      )
    ).rows;
    const closures = (
      await this.pool.query(
        "SELECT DISTINCT ON(job_key) * FROM accounts_active_job_closures ORDER BY job_key,version DESC",
      )
    ).rows;
    const identities = await new InventoryRepository(this.pool).jobs(actor);
    return {
      ipos: ipo.map((i) => ({
        ...i,
        accountsReview: reviews.find((r) => r.ipo_id === i.id),
      })),
      closures: closures.map(c => ({ ...c, snapshot: { ...c.snapshot,
        identity: identities.find(j => j.key === c.job_key) } })),
    };
  }
  async comparison(actor: string, id: string) {
    await this.access(actor);
    const i = (
      await this.pool.query(
        "SELECT i.* FROM internal_purchase_orders i JOIN ipo_accounts_handoffs h ON h.ipo_id=i.id WHERE i.id=$1",
        [id],
      )
    ).rows[0];
    if (!i) throw new HttpError(404, "IPO not received by Accounts.");
    const q = (
      await this.pool.query(
        "SELECT q.id,q.number,q.snapshot,br.snapshot->'survey'->>'family' AS family FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id WHERE q.id=$1",
        [i.snapshot.quotationId],
      )
    ).rows[0];
    const h = (
      await this.pool.query(
        "SELECT r.*,u.display_name AS recorded_by FROM accounts_ipo_reviews r JOIN users u ON u.id=r.created_by WHERE ipo_id=$1 ORDER BY version DESC",
        [id],
      )
    ).rows;
    const a = i.snapshot.allocation;
    const approved = q?.snapshot.footer?.find(
      (f: any) => f.label === "Net Total",
    )?.amount;
    const sum = (field: string) =>
      a.lines.reduce((s: Decimal, l: any) => s.add(l[field]), D("0"));
    const reconciles =
      !!approved &&
      D(approved).eq(a.total) &&
      sum("total").eq(a.total) &&
      sum("allocatedDiscount").eq(a.originalDiscount) &&
      a.lines
        .filter((l: any) => l.taxRate === "10")
        .every((l: any) => D(l.allocatedDiscount).isZero());
    return {
      ipo: i,
      quotation: q,
      history: h,
      reconciles,
      saleType:
        (
          {
            "solar-hybrid": "Solar Hybrid",
            "bess-only": "BESS Equipment",
            "direct-product": "Direct Product Sale",
            cni: "C&I",
          } as Record<string, string>
        )[q?.family] ??
        q?.family ??
        "Project Sale",
    };
  }
  async review(
    actor: string,
    input: {
      id: string;
      version: number;
      decision: string;
      notes: string;
      requestKey: string;
    },
  ) {
    await this.access(actor);
    const comp = await this.comparison(actor, input.id);
    if (input.decision === "Verified" && !comp.reconciles)
      throw new HttpError(
        409,
        "IPO and approved quotation do not reconcile. Return for revision.",
      );
    return transaction(this.pool, async (c) => {
      await this.access(actor, c);
      await c.query(
        "SELECT id FROM internal_purchase_orders WHERE id=$1 FOR UPDATE",
        [input.id],
      );
      const old = (
        await c.query(
          "SELECT * FROM accounts_ipo_reviews WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (old) {
        if (
          old.created_by !== actor ||
          fingerprint(old.snapshot.request) !== fingerprint(input)
        )
          throw new HttpError(409, "Request key already used.");
        return old;
      }
      const latest = (
        await c.query(
          "SELECT * FROM accounts_ipo_reviews WHERE ipo_id=$1 ORDER BY version DESC LIMIT 1",
          [input.id],
        )
      ).rows[0];
      if ((latest?.version ?? 0) !== input.version)
        throw new HttpError(409, "IPO review changed. Reload.");
      if (latest?.decision === "Verified")
        throw new HttpError(409, "Verified IPO review is read-only.");
      const row = (
        await c.query(
          "INSERT INTO accounts_ipo_reviews(id,ipo_id,version,decision,notes,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            input.id,
            input.version + 1,
            input.decision,
            input.notes,
            {
              request: input,
              quotationId: comp.quotation?.id,
              ipoNumber: comp.ipo.number,
              reconciles: comp.reconciles,
            },
            input.requestKey,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        "accounts.ipo." + input.decision + ":" + input.id,
      ]);
      return row;
    });
  }
  async job(actor: string, key: string) {
    await this.access(actor);
    const irr = (
      await this.pool.query(
        "SELECT v.* FROM inventory_reports r JOIN LATERAL(SELECT * FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1)v ON true WHERE r.job_key=$1 AND v.stage='Sent to Accounts'",
        [key],
      )
    ).rows[0];
    if (!irr)
      throw new HttpError(
        409,
        "Inventory reconciliation has not been received by Accounts.",
      );
    let lines: any[], selling: string, basis: string;
    let phaseSelling: Record<string, string> = {};
    if (/^ubl:\d+$/.test(key)) {
      const s = (
        await this.pool.query(
          "SELECT baseline FROM ubl_effective_site_orders WHERE site_id=$1",
          [key.slice(4)],
        )
      ).rows[0];
      if (!s?.baseline) throw new HttpError(404, "Saved budget unavailable.");
      selling = s.baseline.sellingExcludingGst;
      const document = (await this.pool.query(
        "SELECT snapshot FROM ubl_site_document_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1", [key.slice(4)],
      )).rows[0];
      if (document) {
        const pt = ublIpoSample({ ...document.snapshot, status: "Active" });
        phaseSelling = Object.fromEntries(pt.phases.map(p => [p.name, p.sellingExcludingGst]));
        selling = pt.totalSellingExcludingGst;
      }
      lines = s.baseline.items.map((l: any) => ({
        key: l.item,
        cost: String(l.total_ex_gst),
        phase:
          l.item === "Solar panels"
            ? "Solar Panels"
            : l.item === "Elevated structure"
              ? "Structure"
              : /^HYB-/.test(l.item)
                ? "Inverter"
                : /battery/i.test(l.item)
                  ? "Batteries"
                  : /BMS/.test(l.item)
                    ? "BMS"
                    : "EPC",
        epc: /earthing bore/i.test(l.item)
          ? "Earthing Cost"
          : /Installation including|Electrical labour/i.test(l.item)
            ? "Electrical Labour"
            : /Delivery\/logistics/i.test(l.item) ? "Deliveries" : "Installation Cost",
      }));
      basis =
        "Saved UBL site budget; labour and delivery are separate. Approved selling price remains fixed pending authorized invoice adjustments.";
    } else {
      const i = (
        await this.pool.query(
          "SELECT snapshot FROM internal_purchase_orders WHERE id=$1",
          [key.slice(4)],
        )
      ).rows[0];
      if (!i) throw new HttpError(404, "IPO not found.");
      const b = (
        await this.pool.query(
          "SELECT br.snapshot,extra.input AS additional_input FROM boq_revisions br LEFT JOIN quotation_additional_inputs extra ON extra.quotation_id=$2 WHERE br.id=$1",
          [i.snapshot.boqRevisionId, i.snapshot.quotationId],
        )
      ).rows[0];
      if (!b) throw new HttpError(409, "Saved BOQ budget unavailable.");
      selling = i.snapshot.allocation.subtotal;
      if (i.snapshot.peachtree?.taxMode !== "Tax Included")
        phaseSelling = Object.fromEntries((i.snapshot.peachtree?.phases ?? []).map((p: any) => [p.name, p.amount]));
      const savedPhases = phaseBudgets(
        b.snapshot,
        [],
        b.additional_input?.cost ?? "0",
      );
      lines = b.snapshot.lines.map((l: any) => ({
        key: l.key,
        cost: l.total,
        phase:
          l.phase === "Solar Panels"
            ? "Solar Panels"
            : l.phase === "Structure"
              ? "Structure"
              : l.key === b.snapshot.inverterConfig?.sku
                ? "Inverter"
                : /^(CH-BMS-|BMS-)/.test(l.key)
                  ? "BMS"
                  : l.phase === "BESS"
                    ? "Batteries"
                    : /^(CH-BMS-|BMS-)/.test(l.key)
                      ? "BMS"
                      : "EPC",
        epc: l.epc || "Installation Cost",
      }));
      lines = lines.filter((l) => l.phase === "EPC");
      for (const p of savedPhases.filter((p) => p.name !== "EPC"))
        lines.push({ key: p.name, cost: p.budgetedCost, phase: p.name });
      if (b.additional_input?.cost)
        lines.push({
          key: "Additional scope",
          cost: b.additional_input.cost,
          phase: "EPC",
          epc: "Installation Cost",
        });
      basis =
        "Budget from the IPO-linked immutable BOQ and saved additional scope, not current Rate Master.";
    }
    const sum = (list: any[]) =>
      m(list.reduce((s: Decimal, l: any) => s.add(l.cost), D("0")));
    const budget = Object.fromEntries(
      phases.map((p) => [p, sum(lines.filter((l) => l.phase === p))]),
    );
    const epcBudget = Object.fromEntries(
      epcNames.map((n) => [
        n,
        sum(lines.filter((l) => l.phase === "EPC" && l.epc === n)),
      ]),
    );
    const history = (
      await this.pool.query(
        "SELECT j.*,u.display_name AS recorded_by FROM accounts_active_job_closures j JOIN users u ON u.id=j.created_by WHERE job_key=$1 ORDER BY version DESC",
        [key],
      )
    ).rows;
    let configurationComparison = null;
    if (/^ubl:\d+$/.test(key)) {
      const peers = (
        await this.pool.query(
          `
        SELECT j.snapshot FROM
          (SELECT DISTINCT ON(job_key) * FROM accounts_active_job_closures ORDER BY job_key,version DESC) j
        JOIN ubl_effective_site_orders o ON j.job_key='ubl:'||o.site_id
        WHERE j.stage='Closed' AND j.job_key<>$1
          AND o.configuration_id=(SELECT configuration_id FROM ubl_effective_site_orders WHERE site_id=$2)
      `,
          [key, key.slice(4)],
        )
      ).rows;
      const completePeers = peers.filter(
        (r) =>
          r.snapshot.summary.actual !== null &&
          r.snapshot.summary.actual !== undefined &&
          r.snapshot.summary.actualMarkup !== null &&
          r.snapshot.summary.actualMarkup !== undefined,
      );
      const peerCost = completePeers.reduce(
        (sum: Decimal, r: any) => sum.add(r.snapshot.summary.actual),
        D("0"),
      );
      const peerMarkup = completePeers.reduce(
        (sum: Decimal, r: any) => sum.add(r.snapshot.summary.actualMarkup),
        D("0"),
      );
      configurationComparison = {
        closedJobs: completePeers.length,
        averageActualMarkupPercent: peerCost.gt(0)
          ? m(peerMarkup.div(peerCost).mul(100))
          : null,
      };
    }
    return {
      configurationComparison,
      identity: (await new InventoryRepository(this.pool).jobs(actor)).find(j => j.key === key),
      jobKey: key,
      jobId: irr.snapshot.jobId,
      title: irr.snapshot.title,
      reportVersionId: irr.id,
      entry: irr.snapshot.entry,
      reconciliation: irr.snapshot.reconciliation,
      selling,
      phaseSelling,
      budget,
      epcBudget,
      basis,
      history,
    };
  }
  async saveClosure(actor: string, input: z.infer<typeof closureSchema>) {
    await this.access(actor);
    const job = await this.job(actor, input.jobKey);
    const keys = [...phases.slice(0, 5), ...epcNames];
    if (
      Object.keys(input.actual).some((k) => !phases.slice(0, 5).includes(k)) ||
      Object.keys(input.epc).some((k) => !epcNames.includes(k))
    )
      throw new HttpError(400, "Choose the standard PT and EPC categories.");
    const complete = keys.every(
      (k) => (input.actual[k] ?? input.epc[k] ?? "") !== "",
    );
    if (
      input.epcDetails === true &&
      input.stage === "Awaiting Management" &&
      (!complete || !input.epcAggregate)
    )
      throw new HttpError(
        400,
        "Enter every EPC category and the PT EPC total when EPC details are selected.",
      );
    const epcTotal = epcNames.reduce(
      (s, n) => s.add(input.epc[n] || "0"),
      D("0"),
    );
    if (
      complete &&
      (input.epcAggregate ?? "") !== "" &&
      !epcTotal.eq(input.epcAggregate!)
    )
      throw new HttpError(
        400,
        "EPC category costs must equal the recorded EPC total.",
      );
    const financialComplete =
      phases
        .slice(0, 5)
        .every(
          (n) => input.actual[n] !== undefined && input.actual[n] !== "",
        ) &&
      (complete || (input.epcAggregate ?? "") !== "");
    if (
      input.stage === "Awaiting Management" &&
      (!financialComplete ||
        !input.remarks ||
        !input.acknowledgment ||
        !input.photos ||
        !input.ptReference)
    )
      throw new HttpError(
        400,
        "Complete actual costs, remarks, client acknowledgment, site photographs and PT references before submission.",
      );
    const financialEpc = complete ? epcTotal : D(input.epcAggregate || "0");
    const actualTotal = phases
      .slice(0, 5)
      .reduce((s, n) => s.add(input.actual[n] || "0"), financialEpc);
    const budgetTotal = phases.reduce((s, n) => s.add(job.budget[n]), D("0"));
    const snapshot = {
      ...job,
      history: undefined,
      input,
      complete: financialComplete,
      epcBreakdownComplete: epcNames.every(
        (n) => input.epc[n] !== undefined && input.epc[n] !== "",
      ),
      actualEpc: financialComplete ? m(financialEpc) : null,
      summary: financialSummary(
        job.selling,
        m(budgetTotal),
        financialComplete ? m(actualTotal) : null,
      ),
    };
    return transaction(this.pool, async (c) => {
      await this.access(actor, c);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "closure:" + input.jobKey,
      ]);
      const old = (
        await c.query(
          "SELECT * FROM accounts_active_job_closures WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (old) {
        if (
          old.created_by !== actor ||
          fingerprint(old.snapshot.input) !== fingerprint(input)
        )
          throw new HttpError(409, "Request key already used.");
        return old;
      }
      await this.currentReport(c, input.jobKey, job.reportVersionId);
      const latest = (
        await c.query(
          "SELECT * FROM accounts_active_job_closures WHERE job_key=$1 ORDER BY version DESC LIMIT 1",
          [input.jobKey],
        )
      ).rows[0];
      if ((latest?.version ?? 0) !== input.version)
        throw new HttpError(409, "Closure changed. Reload.");
      if (["Awaiting Management", "Closed"].includes(latest?.stage))
        throw new HttpError(409, "Submitted closure is read-only.");
      const row = (
        await c.query(
          "INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            input.jobKey,
            job.reportVersionId,
            (await c.query("SELECT COALESCE(max(version),0)+1 AS next FROM accounts_job_closures WHERE job_key=$1",[input.jobKey])).rows[0].next,
            input.stage,
            snapshot,
            input.requestKey,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        "accounts.closure." + input.stage + ":" + row.id,
      ]);
      return row;
    });
  }
  async returnReport(
    actor: string,
    input: { id: string; version: number; notes: string; requestKey: string },
  ) {
    return transaction(this.pool, async (c) => {
      await this.access(actor, c);
      const r = (
        await c.query("SELECT * FROM inventory_reports WHERE id=$1", [input.id])
      ).rows[0];
      if (!r) throw new HttpError(404, "Installation report not found.");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "closure:" + r.job_key,
      ]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "irr:" + r.job_key,
      ]);
      const replay = (
        await c.query(
          "SELECT * FROM inventory_report_versions WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.created_by !== actor ||
          fingerprint(replay.snapshot.returnRequest) !== fingerprint(input)
        )
          throw new HttpError(409, "Request key already used.");
        return replay;
      }
      const closure = (
        await c.query(
          "SELECT stage FROM accounts_active_job_closures WHERE job_key=$1 ORDER BY version DESC LIMIT 1",
          [r.job_key],
        )
      ).rows[0];
      if (["Closed", "Awaiting Management"].includes(closure?.stage))
        throw new HttpError(
          409,
          "Management must return the closure before Inventory corrections.",
        );
      const v = (
        await c.query(
          "SELECT * FROM inventory_report_versions WHERE report_id=$1 ORDER BY version DESC LIMIT 1",
          [r.id],
        )
      ).rows[0];
      if (v?.version !== input.version || v.stage !== "Sent to Accounts")
        throw new HttpError(
          409,
          "Only the current received report can be returned. Reload.",
        );
      const row = (
        await c.query(
          "INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,'Returned for Correction',$4,$5,$6) RETURNING *",
          [
            randomUUID(),
            r.id,
            v.version + 1,
            { ...v.snapshot, returnReason: input.notes, returnRequest: input },
            input.requestKey,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        "accounts.irr.return:" + r.id,
      ]);
      return row;
    });
  }
  private async currentReport(c: PoolClient, key: string, versionId: string) {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["irr:" + key]);
    const row = (
      await c.query(
        "SELECT v.id,v.stage FROM inventory_reports r JOIN LATERAL(SELECT id,stage FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1)v ON true WHERE r.job_key=$1",
        [key],
      )
    ).rows[0];
    if (row?.id !== versionId || row.stage !== "Sent to Accounts")
      throw new HttpError(
        409,
        "Inventory report changed. Reload and review the current reconciliation.",
      );
  }
  async decision(
    actor: string,
    input: {
      id: string;
      version: number;
      decision: "Closed" | "Returned for Revision";
      notes: string;
      requestKey: string;
    },
  ) {
    return transaction(this.pool, async (c) => {
      await this.access(actor, c, true);
      const source = (
        await c.query("SELECT * FROM accounts_active_job_closures WHERE id=$1", [
          input.id,
        ])
      ).rows[0];
      if (!source) throw new HttpError(404, "Closure not found.");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "closure:" + source.job_key,
      ]);
      const old = (
        await c.query(
          "SELECT * FROM accounts_active_job_closures WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (old) {
        if (
          old.created_by !== actor ||
          fingerprint(old.snapshot.decision) !== fingerprint(input)
        )
          throw new HttpError(409, "Request key already used.");
        return old;
      }
      const latest = (
        await c.query(
          "SELECT * FROM accounts_active_job_closures WHERE job_key=$1 ORDER BY version DESC LIMIT 1",
          [source.job_key],
        )
      ).rows[0];
      if (
        latest.id !== source.id ||
        latest.version !== input.version ||
        latest.stage !== "Awaiting Management"
      )
        throw new HttpError(
          409,
          "Only the current submitted closure can be decided.",
        );
      await this.currentReport(c, source.job_key, source.report_version_id);
      if (input.decision === "Closed" && !source.snapshot.complete)
        throw new HttpError(409, "Actual costs are incomplete.");
      const row = (
        await c.query(
          "INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            source.job_key,
            source.report_version_id,
            input.version + 1,
            input.decision,
            { ...source.snapshot, decision: input },
            input.requestKey,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        "management.closure." + input.decision + ":" + row.id,
      ]);
      return row;
    });
  }
}
