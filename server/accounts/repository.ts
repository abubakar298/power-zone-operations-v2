import {historicalApprovedOrder} from '../ubl/historical-approved-order.js';
import {agreedBoqPvWatts} from '../../shared/closure-pv-watts.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import { phaseCostComparison } from "./phase-comparison.js";
import {recordPtEntry,ptEntrySchema} from './pt-entries.js';
import { cableInvoiceAdjustment } from "../inventory/reconciliation.js";
import { createHash, randomUUID } from "node:crypto";
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
import {projectOperationsClosureEvidence,operationsClosureEvidenceFile} from './operations-evidence.js';
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
    ptAttachmentId: z.uuid().nullable().optional(),
    operationsEvidenceSignature: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    requestKey: z.uuid(),
    amendmentReason: z.string().trim().min(3).max(2000).optional(),
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
  constructor(readonly pool: Pool) {}
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
  async recordPtEntry(actor:string,input:z.infer<typeof ptEntrySchema>){return recordPtEntry(this.pool,actor,input);}
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
      reviewSamples: (
        await this.pool.query(
          "SELECT DISTINCT ON(r.id) d.id,d.version,d.created_at,r.id AS request_id,r.version AS request_version,r.stage,r.site_name,r.branch_code,r.data->>'configuration' AS configuration,r.data->>'sampleReviewDecision' AS review_decision,d.kind FROM ubl_workflow_documents d JOIN ubl_workflow_requests r ON r.id=d.request_id WHERE (d.kind='IPO / PT review sample' AND r.data->>'accountsReviewSample'='true') OR (d.kind='IPO / PT' AND r.stage IN('IPO Submitted—Awaiting Accounts','Accounts Accepted—BOQ Issuance Pending')) ORDER BY r.id,CASE WHEN d.kind='IPO / PT' THEN 0 ELSE 1 END,d.created_at DESC",
        )
      ).rows,
      ptEntries: (await this.pool.query('SELECT p.*,p.entry_date::text AS entry_date,u.display_name AS recorded_by FROM accounts_pt_entries p JOIN users u ON u.id=p.created_by ORDER BY p.created_at DESC')).rows,
      ipos: ipo.map((i) => ({
        ...i,
        accountsReview: reviews.find((r) => r.ipo_id === i.id),
      })),
      closures: closures.map((c) => ({
        ...c,
        snapshot: {
          ...c.snapshot,
          identity: identities.find((j) => j.key === c.job_key),
        },
      })),
    };
  }
  async managementClosureQueue(actor:string){
    await this.access(actor,this.pool,true);
    return (await this.pool.query(`SELECT id,job_key,version,stage,created_at,
      jsonb_build_object('identity',snapshot->'identity','source',snapshot->'source','jobId',snapshot->'jobId','title',snapshot->'title',
        'summary',jsonb_build_object('selling',snapshot->'summary'->'selling','actual',snapshot->'summary'->'actual')) AS snapshot
      FROM (SELECT DISTINCT ON(job_key) * FROM accounts_active_job_closures ORDER BY job_key,version DESC) latest
      WHERE stage='Awaiting Management' ORDER BY created_at DESC,id`)).rows;
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
    let approved = q?.snapshot.footer?.find(
      (f: any) => f.label === "Net Total",
    )?.amount;
    let agreement: any;
    let agreementAmountsMatch = false;
    // Read the immutable authorisation behind this exact issuance, never current rates.
    if (!q && i.snapshot.approvedCommercialSource?.type === "framework") {
      const saved = (await this.pool.query(
        `SELECT d.authorised_basis AS basis,f.id,f.configuration_key,f.version,f.source_reference,f.payload,
                r.customer_id,p.customer_id AS po_customer
         FROM project_workflow_issuances w
         JOIN project_order_decisions d ON d.id=w.decision_id AND d.receipt_id=w.receipt_id AND d.record_id=w.record_id
         JOIN project_workflow_records r ON r.id=w.record_id
         JOIN project_po_receipts p ON p.id=w.receipt_id
         JOIN project_framework_versions f ON f.id::text=d.authorised_basis->'source'->>'id' AND f.customer_id=r.customer_id
         WHERE w.ipo_id=$1 AND d.outcome IN('Matched','Approved exception')`, [id],
      )).rows[0];
      const source = i.snapshot.approvedCommercialSource;
      if (saved && saved.basis.source.type === "framework" && saved.id === source.id &&
          saved.version === source.version && saved.configuration_key === source.key &&
          saved.customer_id === saved.po_customer && saved.customer_id === i.snapshot.customer?.id) {
        const allocation = saved.basis.order?.allocation;
        const fixedPrice = saved.payload.type === "bank-ups" ? saved.payload.profile?.sellingPriceInclusiveTaxPkr : undefined;
        if (allocation && (!fixedPrice || D(fixedPrice).eq(allocation.total))) {
          approved = allocation.total;
          agreement = {id:saved.id,number:saved.configuration_key,version:saved.version,
            reference:saved.source_reference,terms:saved.basis.comparison?.terms,
            lines:allocation.lines.map((l:any)=>({description:l.description,amount:l.total})),
            total:allocation.total};
          agreementAmountsMatch = allocation.lines.length === a.lines.length && allocation.lines.every((line:any,n:number)=>
            ["qty","beforeTax","taxRate","tax","total","allocatedDiscount"].every(key=>D(line[key]).eq(a.lines[n][key])));
        }
      }
    }
    const sum = (field: string) =>
      a.lines.reduce((s: Decimal, l: any) => s.add(l[field]), D("0"));
    const reconciles =
      !!approved &&
      D(approved).eq(a.total) &&
      sum("total").eq(a.total) &&
      sum("allocatedDiscount").eq(a.originalDiscount) &&
      a.lines
        .filter((l: any) => l.taxRate === "10")
        .every((l: any) => D(l.allocatedDiscount).isZero()) &&
      (!agreement || (agreementAmountsMatch && sum("beforeTax").eq(a.subtotal) && sum("tax").eq(a.tax) &&
        D(a.subtotal).add(a.tax).eq(a.total) &&
        !!i.snapshot.peachtree?.phases && i.snapshot.peachtree.phases.reduce((s:Decimal,p:any)=>s.add(p.amount),D("0")).eq(i.snapshot.peachtree.taxMode === "Tax Included" ? a.total : a.subtotal) &&
        D(i.snapshot.peachtree.ipoPayable).eq(a.total)));
    return {
      ipo: i,
      quotation: q,
      agreement,
      approvedBasisLabel: agreement ? "approved agreement" : "approved quotation",
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
        (agreement ? "Pre-agreed Direct PO" : "Project Sale"),
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
        "IPO and " + comp.approvedBasisLabel + " do not reconcile. Return for revision.",
      );
    return transaction(this.pool, async (c) => {
      await lockActiveActor(c,actor);
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
              agreementId: comp.agreement?.id,
              agreementVersion: comp.agreement?.version,
              approvedBasisLabel: comp.approvedBasisLabel,
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
    let agreedPv: ReturnType<typeof agreedBoqPvWatts> = null;
    if (/^ubl:\d+$/.test(key)) {
      const s = await historicalApprovedOrder(this.pool,key.slice(4));
      if (!s?.baseline) throw new HttpError(404, "Saved budget unavailable.");
      selling = s.baseline.sellingExcludingGst;
      const document = (
        await this.pool.query(
          "SELECT snapshot FROM ubl_site_document_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1",
          [key.slice(4)],
        )
      ).rows[0] ?? (s.historicalOrder?{snapshot:s}:null);
      if (document) {
        agreedPv = agreedBoqPvWatts({agreedWatts:document.snapshot.agreedWatts});
        const pt = ublIpoSample({ ...document.snapshot, status: "Active" });
        phaseSelling = Object.fromEntries(
          pt.phases.map((p) => [p.name, p.sellingExcludingGst]),
        );
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
            : /Delivery\/logistics/i.test(l.item)
              ? "Deliveries"
              : "Installation Cost",
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
      agreedPv = agreedBoqPvWatts({survey:b.snapshot.survey});
      selling = i.snapshot.quotationType?.saleType === "Cash Deal" ? i.snapshot.allocation.total : i.snapshot.allocation.subtotal;
      if (i.snapshot.peachtree?.taxMode !== "Tax Included" || i.snapshot.quotationType?.saleType === "Cash Deal")
        phaseSelling = Object.fromEntries(
          (i.snapshot.peachtree?.phases ?? []).map((p: any) => [
            p.name,
            p.amount,
          ]),
        );
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
        "Budget from the IPO-linked immutable BOQ and saved additional scope, not current Rate Master." + (i.snapshot.dealAccounting?.note ? " " + i.snapshot.dealAccounting.note : "");
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
          AND NOT EXISTS(SELECT 1 FROM closure_comparison_exclusions x WHERE x.job_key=j.job_key AND x.excluded)
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
    const identity = (await new InventoryRepository(this.pool).jobs(actor)).find(j => j.key === key);
    const comparisonIdentity = history[0]?.snapshot?.identity ?? identity;
    const phasePeers = comparisonIdentity?.configuration_id && comparisonIdentity?.customer_code ? (await this.pool.query(`
      SELECT j.snapshot FROM
        (SELECT DISTINCT ON(job_key) * FROM accounts_active_job_closures ORDER BY job_key,version DESC) j
      LEFT JOIN ubl_effective_site_orders o ON j.job_key='ubl:'||o.site_id
      LEFT JOIN internal_purchase_orders i ON j.job_key='ipo:'||i.id
      WHERE j.stage='Closed' AND j.job_key<>$1
          AND NOT EXISTS(SELECT 1 FROM closure_comparison_exclusions x WHERE x.job_key=j.job_key AND x.excluded)
        AND COALESCE(j.snapshot->'identity'->>'configuration_id',o.configuration_id,i.snapshot->>'solutionId')=$2
        AND COALESCE(j.snapshot->'identity'->>'customer_code',CASE WHEN o.site_id IS NOT NULL THEN 'UBL' ELSE i.snapshot->'customer'->>'shortCode' END)=$3
    `,[key,comparisonIdentity.configuration_id,comparisonIdentity.customer_code])).rows : [];
    const currentEvidence=await this.evidenceBundle(actor,key);
    const frozenEvidence=history[0]&&['Awaiting Management','Closed'].includes(history[0].stage)
      &&Array.isArray(history[0].snapshot.evidence)?history[0].snapshot:undefined;
    return {
      agreedPv,
      configurationComparison,
      phaseCostComparison: phaseCostComparison(phasePeers.map(r=>r.snapshot)),
      identity,
      jobKey: key,
      jobId: irr.snapshot.jobId,
      title: irr.snapshot.title,
      reportVersionId: irr.id,
      entry: irr.snapshot.entry,
      reconciliation: irr.snapshot.reconciliation,
      invoiceAdjustment: cableInvoiceAdjustment(irr.snapshot.reconciliation),
      evidence: frozenEvidence?.evidence??currentEvidence.evidence,
      operationsEvidenceSignature: frozenEvidence?frozenEvidence.operationsEvidenceSignature??null:currentEvidence.operationsEvidenceSignature,
      operationsEvidenceSource: frozenEvidence?frozenEvidence.operationsEvidenceSource??null:currentEvidence.operationsEvidenceSource,
      operationsEvidenceHold: currentEvidence.operationsEvidenceHold,
      selling,
      phaseSelling,
      budget,
      epcBudget,
      basis,
      history,
    };
  }
  async evidence(actor: string, key: string) {
    return (await this.evidenceBundle(actor,key)).evidence;
  }
  private async evidenceBundle(actor:string,key:string,c:Pool|PoolClient=this.pool,lock=false){
    await this.access(actor,c);
    const local=(
      await c.query(
        "SELECT id,job_key,kind,filename,media_type,sha256,created_at,created_by FROM job_closure_evidence WHERE job_key=$1 ORDER BY created_at",
        [key],
      )
    ).rows;
    const operations=await projectOperationsClosureEvidence(c,key,{lock});
    return {evidence:[...local,...operations.evidence],operationsEvidenceSignature:operations.signature,
      operationsEvidenceSource:operations.source,operationsEvidenceHold:operations.hold??null};
  }
  async operationsEvidenceFile(actor:string,key:string,version:number,id:string){
    await this.access(actor);
    if(!/^ipo:[0-9a-f-]{36}$/.test(key))throw new HttpError(404,'Evidence not found.');
    // Receiving this exact job's approved Inventory report establishes Accounts scope.
    if(!(await this.pool.query("SELECT 1 FROM inventory_reports r JOIN LATERAL(SELECT stage FROM inventory_report_versions WHERE report_id=r.id ORDER BY version DESC LIMIT 1)v ON true WHERE r.job_key=$1 AND v.stage='Sent to Accounts'",[key])).rowCount)throw new HttpError(404,'Evidence not found.');
    const projection=await projectOperationsClosureEvidence(this.pool,key);
    let reference=projection.evidence.find(file=>file.source.version===version&&file.id===id)?.source;
    if(!reference){
      // An immutable submitted/closed/returned snapshot may retain superseded evidence.
      const closures=(await this.pool.query("SELECT snapshot->'evidence' evidence FROM accounts_active_job_closures WHERE job_key=$1 AND stage IN('Awaiting Management','Closed','Returned for Revision') ORDER BY version DESC",[key])).rows;
      for(const closure of closures){
        const source=Array.isArray(closure.evidence)?closure.evidence.find((file:any)=>file.id===id&&file.source?.kind==='Operations'&&file.source.version===version)?.source:undefined;
        if(source){reference=source;break;}
      }
    }
    if(!reference)throw new HttpError(404,'Evidence not found.');
    return operationsClosureEvidenceFile(this.pool,key,reference);
  }
  async uploadEvidence(
    actor: string,
    key: string,
    filename: string,
    mime: string,
    base64: string,
  ) {
    await this.access(actor);
    const jobs = await new InventoryRepository(this.pool).jobs(actor);
    if (!jobs.some((j) => j.key === key))
      throw new HttpError(404, "Job not found.");
    const latest = (
      await this.pool.query(
        "SELECT stage FROM accounts_active_job_closures WHERE job_key=$1 ORDER BY version DESC LIMIT 1",
        [key],
      )
    ).rows[0];
    if (["Awaiting Management", "Closed"].includes(latest?.stage))
      throw new HttpError(409, "Submitted closure evidence is read-only.");
    const bytes = Buffer.from(base64, "base64");
    const signature =
      mime === "image/png"
        ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
        : mime === "application/pdf" ? bytes.subarray(0,5).toString() === "%PDF-"
        : mime === "image/jpeg" &&
          bytes.subarray(0, 3).toString("hex") === "ffd8ff";
    if (!signature || bytes.length < 1 || bytes.length > 8388608)
      throw new HttpError(400, "Attach a PDF, PNG or JPEG PT report up to 8 MB.");
    return transaction(this.pool,async c=>{
      await lockActiveActor(c,actor);
      await this.access(actor,c);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",['closure:'+key]);
      const current=(await c.query('SELECT stage FROM accounts_active_job_closures WHERE job_key=$1 ORDER BY version DESC LIMIT 1',[key])).rows[0];
      if(['Awaiting Management','Closed'].includes(current?.stage))throw new HttpError(409,'Submitted closure evidence is read-only.');
      const id = randomUUID();
    await c.query(
      "INSERT INTO job_closure_evidence(id,job_key,kind,filename,media_type,content,sha256,created_by) VALUES($1,$2,'PT costing screenshot',$3,$4,$5,$6,$7)",
      [
        id,
        key,
        filename,
        mime,
        bytes,
        createHash("sha256").update(bytes).digest("hex"),
        actor,
      ],
    );
    await c.query(
      "INSERT INTO audit_log(user_id,action) VALUES($1,$2)",
      [actor, "accounts.pt-screenshot:" + id],
    );
    return { id };
    });
  }
  async evidenceFile(actor: string, id: string) {
    await this.access(actor);
    const row = (
      await this.pool.query("SELECT * FROM job_closure_evidence WHERE id=$1", [
        id,
      ])
    ).rows[0];
    if (!row) throw new HttpError(404, "Evidence not found.");
    return row;
  }
  async saveClosure(actor: string, input: z.infer<typeof closureSchema>) {
    await this.access(actor);
    if(input.amendmentReason!==undefined)return this.amendSubmittedClosure(actor,input);
    const job = await this.job(actor, input.jobKey);
    if(input.stage==='Awaiting Management'&&job.operationsEvidenceSource&&!job.operationsEvidenceSignature)
      throw new HttpError(409,'The linked Operations QC handover is incomplete. Complete the customer sign-offs and site photograph evidence before submitting closure.');
    if(input.stage==='Awaiting Management'&&(input.operationsEvidenceSignature??null)!==(job.operationsEvidenceSignature??null))
      throw new HttpError(409,'QC handover evidence changed. Reload and review it before submitting closure.');
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
        !job.evidence.some((e: any) => e.kind === "Client acknowledgment") ||
        !job.evidence.some((e: any) => e.kind === "Site photographs") ||
        !job.evidence.some(
          (e: any) =>
            e.kind === "PT costing screenshot" && e.id === input.ptAttachmentId,
        ))
    )
      throw new HttpError(
        400,
        "Complete actual costs and remarks, attach the PT costing screenshot, and await client acknowledgment and site photographs from QC before submission.",
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
      await lockActiveActor(c,actor);
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
      if(input.stage==='Awaiting Management'){
        const currentEvidence=await this.evidenceBundle(actor,input.jobKey,c,true);
        if(currentEvidence.operationsEvidenceSource&&!currentEvidence.operationsEvidenceSignature||currentEvidence.operationsEvidenceSignature!==job.operationsEvidenceSignature)
          throw new HttpError(409,'QC handover evidence changed. Reload and review it before submitting closure.');
        const entered=(await c.query("SELECT p.id FROM accounts_pt_entries p JOIN inventory_report_versions v ON v.report_id=p.source_id AND v.version=p.source_version WHERE p.source_kind='Inventory' AND v.id=$1",[job.reportVersionId])).rows[0];
        if(!entered)throw new HttpError(409,'Record the current approved IRR and variable items in PT before submitting job closure.');
      }
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
            (
              await c.query(
                "SELECT COALESCE(max(version),0)+1 AS next FROM accounts_job_closures WHERE job_key=$1",
                [input.jobKey],
              )
            ).rows[0].next,
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
  private async amendSubmittedClosure(actor:string,input:z.infer<typeof closureSchema>){
    if(input.stage!=='Awaiting Management')throw new HttpError(400,'Save the revised closure for Management review.');
    return transaction(this.pool,async c=>{
      await lockActiveActor(c,actor);await this.access(actor,c);
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['closure:'+input.jobKey]);
      const replay=(await c.query('SELECT * FROM accounts_active_job_closures WHERE request_key=$1',[input.requestKey])).rows[0];
      if(replay){if(replay.created_by!==actor||fingerprint(replay.snapshot.input)!==fingerprint(input))throw new HttpError(409,'Request key already used.');return replay;}
      const previous=(await c.query('SELECT * FROM accounts_active_job_closures WHERE job_key=$1 ORDER BY version DESC LIMIT 1',[input.jobKey])).rows[0];
      if(!previous||previous.stage!=='Awaiting Management'||previous.version!==input.version)throw new HttpError(409,'This closure changed or is already closed. Reload before editing.');
      await this.currentReport(c,input.jobKey,previous.report_version_id);
      const original=previous.snapshot.input??{};
      if(input.acknowledgment!==(original.acknowledgment??'')||input.photos!==(original.photos??'')||(input.ptAttachmentId??null)!==(original.ptAttachmentId??null)||(input.operationsEvidenceSignature??null)!==(previous.snapshot.operationsEvidenceSignature??null))throw new HttpError(409,'Submitted evidence must remain attached. Request a revision to replace signed evidence.');
      if(Object.keys(input.actual).some(k=>!phases.slice(0,5).includes(k))||Object.keys(input.epc).some(k=>!epcNames.includes(k)))throw new HttpError(400,'Choose the standard PT and EPC categories.');
      const complete=phases.slice(0,5).every(k=>input.actual[k]!==undefined&&input.actual[k]!=='');
      const breakdown=epcNames.every(k=>input.epc[k]!==undefined&&input.epc[k]!=='');
      if(!complete||!input.remarks||input.epcDetails&&!breakdown||!breakdown&&(input.epcAggregate??'')==='')throw new HttpError(400,'Complete actual costs, EPC total and Accounts remarks.');
      const epcTotal=epcNames.reduce((sum,k)=>sum.add(input.epc[k]||'0'),D('0'));
      if(breakdown&&(input.epcAggregate??'')!==''&&!epcTotal.eq(input.epcAggregate!))throw new HttpError(400,'EPC category costs must equal the recorded EPC total.');
      const actualEpc=breakdown?epcTotal:D(input.epcAggregate!);
      const actualTotal=phases.slice(0,5).reduce((sum,k)=>sum.add(input.actual[k]),actualEpc);
      const budgetTotal=phases.reduce((sum,k)=>sum.add(previous.snapshot.budget[k]),D('0'));
      const snapshot={...previous.snapshot,input,complete:true,epcBreakdownComplete:breakdown,actualEpc:m(actualEpc),summary:financialSummary(previous.snapshot.selling,m(budgetTotal),m(actualTotal)),amendment:{previousClosureId:previous.id,previousVersion:previous.version,reason:input.amendmentReason}};
      const next=(await c.query('SELECT COALESCE(max(version),0)+1 AS next FROM accounts_job_closures WHERE job_key=$1',[input.jobKey])).rows[0].next;
      const saved=(await c.query("INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,'Awaiting Management',$5,$6,$7) RETURNING *",[randomUUID(),input.jobKey,previous.report_version_id,next,snapshot,input.requestKey,actor])).rows[0];
      await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'accounts.closure.amended:'+saved.id]);return saved;
    });
  }
  async returnReport(
    actor: string,
    input: { id: string; version: number; notes: string; requestKey: string },
  ) {
    return transaction(this.pool, async (c) => {
      await lockActiveActor(c,actor);
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
      await lockActiveActor(c,actor);
      await this.access(actor, c, true);
      const source = (
        await c.query(
          "SELECT * FROM accounts_active_job_closures WHERE id=$1",
          [input.id],
        )
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
      if(input.decision==='Closed'&&source.snapshot.operationsEvidenceSignature){
        const evidence=await this.evidenceBundle(actor,source.job_key,c,true);
        if(evidence.operationsEvidenceSignature!==source.snapshot.operationsEvidenceSignature)
          throw new HttpError(409,'QC handover evidence changed after submission. Return this closure for review before approval.');
      }
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
