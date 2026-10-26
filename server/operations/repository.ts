import { allocateReference, boqIdentity } from "../documents/references.js";
import { ownedCondition } from "../http/permissions.js";
import { OrdersRepository } from "../orders/repository.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { fingerprint } from "../boq/repository.js";
import type { IssuanceInput, DeliveryPlanInput } from "./schema.js";
const visibleOperations = `(SELECT source.* FROM operations_boq_issuances source WHERE NOT EXISTS(SELECT 1 FROM test_workflow_archives archived WHERE archived.key LIKE 'LOCAL-REVIEW-SAMPLES-%' AND archived.records->'localPreviewDocumentIds' ? source.id::text))`;
const visibleIpos = `(SELECT source.* FROM internal_purchase_orders source WHERE NOT EXISTS(SELECT 1 FROM test_workflow_archives archived WHERE archived.key LIKE 'LOCAL-REVIEW-SAMPLES-%' AND archived.records->'localPreviewDocumentIds' ? source.id::text))`;
export class OperationsRepository {
  constructor(private pool: Pool) {}
  async withQuotationTypes(rows: any[]) {
    const types = await new OrdersRepository(this.pool).quotationTypes(
      rows.map((r) => r.ipo_id),
    );
    return rows.map((r) => ({ ...r, quotationType: types.get(r.ipo_id) }));
  }
  async portal(actor?: string) {
    const role = actor ? (await this.pool.query("SELECT role FROM users WHERE id=$1", [actor])).rows[0]?.role : undefined;
    const rows = (
      await this.pool.query(
        `SELECT o.*,p.id AS delivery_plan_id,p.version AS delivery_plan_version,p.details AS delivery,s.id AS store_issuance_id,s.number AS store_number,s.created_at AS sent_to_store_at FROM ${visibleOperations} o LEFT JOIN LATERAL(SELECT * FROM operations_delivery_plans WHERE issuance_id=o.id ORDER BY version DESC LIMIT 1)p ON true LEFT JOIN store_boq_issuances s ON s.issuance_id=o.id ${role === "Coordinator" ? `WHERE ${ownedCondition("issuance", "o.id", "$1")}` : ""} ORDER BY o.created_at DESC LIMIT 500`,
        role === "Coordinator" ? [actor] : [],
      )
    ).rows;
    const ipos = (
      await this.pool.query(
        `SELECT i.id,i.number,i.created_at,i.snapshot->>'quotationNumber' AS quotation_number,i.snapshot->'customer'->>'name' AS customer,i.snapshot->>'siteName' AS site,o.id AS issuance_id FROM ${visibleIpos} i LEFT JOIN ${visibleOperations} o ON o.ipo_id=i.id ${role === "Coordinator" ? `WHERE ${ownedCondition("ipo", "i.id", "$1")}` : role === "Operations" ? "WHERE o.id IS NOT NULL" : ""} ORDER BY i.created_at DESC LIMIT 500`,
        role === "Coordinator" ? [actor] : [],
      )
    ).rows;
    const demand = (
      await this.pool.query(
        `SELECT d.item_key,d.brand,d.specification,d.unit,SUM(d.quantity)::text AS required_quantity,SUM(CASE WHEN s.id IS NULL THEN d.quantity ELSE 0 END)::text AS awaiting_store_quantity,SUM(CASE WHEN s.id IS NOT NULL THEN d.quantity ELSE 0 END)::text AS sent_to_store_quantity,COUNT(DISTINCT d.issuance_id)::integer AS sites FROM operations_stock_demand d JOIN ${visibleOperations} active_issuance ON active_issuance.id=d.issuance_id LEFT JOIN store_boq_issuances s ON s.issuance_id=d.issuance_id ${role === "Coordinator" ? `WHERE ${ownedCondition("issuance", "d.issuance_id", "$1")}` : ""} GROUP BY d.item_key,d.brand,d.specification,d.unit ORDER BY d.item_key,d.brand`,
        role === "Coordinator" ? [actor] : [],
      )
    ).rows;
    const types = await new OrdersRepository(this.pool).quotationTypes(
      ipos.map((i) => i.id),
    );
    return {
      issuances: rows.map((r) => ({
        ...r,
        quotationType: types.get(r.ipo_id),
      })),
      ipos: ipos.map((i) => ({ ...i, quotationType: types.get(i.id) })),
      demand,
    };
  }
  async sendToStore(
    actor: string,
    issuanceId: string,
    deliveryPlanId: string,
    requestKey: string,
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019007)");
      const u = (
        await c.query(
          "SELECT role,active,display_name FROM users WHERE id=$1 FOR SHARE",
          [actor],
        )
      ).rows[0];
      if (!u?.active) throw new HttpError(401, "Your access has ended.");
      if (!["Admin", "Management", "Operations"].includes(u.role))
        throw new HttpError(
          403,
          "Operations access required to issue requirements to Store.",
        );
      const replay = (
        await c.query(
          "SELECT * FROM store_boq_issuances WHERE request_key=$1",
          [requestKey],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.created_by !== actor ||
          replay.issuance_id !== issuanceId ||
          replay.delivery_plan_id !== deliveryPlanId
        )
          throw new HttpError(
            409,
            "Request key already used for another Store issuance.",
          );
        return replay;
      }
      const issuance = (
        await c.query(
          "SELECT * FROM operations_boq_issuances WHERE id=$1 FOR UPDATE",
          [issuanceId],
        )
      ).rows[0];
      if (!issuance) throw new HttpError(404, "Received BOQ not found.");
      if (
        (
          await c.query(
            "SELECT 1 FROM store_boq_issuances WHERE issuance_id=$1",
            [issuanceId],
          )
        ).rowCount
      )
        throw new HttpError(409, "This BOQ has already been sent to Store.");
      const plan = (
        await c.query(
          "SELECT * FROM operations_delivery_plans WHERE issuance_id=$1 ORDER BY version DESC LIMIT 1",
          [issuanceId],
        )
      ).rows[0];
      if (!plan || plan.id !== deliveryPlanId)
        throw new HttpError(
          409,
          "Save and review the latest delivery details before issuing to Store.",
        );
      const identity=await boqIdentity(c,issuance.snapshot.boqRevisionId);
      const number=await allocateReference(c,"BOQ",randomUUID(),identity.customer_id,identity.site_code);
      const snapshot = {
        ...issuance.snapshot,
        quotationType:
          issuance.snapshot.quotationType ??
          (
            await new OrdersRepository(this.pool).quotationTypes([
              issuance.ipo_id,
            ])
          ).get(issuance.ipo_id),
        operationsIssuanceNumber: issuance.number,
        deliveryPlanVersion: plan.version,
        ...plan.details,
        notes: plan.details.instructions,
        issuedBy: u.display_name,
        destination: "Store",
      };
      const row = (
        await c.query(
          "INSERT INTO store_boq_issuances(id,issuance_id,delivery_plan_id,number,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            randomUUID(),
            issuanceId,
            plan.id,
            number,
            snapshot,
            requestKey,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `operations.store.issue:${row.id}:source:${issuanceId}`,
      ]);
      return row;
    });
  }
  async storeIssuance(id: string) {
    const row = (
      await this.pool.query(
        "SELECT s.*,o.ipo_id FROM store_boq_issuances s JOIN operations_boq_issuances o ON o.id=s.issuance_id WHERE s.id=$1",
        [id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Store issuance not found.");
    return (await this.withQuotationTypes([row]))[0];
  }
  async list(actor?: string) {
    const rows = (
      await this.pool.query(
        `SELECT o.* FROM ${visibleOperations} o ${actor ? `WHERE (${ownedCondition("issuance", "o.id", "$1")} OR EXISTS(SELECT 1 FROM users WHERE id=$1 AND active AND role='Operations'))` : ""} ORDER BY o.created_at DESC LIMIT 200`,
        actor ? [actor] : [],
      )
    ).rows;
    return this.withQuotationTypes(rows);
  }
  async get(id: string) {
    const r = (
      await this.pool.query(
        "SELECT * FROM operations_boq_issuances WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "Operations issuance not found.");
    return (await this.withQuotationTypes([r]))[0];
  }
  async deliveryPlan(issuanceId: string) {
    await this.get(issuanceId);
    return (
      (
        await this.pool.query(
          "SELECT * FROM operations_delivery_plans WHERE issuance_id=$1 ORDER BY version DESC LIMIT 1",
          [issuanceId],
        )
      ).rows[0] ?? null
    );
  }
  async planDelivery(
    actor: string,
    issuanceId: string,
    input: DeliveryPlanInput,
  ) {
    return transaction(this.pool, async (c) => {
      const u = (
        await c.query("SELECT active,role FROM users WHERE id=$1", [actor])
      ).rows[0];
      if (!u?.active) throw new HttpError(401, "Your access has ended.");
      if (!["Admin", "Management", "Operations"].includes(u.role))
        throw new HttpError(
          403,
          "Operations access required to plan delivery.",
        );
      const issuance = (
        await c.query(
          "SELECT id FROM operations_boq_issuances WHERE id=$1 FOR UPDATE",
          [issuanceId],
        )
      ).rows[0];
      if (!issuance) throw new HttpError(404, "Received BOQ not found.");
      if (
        (
          await c.query(
            "SELECT 1 FROM store_boq_issuances WHERE issuance_id=$1",
            [issuanceId],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "Delivery details are frozen after Store issuance. A controlled revision is required for changes.",
        );
      const replay = (
        await c.query(
          "SELECT * FROM operations_delivery_plans WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.created_by !== actor ||
          replay.issuance_id !== issuanceId ||
          replay.version !== input.version + 1 ||
          fingerprint(replay.details) !== fingerprint(input.details)
        )
          throw new HttpError(
            409,
            "Request key already used for another delivery plan.",
          );
        return replay;
      }
      const version = (
        await c.query(
          "SELECT COALESCE(max(version),0)::integer AS version FROM operations_delivery_plans WHERE issuance_id=$1",
          [issuanceId],
        )
      ).rows[0].version;
      if (version !== input.version)
        throw new HttpError(
          409,
          "Delivery details changed. Reopen the received BOQ before saving.",
        );
      const row = (
        await c.query(
          "INSERT INTO operations_delivery_plans(id,issuance_id,version,details,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            randomUUID(),
            issuanceId,
            version + 1,
            input.details,
            input.requestKey,
            actor,
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `operations.delivery.plan:${issuanceId}:v${row.version}`,
      ]);
      return row;
    });
  }
  async source(ipoId: string, c: Pool | PoolClient = this.pool) {
    const ipo = (
      await c.query("SELECT * FROM internal_purchase_orders WHERE id=$1", [
        ipoId,
      ])
    ).rows[0];
    if (!ipo)
      throw new HttpError(
        404,
        "Saved IPO required before issuing to Operations.",
      );
    const b = (
      await c.query("SELECT * FROM boq_revisions WHERE id=$1", [
        ipo.snapshot.boqRevisionId,
      ])
    ).rows[0];
    if (!b) throw new HttpError(422, "The IPO has no approved BOQ revision.");
    const s = ipo.snapshot,
      i = s.input;
    const snapshot = {
      version: 1,
      ipoNumber: ipo.number,
      quotationNumber: s.quotationNumber,
      quotationType: (
        await new OrdersRepository(this.pool).quotationTypes([ipo.id])
      ).get(ipo.id),
      boqNumber: b.number,
      boqRevisionId: b.id,
      customer: s.customer,
      siteName: s.siteName,
      siteCode: s.siteCode,
      solutionId: s.solutionId,
      customerPo: i.poNumber,
      contactPerson: i.contactPerson,
      phone: i.phone,
      email: i.email,
      billingAddress: i.billingAddress,
      deliveryAddress: i.deliveryAddress,
      siteContact: i.siteContact,
      sitePhone: i.sitePhone,
      notes: "",
      items: b.snapshot.lines
        .filter((l: any) => Number(l.qty) > 0)
        .map((l: any) => ({
          key: l.key,
          description: l.description,
          brand: l.brand,
          brandAlternatives: l.brandAlternatives,
          specification:
            l.key === "Solar PV Modules"
              ? `${b.snapshot.survey.panelWattage} W; ${l.specification ?? ""}`.trim()
              : l.specification,
          qty:
            l.key === "Solar PV Modules"
              ? String(b.snapshot.survey.panelQty)
              : l.qty,
          unit: l.key === "Solar PV Modules" ? "No." : l.unit,
          boqQty: l.qty,
          boqUnit: l.unit,
        })),
      sourceFingerprint: fingerprint({ ipo: s, boq: b.snapshot }),
    };
    return snapshot;
  }
  async issue(actor: string, input: IssuanceInput) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019005)");
      const u = (
        await c.query(
          "SELECT display_name,active,role FROM users WHERE id=$1",
          [actor],
        )
      ).rows[0];
      if (!u?.active) throw new HttpError(401, "Your access has ended.");
      if (u.role === "Operations")
        throw new HttpError(
          403,
          "Coordinator handoff is required before Operations can receive a BOQ.",
        );
      const replay = (
        await c.query(
          "SELECT * FROM operations_boq_issuances WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (replay) {
        if (
          replay.created_by !== actor ||
          replay.ipo_id !== input.ipoId ||
          replay.snapshot.notes !== input.notes
        )
          throw new HttpError(
            409,
            "Request key was already used for another issuance.",
          );
        return replay;
      }
      if (
        (
          await c.query(
            "SELECT id FROM operations_boq_issuances WHERE ipo_id=$1",
            [input.ipoId],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "This IPO already has a BOQ issuance to Operations.",
        );
      const snapshot = {
        ...(await this.source(input.ipoId, c)),
        notes: input.notes,
        issuedBy: u.display_name,
      };
      const identity=await boqIdentity(c,snapshot.boqRevisionId);
      const number=await allocateReference(c,"BOQ",randomUUID(),identity.customer_id,identity.site_code);
      const row = (
        await c.query(
          "INSERT INTO operations_boq_issuances(id,ipo_id,boq_revision_id,number,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            randomUUID(),
            input.ipoId,
            snapshot.boqRevisionId,
            number,
            snapshot,
            input.requestKey,
            actor,
          ],
        )
      ).rows[0];
      for (const [index, line] of snapshot.items.entries())
        await c.query(
          "INSERT INTO operations_stock_demand(issuance_id,line_number,item_key,brand,specification,quantity,unit) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            row.id,
            index,
            line.key,
            line.brand,
            line.specification,
            line.qty,
            line.unit,
          ],
        );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `operations.boq.issue:${row.id}:ipo:${input.ipoId}`,
      ]);
      return row;
    });
  }
}
