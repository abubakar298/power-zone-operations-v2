import {queueIssuedPo,queueSharedIpo} from '../ipo-email/queue.js';
import {allocateEditableIpo,manualIpoAvailable} from '../documents/manual-ipo.js';
import { ipoSiteIdentity } from "./site-identity.js";
import {archivedDocumentIds} from '../maintenance/archived-documents.js';
import {cashDeal, sellingFactor} from "../commercial/deal.js";
import { requireEligibleQuotation } from "../commercial/eligibility.js";
import { allocateReference, boqIdentity } from "../documents/references.js";
import { ownedCondition } from "../http/permissions.js";
import {
  validateExternal,
  recordExternal,
  type ExternalEvidence,
} from "../approvals/external.js";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { transaction } from "../db/transaction.js";
import { fingerprint } from "../boq/repository.js";
import { CommercialRepository } from "../commercial/repository.js";
import { quote } from "../commercial/engine.js";
import { HttpError } from "../http/errors.js";
import { allocateDiscount,allocateBeforeTaxDiscount } from "./allocation.js";
import {discountedSellingReview} from '../commercial/engine.js';
import {allocateApprovedDiscount,distributeCents,DISCOUNT_POLICY} from '../commercial/discount-strategy.js';
import { peachtreeDivision } from "./peachtree-v5.js";
import {ptDetail} from './pt-detail.js';
import type { OrderInput } from "./schema.js";

export const IPO_ALLOCATION_PENDING = "IPO allocation is paused because the saved quotation’s discount and tax cannot be safely reconciled. The accepted quotation remains unchanged.";
export function isPendingIpoAllocation(error: unknown) {
  return error instanceof HttpError && error.status === 422 &&
    (error.message === IPO_ALLOCATION_PENDING ||
      error.message === "Quotation totals do not reconcile with its approved selling amounts.");
}

