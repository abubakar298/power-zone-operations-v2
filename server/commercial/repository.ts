import {cashDeal} from "./deal.js";
import { allocateReference, revisedReference, boqIdentity } from "../documents/references.js";
import {
  managementReview,
  type ReviewAdjustment,
} from "./management-review.js";
import {
  commercialPolicySchema,
  type CommercialPolicy,
} from "./active-policy.js";
import { ownedCondition } from "../http/permissions.js";
import { workflowHistory } from "../boq/workflow-history.js";
import { Decimal } from "decimal.js";
import {managementReviewV5} from './management-review-v5.js';
import { allocateDiscount } from "../orders/allocation.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { fingerprint } from "../boq/repository.js";
import { price, quote, quotationLines } from "./engine.js";
import type { PricingInput, QuotationInput } from "./schema.js";
export class CommercialRepository {
  constructor(private pool: Pool) {}
  async revisionRequests(actor: string) {
    return (
      await this.pool.query(
        "SELECT q.*,v.number AS source_number,v.pricing_id AS source_pricing_id,v.boq_revision_id AS source_boq_id,f.revision_id AS approved_revision_id,l.quotation_id AS completed_quotation_id FROM quotation_revision_requests q JOIN quotation_versions v ON v.id=q.source_quotation_id LEFT JOIN boq_draft_finalizations f ON f.draft_id=q.draft_id LEFT JOIN quotation_revision_links l ON l.request_id=q.id WHERE q.created_by=$1 OR EXISTS(SELECT 1 FROM users WHERE id=$1 AND active AND role IN('Admin','Management')) ORDER BY q.created_at DESC LIMIT 200",
        [actor],
      )
    ).rows;
  }
  async revisionStart(
    actor: string,
    sourceId: string,
    origin: string,
    costingChange: boolean,
    reason: string,
    requestedBy: string,
    key: string,
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019003)");
      const user = (
        await c.query(
          "SELECT active,role,display_name FROM users WHERE id=$1 FOR SHARE",
          [actor],
        )
      ).rows[0];
      if (!user?.active) throw new HttpError(401, "Your access has ended.");
      if (!costingChange) await this.manager(c, actor);
      const previous = (
        await c.query(
          "SELECT * FROM quotation_revision_requests WHERE request_key=$1",
          [key],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.created_by !== actor ||
          previous.source_quotation_id !== sourceId ||
          previous.origin !== origin ||
          previous.costing_change !== costingChange ||
          previous.reason !== reason ||
          previous.requested_by !== requestedBy
        )
          throw new HttpError(
            409,
            "This request key was already used for another revision.",
          );
        return previous;
      }
      const source = (
        await c.query("SELECT * FROM quotation_versions WHERE id=$1", [
          sourceId,
        ])
      ).rows[0];
      if (!source) throw new HttpError(404, "Quotation not found.");
      const status=(await c.query('SELECT kind FROM coordination_events WHERE quotation_id=$1 ORDER BY created_at DESC LIMIT 1',[sourceId])).rows[0]?.kind;
      if(status==='Submitted'&&!['Admin','Management'].includes(user.role))throw new HttpError(403,'This quotation is with Management. Only Management can return it for revision.');
      let draftId: string | null = null;
      if (costingChange) {
        const latest = (
          await c.query(
            "SELECT r.* FROM boq_revisions r WHERE r.id=$1",
            [source.boq_revision_id],
          )
        ).rows[0];
        draftId = randomUUID();
        const survey = {
          ...latest.snapshot.survey,
          preparedBy: user.display_name,
        };
        const extra = (
          await c.query(
            "SELECT input FROM quotation_additional_inputs WHERE quotation_id=$1",
            [sourceId],
          )
        ).rows[0]?.input;
        if (extra && !survey.additionalItem)
          survey.additionalItem = {
            description: extra.description,
            specification: "",
            qty: "1",
            unit: "LS",
            unitCost: extra.cost,
            taxRate: extra.taxRate,
          };
        await c.query(
          "INSERT INTO survey_drafts(id,owner_id,inputs,base_revision_id,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,$6)",
          [draftId, actor, survey, latest.id, reason, origin],
        );
      }
      const request = (
        await c.query(
          "INSERT INTO quotation_revision_requests(id,source_quotation_id,origin,costing_change,reason,requested_by,created_by,draft_id,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            randomUUID(),
            sourceId,
            origin,
            costingChange,
            reason,
            requestedBy,
            actor,
            draftId,
            key,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `quotation.revision.${request.id}.${costingChange ? "costing" : "commercial"}.requested`,
      ]);
      return request;
    });
  }
  async revisionContext(actor: string, boqId: string) {
    await this.manager(this.pool, actor);
    const row = (
      await this.pool.query(
        "SELECT q.*,p.snapshot->'input' AS pricing_input,p.snapshot->'rows' AS pricing_rows,p.snapshot->'policy' AS pricing_policy FROM quotation_revision_requests q JOIN boq_draft_finalizations f ON f.draft_id=q.draft_id JOIN quotation_versions v ON v.id=q.source_quotation_id JOIN commercial_pricing_versions p ON p.id=v.pricing_id WHERE f.revision_id=$1",
        [boqId],
      )
    ).rows[0];
    if (row) {
      const extra = (
        await this.pool.query(
          "SELECT input FROM quotation_additional_inputs WHERE quotation_id=$1",
          [row.source_quotation_id],
        )
      ).rows[0]?.input;
      if (!row.pricing_policy) for (const r of row.pricing_rows)
        if (r.key !== "additional") row.pricing_input.markups[r.key] = r.markup;
      delete row.pricing_rows;
      delete row.pricing_policy;
      if (extra) row.pricing_input.additionalMarkup = extra.markup;
    }
    return row ?? null;
  }
  async revisionValidate(
    c: Pool | PoolClient,
    requestId: string,
    boqId: string,
  ) {
    const request = (
      await c.query(
        "SELECT q.*,v.snapshot AS source_snapshot,v.number AS source_number,v.boq_revision_id AS source_boq_id FROM quotation_revision_requests q JOIN quotation_versions v ON v.id=q.source_quotation_id WHERE q.id=$1",
        [requestId],
      )
    ).rows[0];
    if (!request) throw new HttpError(404, "Revision request not found.");
    if (request.costing_change) {
      const approved = (
        await c.query(
          "SELECT revision_id FROM boq_draft_finalizations WHERE draft_id=$1",
          [request.draft_id],
        )
      ).rows[0];
      if (!approved || approved.revision_id !== boqId)
        throw new HttpError(
          409,
          "Approve the requested BOQ revision before preparing its revised quotation.",
        );
    } else if (boqId !== request.source_boq_id)
      throw new HttpError(
        409,
        "A commercial revision must retain its original BOQ costing.",
      );
    return request;
  }
  async requireCostingContext(
    c: Pool | PoolClient,
    boqId: string,
    requestId?: string,
  ) {
    const row = (
      await c.query(
        "SELECT q.id FROM quotation_revision_requests q JOIN boq_draft_finalizations f ON f.draft_id=q.draft_id WHERE f.revision_id=$1",
        [boqId],
      )
    ).rows[0];
    if (row && !requestId)
      throw new HttpError(
        409,
        "Use the revision request linked to this approved costing.",
      );
  }
  async manager(c: Pool | PoolClient, id: string, commercial = true) {
    const user = (
      await c.query(
        "SELECT active,role FROM users WHERE id=$1" +
          ("release" in c ? " FOR SHARE" : ""),
        [id],
      )
    ).rows[0];
    if (!user?.active) throw new HttpError(401, "Your access has ended.");
    if (
      !(
        commercial
          ? ["Admin", "Management", "Coordinator"]
          : ["Admin", "Management"]
      ).includes(user.role)
    )
      throw new HttpError(
        403,
        commercial
          ? "Commercial preparation access required."
          : "Management approval required.",
      );
  }
  async boq(c: Pool | PoolClient, id: string) {
    const r = (await c.query("SELECT * FROM boq_revisions WHERE id=$1", [id]))
      .rows[0];
    if (!r) throw new HttpError(404, "Approved BOQ revision not found.");
    return r;
  }
  async standardPolicy(
    actor: string,
    c: Pool | PoolClient = this.pool,
  ): Promise<CommercialPolicy> {
    await this.manager(c, actor);
    const row = (
      await c.query(
        "SELECT version,policy FROM standard_commercial_policy_versions ORDER BY version DESC LIMIT 1",
      )
    ).rows[0];
    if (!row)
      throw new HttpError(
        422,
        "Standard Commercial Policy is missing. Ask Management to configure it.",
      );
    return {
      ...commercialPolicySchema.parse(row.policy),
      version: row.version,
    };
  }
  async saveStandardPolicy(
    actor: string,
    raw: unknown,
    expectedVersion: number,
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019003)");
      await this.manager(c, actor, false);
      const current = await this.standardPolicy(actor, c);
      if (current.version !== expectedVersion)
        throw new HttpError(
          409,
          "Policy changed. Refresh before publishing a new version.",
        );
      const policy = commercialPolicySchema.parse(raw);
      const version = current.version + 1;
      await c.query(
        "INSERT INTO standard_commercial_policy_versions(version,policy,created_by) VALUES($1,$2,$3)",
        [version, policy, actor],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `commercial.policy.v${version}.published`,
      ]);
      return { ...policy, version };
    });
  }
  async pricingAttribution(c:Pool|PoolClient,actor:string,input:PricingInput){
    const user=(await c.query('SELECT display_name,role FROM users WHERE id=$1',[actor])).rows[0];
    const files=input.discountApprovalEvidence??[];
    if(!files.length)return {...input,preparedBy:user.display_name};
    const rows=(await c.query("SELECT id,filename FROM survey_uploads WHERE id=ANY($1::uuid[]) AND (owner_id=$2 OR $3)",[files.map(file=>file.id),actor,['Admin','Management'].includes(user.role)])).rows;
    if(rows.length!==new Set(files.map(file=>file.id)).size)throw new HttpError(403,'Discount approval evidence is unavailable to your account.');
    return {...input,preparedBy:user.display_name,discountApprovalEvidence:files.map(file=>rows.find(row=>row.id===file.id))};
  }
  async pricingPreview(actor: string, input: PricingInput) {
    await this.manager(this.pool, actor);
    input=await this.pricingAttribution(this.pool,actor,input);
    await this.requireCostingContext(
      this.pool,
      input.boqRevisionId,
      input.revisionRequestId,
    );
    if (input.revisionRequestId)
      await this.revisionValidate(
        this.pool,
        input.revisionRequestId,
        input.boqRevisionId,
      );
    const contract=(await this.pool.query("SELECT version,contract FROM document_commercial_contract_versions ORDER BY version DESC LIMIT 1")).rows[0];
    const b = await this.boq(this.pool, input.boqRevisionId),
      snapshot = price(
        b.snapshot,
        b.number,
        input,
        await this.standardPolicy(actor),
      );
    Object.assign(snapshot,{documentCommercialContract:contract});
    return { snapshot, fingerprint: fingerprint(snapshot) };
  }
  async pricingList(actor: string) {
    await this.manager(this.pool, actor);
    return (
      await this.pool.query(
        `SELECT p.id,p.number,p.version,p.boq_revision_id,p.created_at,p.snapshot->>'boqNumber' AS boq_number,p.snapshot->>'netTotal' AS total FROM commercial_pricing_versions p WHERE ${ownedCondition("pricing", "p.id", "$1")} AND NOT EXISTS(SELECT 1 FROM test_workflow_archives archived WHERE archived.key LIKE 'LOCAL-REVIEW-SAMPLES-%' AND archived.records->'localPreviewDocumentIds' ? p.id::text) ORDER BY p.created_at DESC LIMIT 200`,
        [actor],
      )
    ).rows;
  }
  async pricingGet(
    actor: string,
    id: string,
    c: Pool | PoolClient = this.pool,
  ) {
    await this.manager(c, actor);
    const p = (
      await c.query("SELECT * FROM commercial_pricing_versions WHERE id=$1", [
        id,
      ])
    ).rows[0];
    if (!p) throw new HttpError(404, "Saved pricing not found.");
    return p;
  }
  async pricingSave(
    actor: string,
    input: PricingInput,
    expected: string,
    key: string,
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019003)");
      await this.manager(c, actor);
      input=await this.pricingAttribution(c,actor,input);
      await this.requireCostingContext(
        c,
        input.boqRevisionId,
        input.revisionRequestId,
      );
      if (input.revisionRequestId)
        await this.revisionValidate(
          c,
          input.revisionRequestId,
          input.boqRevisionId,
        );
      const b = await this.boq(c, input.boqRevisionId),
        snapshot = price(
          b.snapshot,
          b.number,
          input,
          await this.standardPolicy(actor, c),
        ),
        contract=(await c.query("SELECT version,contract FROM document_commercial_contract_versions ORDER BY version DESC LIMIT 1")).rows[0],
        fp = fingerprint(Object.assign(snapshot,{documentCommercialContract:contract}));
      if (fp !== expected)
        throw new HttpError(409, "Preview the current pricing before saving.");
      const old = (
        await c.query(
          "SELECT * FROM commercial_pricing_versions WHERE request_key=$1",
          [key],
        )
      ).rows[0];
      if (old) {
        if (old.created_by !== actor || old.fingerprint !== fp)
          throw new HttpError(
            409,
            "This save request was already used for different pricing.",
          );
        return old;
      }
      const version = Number(
        (
          await c.query(
            "SELECT COALESCE(max(version),0)+1 AS version FROM commercial_pricing_versions WHERE boq_revision_id=$1",
            [b.id],
          )
        ).rows[0].version,
      );
      const row = (
        await c.query(
          "INSERT INTO commercial_pricing_versions(id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            b.id,
            version,
            `CP-${b.number}-V${version}`,
            snapshot,
            fp,
            key,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `commercial.${row.number}.saved`,
      ]);
      return row;
    });
  }
  async quotationPreview(
    actor: string,
    input: QuotationInput,
    c: Pool | PoolClient = this.pool,
    allowExisting = false,
  ) {
    if(input.revisionRequestId && input.discount===undefined){
      const prior=(await c.query("SELECT v.snapshot FROM quotation_revision_requests r JOIN quotation_versions v ON v.id=r.source_quotation_id WHERE r.id=$1",[input.revisionRequestId])).rows[0];
      if(prior) input={...input,discount:prior.snapshot.footer.find((r:any)=>r.label==="Special Discount")?.amount??"0"};
    }
    const p = input.previewPricing?{boq_revision_id:input.previewPricing.boqRevisionId,snapshot:(await this.pricingPreview(actor,input.previewPricing)).snapshot}:await this.pricingGet(actor, input.pricingId, c),
      b = await this.boq(c, p.boq_revision_id),
      customer = (
        await c.query(
          "SELECT contact_person,phone FROM customers WHERE id=$1",
          [p.snapshot.customer.id],
        )
      ).rows[0],
      wording = (
        await c.query(
          "SELECT description FROM quotation_description_defaults WHERE key='bms'",
        )
      ).rows[0]?.description,
      cableRates = (
        await c.query(
          "SELECT DISTINCT ON(key) key,rate FROM rate_versions WHERE key=ANY($1::text[]) ORDER BY key,version DESC",
          [
            b.snapshot.lines
              .filter((l: any) => /^(m|MTRS)$/i.test(l.unit))
              .map((l: any) => l.key),
          ],
        )
      ).rows,
      snapshot = quote(
        p.snapshot,
        b.snapshot,
        input,
        wording,
        Object.fromEntries(
          cableRates
            .filter((r: any) => r.rate !== null)
            .map((r: any) => [r.key, r.rate]),
        ),
      );
    await this.requireCostingContext(c, b.id, input.revisionRequestId);
    if (
      !input.revisionRequestId &&
      !allowExisting &&
      (
        await c.query(
          "SELECT 1 FROM quotation_versions WHERE boq_revision_id=$1 LIMIT 1",
          [b.id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Choose whether the requested revision needs costing changes before preparing another quotation.",
      );
    if (input.revisionRequestId) {
      const revision = await this.revisionValidate(
        c,
        input.revisionRequestId,
        b.id,
      );
      if (!revision.costing_change) {
        const old = revision.source_snapshot;
        const oldCanonical = quotationLines(
          b.snapshot,
          wording,
          old.presentation === "Full Breakup",
        );
        const expected = quotationLines(
          b.snapshot,
          wording,
          snapshot.presentation === "Full Breakup",
        );
        expected.forEach((l) => {
          const index = oldCanonical.findIndex(
            (x) => x.description === l.description,
          );
          if (index >= 0) l.description = old.lines[index].description;
        });
        if (!input.descriptions)
          snapshot.lines
            .slice(0, snapshot.scopeCount)
            .forEach((l, i) => (l.description = expected[i].description));
        if (
          JSON.stringify(
            snapshot.lines
              .slice(0, snapshot.scopeCount)
              .map((l) => l.description),
          ) !== JSON.stringify(expected.map((l) => l.description))
        )
          throw new HttpError(
            409,
            "Technical description changes require a BOQ revision first.",
          );
        const oldExtra = (
          await c.query(
            "SELECT input FROM quotation_additional_inputs WHERE quotation_id=$1",
            [revision.source_quotation_id],
          )
        ).rows[0]?.input;
        if (
          !!input.additionalItem !== !!oldExtra ||
          (oldExtra &&
            (input.additionalItem!.cost !== oldExtra.cost ||
              input.additionalItem!.description !== oldExtra.description))
        )
          throw new HttpError(
            409,
            "Additional-item costing changes require a BOQ revision first.",
          );
      }
      Object.assign(snapshot, {
        revision: {
          requestId: revision.id,
          origin: revision.origin,
          reason: revision.reason,
          requestedBy: revision.requested_by,
          sourceQuotation: revision.source_number,
          costingChanged: revision.costing_change,
          comparison: {
            previousPayable: revision.source_snapshot.footer.find((r:any)=>r.label==="Net Total")?.amount,
            proposedPayable: snapshot.footer.find((r:any)=>r.label==="Net Total")?.amount,
            previousDiscount: revision.source_snapshot.input.discount??"0",
            proposedDiscount: snapshot.input.discount,
            previousFormat: revision.source_snapshot.presentation,
            proposedFormat: snapshot.presentation,
            previousTax: revision.source_snapshot.footer.some((r:any)=>r.label==="Total")?"Tax Included":"Show Sales Tax Separately",
            proposedTax: p.snapshot.input.taxMode,
          },
        },
      });
    }
    snapshot.customer = {
      ...snapshot.customer,
      contactPerson: customer?.contact_person ?? "",
      phone: customer?.phone ?? "",
    };
    return {
      snapshot,
      fingerprint: input.additionalItem
        ? fingerprint({ snapshot, additionalItem: input.additionalItem })
        : fingerprint(snapshot),
      boqRevisionId: b.id,
    };
  }
  async quotationSave(
    actor: string,
    input: QuotationInput,
    expected: string,
    key: string,
  ) {
    if(input.previewPricing)throw new HttpError(422,'Record pricing only when sending the reviewed quotation to Management.');
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019003)");
      const replay = (
        await c.query("SELECT 1 FROM quotation_versions WHERE request_key=$1", [
          key,
        ])
      ).rowCount;
      const preview = await this.quotationPreview(actor, input, c, !!replay);
      if (preview.fingerprint !== expected)
        throw new HttpError(409, "Preview this quotation before saving.");
      const old = (
        await c.query("SELECT * FROM quotation_versions WHERE request_key=$1", [
          key,
        ])
      ).rows[0];
      if (old) {
        if (
          old.created_by !== actor ||
          old.pricing_id !== input.pricingId ||
          old.fingerprint !== expected
        )
          throw new HttpError(
            409,
            "This save request was already used for another quotation.",
          );
        return old;
      }
      const comparison=(preview.snapshot as any).revision?.comparison;
      if(comparison?.previousPayable && !new Decimal(comparison.previousPayable).eq(comparison.proposedPayable) && !input.acknowledgePriceChange)
        throw new HttpError(409,"Acknowledge the previous and proposed payable change before saving this revision.");
      if (
        input.revisionRequestId &&
        (
          await c.query(
            "SELECT 1 FROM quotation_revision_links WHERE request_id=$1",
            [input.revisionRequestId],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "This revision request has already produced a quotation. Start a new revision request.",
        );
      const version = Number(
          (
            await c.query(
              "SELECT COALESCE(max(version),0)+1 AS version FROM quotation_versions WHERE boq_revision_id=$1",
              [preview.boqRevisionId],
            )
          ).rows[0].version,
        ),
        identity = await boqIdentity(c,preview.boqRevisionId),
        revision = Number((await c.query("SELECT count(*)::integer AS n FROM quotation_versions q JOIN boq_revisions r ON r.id=q.boq_revision_id WHERE r.boq_id=$1",[identity.family_id])).rows[0].n)+1,
        number = revisedReference(await allocateReference(c,"QT",identity.family_id,identity.customer_id,identity.site_code),revision);
      const row = (
        await c.query(
          "INSERT INTO quotation_versions(id,pricing_id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            randomUUID(),
            input.pricingId,
            preview.boqRevisionId,
            version,
            number,
            preview.snapshot,
            preview.fingerprint,
            key,
            actor,
          ],
        )
      ).rows[0];
      if (input.additionalItem)
        await c.query(
          "INSERT INTO quotation_additional_inputs(quotation_id,input) VALUES($1,$2)",
          [row.id, input.additionalItem],
        );
      if (input.revisionRequestId)
        await c.query(
          "INSERT INTO quotation_revision_links(quotation_id,request_id) VALUES($1,$2)",
          [row.id, input.revisionRequestId],
        );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `quotation.${number}.saved`,
      ]);
      return row;
    });
  }
  async managementFinalQuotation(actor:string,id:string,discount:string,notes:string,acknowledgePriceChange=false){
    await this.manager(this.pool,actor,false);
    await this.discountReview(actor,id,{discount});
    const newId=await transaction(this.pool,async c=>{
      await c.query("SELECT pg_advisory_xact_lock(742019003)");
      await this.manager(c,actor,false);
      const q=(await c.query("SELECT * FROM quotation_versions WHERE id=$1 FOR UPDATE",[id])).rows[0];
      if(!q)throw new HttpError(404,"Quotation not found.");
      const latest=(await c.query("SELECT id,version FROM quotation_versions WHERE boq_revision_id=$1 ORDER BY version DESC LIMIT 1",[q.boq_revision_id])).rows[0];
      const event=(await c.query("SELECT kind FROM coordination_events WHERE quotation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[id])).rows[0];
      if(latest.id!==id||event?.kind!=="Submitted")throw new HttpError(409,"Only the latest quotation awaiting approval can be finalized.");
      const snapshot=JSON.parse(JSON.stringify(q.snapshot));
      const net=snapshot.footer.find((r:any)=>r.label==="Net Total");
      const old=snapshot.footer.find((r:any)=>r.label==="Special Discount");
      net.amount=new Decimal(net.amount).add(old.amount).sub(discount).toFixed(2);old.amount=new Decimal(discount).toFixed(2);snapshot.input.discount=old.amount;
      const comparison=snapshot.revision?.comparison;
      if(comparison){
        comparison.proposedPayable=net.amount;
        comparison.proposedDiscount=old.amount;
        if(comparison.previousPayable && !new Decimal(comparison.previousPayable).eq(net.amount) && !acknowledgePriceChange)
          throw new HttpError(409,"Review and acknowledge the change in payable before final approval.");
      }
      snapshot.managementAdjustment={sourceQuotationId:id,remarks:notes};
      const next=randomUUID(),version=Number(latest.version)+1;
      const identity=await boqIdentity(c,q.boq_revision_id);
      const revision=Number((await c.query("SELECT count(*)::integer AS n FROM quotation_versions v JOIN boq_revisions r ON r.id=v.boq_revision_id WHERE r.boq_id=$1",[identity.family_id])).rows[0].n)+1;
      const number=revisedReference(await allocateReference(c,"QT",identity.family_id,identity.customer_id,identity.site_code),revision);
      await c.query("INSERT INTO quotation_versions(id,pricing_id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[next,q.pricing_id,q.boq_revision_id,version,number,snapshot,fingerprint(snapshot),randomUUID(),actor]);
      await c.query("INSERT INTO quotation_additional_inputs(quotation_id,input) SELECT $1,input FROM quotation_additional_inputs WHERE quotation_id=$2",[next,id]);
      for(const kind of ["Submitted","Approved"])await c.query("INSERT INTO coordination_events(id,quotation_id,kind,notes,created_by,created_at) VALUES($1,$2,$3,$4,$5,now()+CASE WHEN $3='Approved' THEN interval '1 microsecond' ELSE interval '0 seconds' END)",[randomUUID(),next,kind,notes,actor]);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)",[actor,`quotation.${number}.management-created-and-approved.from.${q.number}`]);
      return next;
    });
    return this.quotationGet(newId);
  }
  async quotationList(actor?: string) {
    return (
      await this.pool.query(
        `SELECT q.id,q.number,q.version,q.pricing_id,q.boq_revision_id,q.created_at,(SELECT e.kind FROM coordination_events e WHERE e.quotation_id=q.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS workflow_status,NOT EXISTS(SELECT 1 FROM quotation_versions n WHERE n.boq_revision_id=q.boq_revision_id AND n.version>q.version) AS workflow_latest,EXISTS(SELECT 1 FROM quotation_revision_requests r WHERE r.source_quotation_id=q.id) AS revision_requested,q.snapshot->>'boqNumber' AS boq_number,q.snapshot->'customer'->>'name' AS customer,q.snapshot->>'siteName' AS site FROM quotation_versions q ${actor ? `WHERE ${ownedCondition("quotation", "q.id", "$1")}` : "WHERE true"} AND NOT EXISTS(SELECT 1 FROM test_workflow_archives archived WHERE archived.key LIKE 'LOCAL-REVIEW-SAMPLES-%' AND archived.records->'localPreviewDocumentIds' ? q.id::text) ORDER BY q.created_at DESC LIMIT 200`,
        actor ? [actor] : [],
      )
    ).rows;
  }
  async quotationGet(id: string) {
    const row = (
      await this.pool.query(
        "SELECT q.*, (SELECT e.kind FROM coordination_events e WHERE e.quotation_id=q.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS workflow_status, (SELECT e.notes FROM coordination_events e WHERE e.quotation_id=q.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS workflow_notes, NOT EXISTS(SELECT 1 FROM quotation_versions n WHERE n.boq_revision_id=q.boq_revision_id AND n.version>q.version) AS workflow_latest FROM quotation_versions q WHERE q.id=$1",
        [id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Quotation not found.");
    row.external_approval =
      (
        await this.pool.query(
          "SELECT a.*, (SELECT display_name FROM users WHERE id=a.recorded_by) AS recorded_by_name, (SELECT jsonb_agg(jsonb_build_object('id',u.id,'filename',u.filename)) FROM external_document_approval_files f JOIN survey_uploads u ON u.id=f.upload_id WHERE f.approval_id=a.id) AS evidence FROM external_document_approvals a WHERE a.quotation_id=$1",
          [id],
        )
      ).rows[0] ?? null;
    row.workflow_history = await workflowHistory(
      this.pool,
      row.boq_revision_id,
    );
    return row;
  }
  async quotationVariants(actor: string, id: string) {
    await this.manager(this.pool, actor);
    const q = await this.quotationGet(id);
    const p = await this.pricingGet(actor, q.pricing_id);
    const b = (
      await this.pool.query("SELECT snapshot FROM boq_revisions WHERE id=$1", [
        q.boq_revision_id,
      ])
    ).rows[0];
    const extra = await this.additionalInput(actor, id);
    const variants = [];
    for (const presentation of [
      "No Breakup",
      "Basic Breakup",
      "Full Breakup",
    ] as const) {
      for (const taxMode of [
        "Tax Included",
        "Show Sales Tax Separately",
      ] as const) {
        if (extra && presentation !== "Full Breakup")
          throw new HttpError(
            409,
            "This legacy quotation has additional scope outside its approved BOQ; revise costing before comparing all formats.",
          );
        const snapshot = quote(
          {
            ...p.snapshot,
            input: { ...p.snapshot.input, presentation, taxMode },
          },
          b.snapshot,
          { pricingId: p.id, ...q.snapshot.input, additionalItem: extra },
        );
        const used = new Set<number>();
        snapshot.lines.forEach((line) => {
          const i = q.snapshot.lines.findIndex(
            (original: any, index: number) =>
              !used.has(index) &&
              original.group === line.group &&
              original.qty === line.qty &&
              original.unit === line.unit,
          );
          if (i >= 0) {
            line.description = q.snapshot.lines[i].description;
            used.add(i);
          }
        });
        snapshot.customer = q.snapshot.customer;
        snapshot.notes = q.snapshot.notes;
        snapshot.terms = q.snapshot.terms;
        snapshot.subject = q.snapshot.subject;
        if (snapshot.footer.at(-1)!.amount !== q.snapshot.footer.at(-1).amount)
          throw new HttpError(
            422,
            "Comparison payable differs from saved quotation.",
          );
        variants.push({ snapshot, label: `${presentation} / ${taxMode}` });
      }
    }
    return { number: q.number, variants };
  }
  async discountReview(
    actor: string,
    id: string,
    adjustment: string | ReviewAdjustment,
  ) {
    await this.manager(this.pool, actor, false);
    const q = await this.quotationGet(id);
    const p = await this.pricingGet(actor, q.pricing_id);
    if(p.snapshot.discountStrategy)return managementReviewV5(p.snapshot.discountStrategy,p.snapshot.cost,q.snapshot.discountAllocation?.discount??q.snapshot.footer.find((r:any)=>r.label==='Special Discount')?.amount??'0',typeof adjustment==='string'?{discount:adjustment}:adjustment,cashDeal(p.snapshot.input));
    const b = (
      await this.pool.query("SELECT snapshot FROM boq_revisions WHERE id=$1", [
        q.boq_revision_id,
      ])
    ).rows[0];
    const extra = await this.additionalInput(actor, id);
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
      {
        pricingId: p.id,
        ...q.snapshot.input,
        discount: "0",
        additionalItem: extra,
      },
    );
    const rows = ["bess-only","direct-product"].includes(b.snapshot.survey.family) && p.snapshot.itemPricing ? p.snapshot.itemPricing.map((l:any)=>{
      const source=b.snapshot.lines.find((x:any)=>x.key===l.key);
      return {description:source.description,qty:source.qty,unit:source.unit,group:l.group,beforeTax:l.beforeTax,taxRate:l.taxRate};
    }) : detailed.lines.map((l, i) => ({
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      group: l.group,
      beforeTax: l.amount!,
      taxRate:
        extra && i === detailed.lines.length - 1
          ? cashDeal(p.snapshot.input)?"0":extra.taxRate
          : p.snapshot.rows.find((r: any) => r.key === l.group).taxRate,
    }));
    const amount = (label: string) =>
      detailed.footer.find((r) => r.label === label)?.amount ?? "0.00";
    return managementReview(
      rows,
      amount("Subtotal Before Tax"),
      ["bess-only","direct-product"].includes(b.snapshot.survey.family) ? p.snapshot.solarTax : amount("SOLAR PANEL SALES TAX @10%"),
      amount("SALES TAX ON OTHER ITEMS @18%"),
      new Decimal(p.snapshot.cost).add(extra?.cost ?? "0").toString(),
      q.snapshot.input.discount ?? "0",
      typeof adjustment === "string" ? { discount: adjustment } : adjustment,
      cashDeal(p.snapshot.input),
    );
  }

  async additionalInput(actor: string, id: string) {
    await this.manager(this.pool, actor);
    return (
      await this.pool.query(
        "SELECT input FROM quotation_additional_inputs WHERE quotation_id=$1",
        [id],
      )
    ).rows[0]?.input;
  }
}