export class OrdersRepository {
  constructor(private pool: Pool) {}
  async quotationTypes(ipoIds: string[]) {
    if (!ipoIds.length) return new Map<string, any>();
    const { rows } = await this.pool.query(
      `SELECT i.id,p.snapshot->'input'->>'presentation' AS presentation,p.snapshot->'input'->>'taxMode' AS "taxMode",p.snapshot->'input'->>'saleType' AS "saleType",p.snapshot->'input'->>'cashGstTreatment' AS "cashGstTreatment" FROM internal_purchase_orders i JOIN quotation_versions q ON q.id::text=i.snapshot->>'quotationId' JOIN commercial_pricing_versions p ON p.id=q.pricing_id WHERE i.id=ANY($1::uuid[])`,
      [ipoIds],
    );
    return new Map(
      rows.map((r) => [
        r.id,
        { presentation: r.presentation, taxMode: r.taxMode,saleType:r.saleType,cashGstTreatment:r.cashGstTreatment },
      ]),
    );
  }
  async defaults(quotationId: string) {
    await requireEligibleQuotation(this.pool,quotationId);
    const row = (
      await this.pool.query(
        `SELECT c.*, q.snapshot->'input'->>'proposedBy' AS proposed_by,p.snapshot->'input'->>'presentation' AS presentation,p.snapshot->'input'->>'taxMode' AS tax_mode,p.snapshot->'input'->>'saleType' AS sale_type,p.snapshot->'input'->>'cashGstTreatment' AS cash_gst_treatment FROM quotation_versions q JOIN commercial_pricing_versions p ON p.id=q.pricing_id JOIN boq_revisions b ON b.id=q.boq_revision_id JOIN boqs o ON o.id=b.boq_id JOIN customers c ON c.id=o.customer_id WHERE q.id=$1`,
        [quotationId],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Quotation customer not found.");
    return {
      customerName: row.name,
      customerNtn: row.ntn ?? "",
      customerStrn: row.strn ?? "",
      invoiceCompany: row.sale_type === "Cash Deal" ? "Energy Solutions" : "PZES (PVT Ltd)",
      quotationType: { presentation: row.presentation, taxMode: row.tax_mode,saleType:row.sale_type,cashGstTreatment:row.cash_gst_treatment },
      contactPerson: row.contact_person || row.name,
      phone: row.phone,
      email: row.email,
      billingAddress: row.address,
      paymentContact: row.contact_person || row.name,
      paymentPhone: row.phone,
      salesPerson: row.proposed_by ?? "",
    };
  }
  async preview(
    actor: string,
    input: OrderInput,
    c: Pool | PoolClient = this.pool,
    reportingOnly = false,
  ) {
    const user = (
      await c.query("SELECT active,display_name FROM users WHERE id=$1", [
        actor,
      ])
    ).rows[0];
    if (!user?.active) throw new HttpError(401, "Your access has ended.");
    const q = (
      await c.query("SELECT * FROM quotation_versions WHERE id=$1", [
        input.quotationId,
      ])
    ).rows[0];
    if (!q) throw new HttpError(404, "Saved quotation not found.");
    if(reportingOnly) await new CommercialRepository(this.pool).manager(c,actor,false);
    else await requireEligibleQuotation(c,input.quotationId);
    const p = (
      await c.query("SELECT * FROM commercial_pricing_versions WHERE id=$1", [
        q.pricing_id,
      ])
    ).rows[0];
    const b = (
      await c.query("SELECT * FROM boq_revisions WHERE id=$1", [
        q.boq_revision_id,
      ])
    ).rows[0];
    const extra = (
      await c.query(
        "SELECT input FROM quotation_additional_inputs WHERE quotation_id=$1",
        [q.id],
      )
    ).rows[0]?.input;
    if(cashDeal(p.snapshot.input) && input.invoiceCompany !== "Energy Solutions") throw new HttpError(422,"Cash deals must use Energy Solutions as the invoicing company.");
    if(!reportingOnly&&input.ipoNumber&&!await manualIpoAvailable(c,input.ipoNumber))throw new HttpError(409,'This IPO number is already in use. Enter a different number or select automatic numbering.');
    const source = q.snapshot;
    const detailed = quote(
      {
        ...p.snapshot,
        input: {
          ...p.snapshot.input,
          presentation: "Full Breakup",
          taxMode: "Show Sales Tax Separately",
        },
      },
      b.snapshot,
      { pricingId: p.id, ...source.input, additionalItem: extra },
    );
    // Preserve accepted wording where presentations share a scope row. New zero rows
    // merely provide the canonical costing mapping; they are not additional scope.
    const used = new Set<number>();
    detailed.lines.forEach((l) => {
      const index = source.lines.findIndex(
        (s: any, i: number) =>
          !used.has(i) &&
          s.group === l.group &&
          s.qty === l.qty &&
          s.unit === l.unit,
      );
      if (index >= 0) {
        l.description = source.lines[index].description;
        used.add(index);
      }
    });
    const footer = (name: string) =>
      source.footer.find((r: any) => r.label === name)?.amount;
    const extraSelling = new Decimal(extra?.cost ?? "0").mul(sellingFactor(p.snapshot.input,extra?.taxRate ?? "0")).mul(
      new Decimal(extra?.markup ?? "0").div(100).add(1),
    );
    const extraTax = extraSelling.mul(
      new Decimal(cashDeal(p.snapshot.input)?"0":extra?.taxRate ?? "0").div(100),
    );
    const m = (d: Decimal) =>
      d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    const subtotal = m(new Decimal(p.snapshot.subtotal).add(extraSelling));
    const tax10 = m(
      new Decimal(p.snapshot.solarTax).add(
        extra?.taxRate === "10" ? extraTax : 0,
      ),
    );
    const tax18 = m(
      new Decimal(p.snapshot.otherTax).add(
        extra?.taxRate === "18" ? extraTax : 0,
      ),
    );
    const lines = ["bess-only","direct-product"].includes(b.snapshot.survey.family) && p.snapshot.itemPricing ? p.snapshot.itemPricing.map((l:any)=>{
      const source=b.snapshot.lines.find((x:any)=>x.key===l.key);
      return {description:source.description,qty:source.qty,unit:source.unit,group:l.group,beforeTax:l.beforeTax,taxRate:l.taxRate};
    }) : detailed.lines.map((l, i) => ({
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      group: l.group,
      beforeTax: l.amount!,
      taxRate:
        i === detailed.lines.length - 1 && extra
          ? cashDeal(p.snapshot.input)?"0":extra.taxRate
          : p.snapshot.rows.find((r: any) => r.key === l.group).taxRate,
    }));
    // A discount entered on the quotation replaces the pricing snapshot's
    // discount. Keep that quote-level amount on the ordinary payable allocation
    // path; otherwise a v5 pricing allowance can be mistaken for the accepted
    // discount even though the saved quotation deliberately used a custom amount.
    const customQuoteDiscount = source.input?.discount !== undefined &&
      !new Decimal(source.input.discount).eq(p.snapshot.discount ?? "0");
    const beforeTaxDiscount=!customQuoteDiscount && p.snapshot.input.discountPercent!==undefined && (new Decimal(footer('Special Discount')??'0').gt(0)||p.snapshot.input.roundedTotal!==undefined);
    let allocation: ReturnType<typeof allocateDiscount>;
    if(source.discountPresentation==='included-in-selling-prices'){
      if(fingerprint(source.discountAllocation)!==fingerprint((detailed as any).discountAllocation))throw new HttpError(422,IPO_ALLOCATION_PENDING);
      // These accepted prices already contain the discount. The IPO must not
      // deduct it a second time when allocating revenue and applicable GST.
      if(["bess-only","direct-product"].includes(b.snapshot.survey.family)&&p.snapshot.itemPricing){
        for(const reduction of source.discountAllocation.lines){
          const members=lines.filter((line:any)=>line.group===reduction.group);
          const shares=distributeCents(new Decimal(reduction.beforeTaxReduction).mul(100),members.map((line:any)=>new Decimal(line.beforeTax)));
          members.forEach((line:any,index:number)=>{line.beforeTax=m(new Decimal(line.beforeTax).sub(shares[index].div(100)));});
        }
      }
      const amount=(label:string)=>detailed.footer.find(row=>row.label===label)?.amount??'0.00';
      const acceptedTotal=footer('Net Total')??footer('Total');
      if(detailed.footer.at(-1)!.amount!==acceptedTotal)throw new HttpError(422,IPO_ALLOCATION_PENDING);
      const acceptedTax=(rate:string)=>detailed.footer.filter(row=>new RegExp(`SALES TAX.*${rate}%`).test(row.label)).reduce((sum,row)=>sum.add(row.amount),new Decimal(0)).toFixed(2);
      allocation=allocateDiscount(lines,amount('Subtotal Before Tax'),acceptedTax('10'),acceptedTax('18'),'0.00',acceptedTotal,cashDeal(p.snapshot.input));
    }else if(source.discountAllocation?.policy===DISCOUNT_POLICY&&p.snapshot.discountStrategy?.version===DISCOUNT_POLICY){
      const accepted=allocateApprovedDiscount(p.snapshot.discountStrategy,source.discountAllocation.discount,p.snapshot.input.roundedTotal);
      const safe={...accepted,lines:accepted.lines.map(({cost,approvedAllowance,category,...line})=>line)};
      if(fingerprint(safe)!==fingerprint(source.discountAllocation)||accepted.total!==footer('Net Total'))throw new HttpError(422,'Saved accepted discount allocation does not reconcile with this quotation.');
      allocation={...accepted,lines:accepted.lines.map(line=>{
        const item=b.snapshot.lines.find((x:any)=>x.key===line.key);if(!item)throw new HttpError(422,'Accepted selling item is missing from the saved BOQ.');
        const phase=item.phase==='Solar Panels'?'Solar Panels':item.phase==='Structure'?'Structure':/^(HYB-|CH-PCS-)/.test(item.key)?'Inverter':/^(BAT-|CH-BAT-)/.test(item.key)?'Batteries':/^(BMS-|CH-BMS-)/.test(item.key)?'BMS':item.phase==='BESS'?'BESS':'EPC';
        const epcCategory=/^(electrical labour|labour)$/i.test(item.key)?'Electrical Labour':/^(delivery\/logistics|delivery|deliveries)$/i.test(item.key)?'Deliveries':item.epc==='Earthing Cost'?'Earthing Cost':'Installation Cost';
        const {cost,approvedAllowance,category,...selling}=line;
        return {...selling,description:item.description,qty:item.qty,unit:item.unit,phase,epcCategory,rate:new Decimal(item.qty).gt(0)?new Decimal(line.beforeTax).div(item.qty).toFixed(6):'0.000000'};
      })};
    }else{
    if(beforeTaxDiscount){
      // Existing accepted v4 quotations retain their original proportional contract.
      // Never retrofit the new two-layer policy into their immutable snapshots.
      if(p.snapshot.engineVersion!==4)throw new HttpError(422,IPO_ALLOCATION_PENDING);
      const original=quote({...p.snapshot,input:{...p.snapshot.input,presentation:'Full Breakup',taxMode:'Show Sales Tax Separately',roundedTotal:undefined}},b.snapshot,{pricingId:p.id,...source.input,discount:'0',additionalItem:extra});
      const accepted=discountedSellingReview(p.snapshot,source.input?.discount??footer('Special Discount')??'0');
      if(accepted.netTotal!==footer('Net Total'))throw new HttpError(422,IPO_ALLOCATION_PENDING);
      const originalLines=['bess-only','direct-product'].includes(b.snapshot.survey.family)&&p.snapshot.itemPricing?p.snapshot.itemPricing.map((l:any)=>{const item=b.snapshot.lines.find((x:any)=>x.key===l.key);return {description:item.description,qty:item.qty,unit:item.unit,group:l.group,beforeTax:l.beforeTax,taxRate:l.taxRate};}):original.lines.map(l=>({description:l.description,qty:l.qty,unit:l.unit,group:l.group,beforeTax:l.amount!,taxRate:p.snapshot.rows.find((r:any)=>r.key===l.group).taxRate}));
      try{allocation=allocateBeforeTaxDiscount(originalLines,subtotal,tax10,tax18,accepted.discount,footer('Net Total'),accepted.solarTax,accepted.otherTax);}catch(error){if(error instanceof HttpError&&error.status===422)throw new HttpError(422,IPO_ALLOCATION_PENDING);throw error;}
    }else{
    try { allocation = allocateDiscount(
      lines,
      subtotal,
      tax10,
      tax18,
      footer("Special Discount") ?? "0.00",
      footer("Net Total"),
      cashDeal(p.snapshot.input),
    ); } catch (error) {
      if (isPendingIpoAllocation(error)) throw new HttpError(422, IPO_ALLOCATION_PENDING);
      throw error;
    }
    }
    }
    const document = await this.checkDocument(c, actor, input.documentId);
    const snapshot = {
      engineVersion: 1,
      input,
      source: "Accepted quotation",
      quotationType:{presentation:p.snapshot.input.presentation,taxMode:p.snapshot.input.taxMode,saleType:p.snapshot.input.saleType,cashGstTreatment:p.snapshot.input.cashGstTreatment},
      dealAccounting:p.snapshot.dealAccounting,
      documentLayoutVersion:4,
      approvedPanelQty:b.snapshot.survey.panelQty,
      quotationId: q.id,
      quotationNumber: q.number,
      boqRevisionId: b.id,
      boqNumber: b.number,
      customer: source.customer,
      siteName: source.siteName,
      siteCode: source.siteCode,
      solutionId: source.solutionId,
      document,
      allocation,
      peachtree: peachtreeDivision(
        allocation,
        b.snapshot,
        p.snapshot,
        extra?.cost ?? "0",
      ),
    };
    const phaseSource=(name:string)=>b.snapshot.lines.filter((l:any)=>name === "Solar Panels"?l.phase === "Solar Panels":name === "Structure"?l.phase === "Structure":name === "Inverter"?l.key===b.snapshot.inverterConfig?.sku:name === "Batteries"?/^(BAT-|CH-BAT-)/.test(l.key):name === "BMS"?/^(BMS-|CH-BMS-)/.test(l.key):name === "BESS"?l.phase === "BESS":l.phase!=="Solar Panels"&&l.phase!=="Structure"&&l.phase!=="BESS");
    snapshot.peachtree.phases=snapshot.peachtree.phases.map(p=>({...p,description:p.name === "EPC"?"CH-EPC - Installation and balance of system":p.name === "Structure"?"CH-Structure - "+phaseSource(p.name).map((l:any)=>l.description).join("; "):phaseSource(p.name).map((l:any)=>`${l.qty} x ${l.itemId || l.description} (${l.specification || l.description})`).join("; ")}));
    snapshot.peachtree=ptDetail(snapshot,b.snapshot);
    return { snapshot, fingerprint: fingerprint(snapshot) };
  }
  async checkDocument(c: Pool | PoolClient, actor: string, id?: string) {
    if (!id) return null;
    const row = (
      await c.query(
        "SELECT id,filename,mime,sha256 FROM customer_po_documents WHERE id=$1 AND owner_id=$2",
        [id, actor],
      )
    ).rows[0];
    if (!row)
      throw new HttpError(
        403,
        "Upload your evidence document before using it in this order.",
      );
    return row;
  }
  async submit(
    actor: string,
    input: OrderInput,
    expected: string,
    key: string,
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019004)");
      const p = await this.preview(actor, input, c);
      if (p.fingerprint !== expected)
        throw new HttpError(
          409,
          "Review the current IPO preview before submitting.",
        );
      const old = (
        await c.query("SELECT * FROM ipo_submissions WHERE request_key=$1", [
          key,
        ])
      ).rows[0];
      if (old) {
        if (old.created_by !== actor || old.fingerprint !== expected)
          throw new HttpError(409, "Request key already used.");
        return old;
      }
      // Identical evidence/input is a repeated intake, even after a page reload
      // creates a fresh request key. Different orders/amendments retain distinct inputs.
      const duplicate=(await c.query("SELECT * FROM ipo_submissions WHERE created_by=$1 AND fingerprint=$2 ORDER BY created_at LIMIT 1",[actor,expected])).rows[0];
      if(duplicate)return duplicate;
      return (
        await c.query(
          "INSERT INTO ipo_submissions(id,input,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [randomUUID(), input, p.snapshot, p.fingerprint, key, actor],
        )
      ).rows[0];
    });
  }
  async submissions(actor: string) {
    return (
      await this.pool.query(
        "SELECT s.*,jsonb_build_object('presentation',p.snapshot->'input'->>'presentation','taxMode',p.snapshot->'input'->>'taxMode') AS \"quotationType\",u.display_name AS prepared_by,i.id AS ipo_id,i.number AS ipo_number FROM ipo_submissions s LEFT JOIN quotation_versions q ON q.id::text=s.input->>'quotationId' LEFT JOIN commercial_pricing_versions p ON p.id=q.pricing_id JOIN users u ON u.id=s.created_by LEFT JOIN internal_purchase_orders i ON i.submission_id=s.id WHERE (s.created_by=$1 OR EXISTS(SELECT 1 FROM users WHERE id=$1 AND active AND role IN('Admin','Management'))) AND NOT EXISTS(SELECT 1 FROM test_workflow_archives archived WHERE archived.key LIKE 'LOCAL-REVIEW-SAMPLES-%' AND archived.records->'localPreviewDocumentIds' ? s.id::text) ORDER BY s.created_at DESC LIMIT 200",
        [actor],
      )
    ).rows;
  }
  async approve(
    actor: string,
    id: string,
    key: string,
    external?: ExternalEvidence,
  ) {
    if (!external)
      await new CommercialRepository(this.pool).manager(
        this.pool,
        actor,
        false,
      );
    const s = (
      await this.pool.query("SELECT * FROM ipo_submissions WHERE id=$1", [id])
    ).rows[0];
    if (!s || (await archivedDocumentIds(this.pool)).has(id)) throw new HttpError(404, "IPO submission not found.");
    return this.save(
      actor,
      s.input,
      s.fingerprint,
      key,
      s.created_by,
      s.id,
      external,
    );
  }
  async save(
    actor: string,
    input: OrderInput,
    expected: string,
    key: string,
    owner = actor,
    submissionId?: string,
    external?: ExternalEvidence,
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019004)");
      if (external) {
        const submission = (
          await c.query("SELECT * FROM ipo_submissions WHERE id=$1", [
            submissionId,
          ])
        ).rows[0];
        if (
          !submission ||
          submission.created_by !== owner ||
          submission.fingerprint !== expected ||
          fingerprint(submission.input) !== fingerprint(input)
        )
          throw new HttpError(409, "Choose the exact submitted IPO.");
        await validateExternal(c, actor, owner, external);
      } else await new CommercialRepository(this.pool).manager(c, actor, false);
      const replay = (
        await c.query(
          "SELECT * FROM internal_purchase_orders WHERE request_key=$1",
          [key],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.created_by !== actor ||
          replay.fingerprint !== expected ||
          fingerprint(replay.snapshot.input) !== fingerprint(input)
        )
          throw new HttpError(
            409,
            "This request key was already used for another IPO.",
          );
        return replay;
      }
      const preview = await this.preview(owner, input, c);
      let legacySubmission = false;
      if (submissionId && preview.fingerprint !== expected) {
        const old = (
          await c.query(
            "SELECT snapshot FROM ipo_submissions WHERE id=$1 AND created_by=$2 AND fingerprint=$3",
            [submissionId, owner, expected],
          )
        ).rows[0];
        const { peachtree, ...withoutDivision } = preview.snapshot;
        legacySubmission = Boolean(
          old &&
          fingerprint(withoutDivision) ===
            fingerprint((({ peachtree, ...core }) => core)(old.snapshot)),
        );
      }
      if (preview.fingerprint !== expected && !legacySubmission)
        throw new HttpError(
          409,
          "Review the current IPO preview before saving.",
        );
      const existing = (
        await c.query(
          "SELECT * FROM internal_purchase_orders WHERE request_key=$1",
          [key],
        )
      ).rows[0];
      if (existing) {
        if (existing.created_by !== actor || existing.fingerprint !== expected)
          throw new HttpError(
            409,
            "This request key was already used for another IPO.",
          );
        return existing;
      }
      if (
        submissionId &&
        (
          await c.query(
            "SELECT 1 FROM internal_purchase_orders WHERE submission_id=$1",
            [submissionId],
          )
        ).rowCount
      )
        throw new HttpError(409, "This submission has already been approved.");
      const customerId = (
        await c.query(
          "SELECT snapshot->'survey'->>'customerId' AS customer_id FROM boq_revisions WHERE id=$1",
          [preview.snapshot.boqRevisionId],
        )
      ).rows[0].customer_id;
      if (
        input.evidenceType === "Customer PO" && input.poNumber && !/^n\/?a$/i.test(input.poNumber) &&
        (
          await c.query(
            "SELECT 1 FROM customer_purchase_orders WHERE customer_id=$1 AND po_number=$2",
            [customerId, input.poNumber],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "This customer PO reference has already been recorded.",
        );
      const poId = randomUUID(),
        id = randomUUID();
      await c.query(
        "INSERT INTO customer_purchase_orders(id,quotation_id,boq_revision_id,customer_id,po_number,document_id,input,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          poId,
          input.quotationId,
          preview.snapshot.boqRevisionId,
          customerId,
          input.evidenceType === "Customer PO" && !/^n\/?a$/i.test(input.poNumber) ? input.poNumber : "",
          input.documentId ?? null,
          input,
          actor,
        ],
      );
      const identity=await boqIdentity(c,preview.snapshot.boqRevisionId);
      const number=input.ipoNumber?await allocateEditableIpo(c,id,input.ipoNumber):await allocateReference(c,"IPO",id,identity.customer_id,identity.site_code);
      const row = (
        await c.query(
          "INSERT INTO internal_purchase_orders(id,customer_po_id,submission_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            id,
            poId,
            submissionId ?? null,
            number,
            {
              ...preview.snapshot,
              approvalChannel: external ? external.channel : "In app",
              claimedApprover: external?.approver,
              checkedBy: (
                await c.query("SELECT display_name FROM users WHERE id=$1", [
                  actor,
                ])
              ).rows[0].display_name,
              preparedBy: (
                await c.query("SELECT display_name FROM users WHERE id=$1", [
                  owner,
                ])
              ).rows[0].display_name,
            },
            expected,
            key,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `ipo.issue:${id}:quotation:${input.quotationId}:po:${poId}`,
      ]);
      await queueIssuedPo(c,actor,row,input.documentId);
      if (external)
        await recordExternal(c, actor, null, submissionId!, external);
      return row;
    });
  }
  async list(actor?: string) {
    const rows = (
      await this.pool.query(
        `SELECT i.id,i.number,i.created_at,i.snapshot->>'quotationNumber' AS quotation_number,i.snapshot->'input'->>'poNumber' AS po_number,i.snapshot->'customer'->>'name' AS customer,i.snapshot->'allocation'->>'total' AS total,(SELECT jsonb_build_object('decision',r.decision,'notes',r.notes) FROM accounts_ipo_reviews r WHERE r.ipo_id=i.id ORDER BY r.version DESC LIMIT 1) AS accounts_review FROM internal_purchase_orders i ${actor ? `WHERE ${ownedCondition("ipo", "i.id", "$1")}` : "WHERE true"} AND i.snapshot#>>'{historicalImport,hideFromIpoShared}' IS DISTINCT FROM 'true' AND NOT EXISTS(SELECT 1 FROM test_workflow_archives archived WHERE archived.key LIKE 'LOCAL-REVIEW-SAMPLES-%' AND archived.records->'localPreviewDocumentIds' ? i.id::text) ORDER BY i.created_at DESC LIMIT 200`,
        actor ? [actor] : [],
      )
    ).rows;
    const types = await this.quotationTypes(rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, quotationType: types.get(r.id) }));
  }
  async sendToAccounts(actor: string, id: string) {
    return transaction(this.pool, async (c) => {
      const user = (
        await c.query("SELECT active,role FROM users WHERE id=$1 FOR SHARE", [
          actor,
        ])
      ).rows[0];
      if (!user?.active) throw new HttpError(401, "Your access has ended.");
      if (!["Admin", "Management", "Coordinator"].includes(user.role))
        throw new HttpError(403, "Coordinator or management access required.");
      const ipo = (
        await c.query(
          "SELECT i.*,s.created_by AS prepared_by FROM internal_purchase_orders i LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE i.id=$1 FOR UPDATE OF i",
          [id],
        )
      ).rows[0];
      if (!ipo) throw new HttpError(404, "Approved IPO not found.");
      if (
        user.role === "Coordinator" &&
        ipo.prepared_by !== actor &&
        ipo.created_by !== actor
      )
        throw new HttpError(
          403,
          "You can send only your own IPOs to Accounts.",
        );
      const existing = (
        await c.query("SELECT * FROM ipo_accounts_handoffs WHERE ipo_id=$1", [
          id,
        ])
      ).rows[0];
      if (existing) return existing;
      const row = (
        await c.query(
          "INSERT INTO ipo_accounts_handoffs(id,ipo_id,created_by) VALUES($1,$2,$3) RETURNING *",
          [randomUUID(), id, actor],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `ipo.accounts.sent:${id}`,
      ]);
      await queueSharedIpo(c,actor,ipo);
      return row;
    });
  }
  async get(id: string) {
    const row = (
      await this.pool.query(
        "SELECT * FROM internal_purchase_orders WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "IPO not found.");
    const identity = await ipoSiteIdentity(this.pool, row);
    return {
      ...row,
      ...identity,
      quotationType: (await this.quotationTypes([row.id])).get(row.id),
      external_approval:
        (
          await this.pool.query(
            "SELECT a.*, (SELECT display_name FROM users WHERE id=a.recorded_by) AS recorded_by_name, (SELECT jsonb_agg(jsonb_build_object('id',u.id,'filename',u.filename)) FROM external_document_approval_files f JOIN survey_uploads u ON u.id=f.upload_id WHERE f.approval_id=a.id) AS evidence FROM external_document_approvals a WHERE a.submission_id=$1",
            [row.submission_id],
          )
        ).rows[0] ?? null,
      operations_handoff:(await this.pool.query("SELECT o.id,o.number,o.created_at,u.display_name AS sent_by FROM operations_boq_issuances o JOIN users u ON u.id=o.created_by WHERE o.ipo_id=$1",[id])).rows[0]??null,
      accounts_handoff:
        (
          await this.pool.query(
            "SELECT h.*,u.display_name AS sent_by FROM ipo_accounts_handoffs h JOIN users u ON u.id=h.created_by WHERE h.ipo_id=$1",
            [id],
          )
        ).rows[0] ?? null,
    };
  }
  async peachtree(id: string) {
    const row = await this.get(id);
    return { row, division: await this.divisionForSnapshot(row.snapshot) };
  }
  async divisionForSnapshot(snapshot: any) {
    if (snapshot.peachtree) return snapshot.peachtree;
    // Recover the exact archived PT pack when a legacy caller omits its embedded division.
    const archived=(await this.pool.query("SELECT snapshot->'peachtree' AS division FROM internal_purchase_orders WHERE snapshot->>'quotationId'=$1 AND snapshot->'allocation'=$2::jsonb AND snapshot->'input'=$3::jsonb AND snapshot->'peachtree' IS NOT NULL ORDER BY created_at LIMIT 1",[snapshot.quotationId,JSON.stringify(snapshot.allocation),JSON.stringify(snapshot.input)])).rows[0];
    if(archived?.division)return archived.division;
    // Earlier IPOs retain their snapshots. Version-1 report derivation uses only
    // their immutable costing/pricing links, never today's master data.
    const b = (
      await this.pool.query("SELECT snapshot FROM boq_revisions WHERE id=$1", [
        snapshot.boqRevisionId,
      ])
    ).rows[0];
    const p = (
      await this.pool.query(
        "SELECT p.snapshot FROM commercial_pricing_versions p JOIN quotation_versions q ON q.pricing_id=p.id WHERE q.id=$1",
        [snapshot.quotationId],
      )
    ).rows[0];
    const extra = (
      await this.pool.query(
        "SELECT input FROM quotation_additional_inputs WHERE quotation_id=$1",
        [snapshot.quotationId],
      )
    ).rows[0]?.input;
    if (!b || !p)
      throw new HttpError(
        422,
        "The original costing or pricing record is missing.",
      );
    return peachtreeDivision(
      snapshot.allocation,
      b.snapshot,
      p.snapshot,
      extra?.cost ?? "0",
    );
  }
  async upload(actor: string, filename: string, mime: string, bytes: Buffer) {
    const id = randomUUID(),
      hash = createHash("sha256").update(bytes).digest("hex");
    await this.pool.query(
      "INSERT INTO customer_po_documents(id,owner_id,filename,mime,sha256,content) VALUES($1,$2,$3,$4,$5,$6)",
      [id, actor, filename, mime, hash, bytes],
    );
    return { id, filename, mime, sha256: hash };
  }
  async document(actor: string, id: string) {
    const row = (
      await this.pool.query(
        "SELECT * FROM customer_po_documents d WHERE d.id=$1 AND (d.owner_id=$2 OR EXISTS(SELECT 1 FROM customer_purchase_orders p WHERE p.document_id=d.id AND (p.created_by=$2 OR EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')) OR EXISTS(SELECT 1 FROM internal_purchase_orders i JOIN ipo_accounts_handoffs h ON h.ipo_id=i.id JOIN users u ON u.id=$2 AND u.active AND u.role='Accounts' WHERE i.customer_po_id=p.id))) OR (EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')) AND EXISTS(SELECT 1 FROM ipo_submissions s WHERE s.input->>'documentId'=d.id::text)))",
        [id, actor],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "PO document not found.");
    return row;
  }
}
