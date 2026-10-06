import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { fingerprint } from "../boq/repository.js";
import type { IssuanceInput, DeliveryPlanInput } from "./schema.js";
export class OperationsRepository {
  constructor(private pool: Pool) {}
  async list() {
    return (
      await this.pool.query(
        "SELECT * FROM operations_boq_issuances ORDER BY created_at DESC LIMIT 200",
      )
    ).rows;
  }
  async get(id: string) {
    const r = (
      await this.pool.query(
        "SELECT * FROM operations_boq_issuances WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "Operations issuance not found.");
    return r;
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
      const u = (await c.query("SELECT active FROM users WHERE id=$1", [actor]))
        .rows[0];
      if (!u?.active) throw new HttpError(401, "Your access has ended.");
      const issuance = (
        await c.query(
          "SELECT id FROM operations_boq_issuances WHERE id=$1 FOR UPDATE",
          [issuanceId],
        )
      ).rows[0];
      if (!issuance) throw new HttpError(404, "Received BOQ not found.");
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
        await c.query("SELECT display_name,active FROM users WHERE id=$1", [
          actor,
        ])
      ).rows[0];
      if (!u?.active) throw new HttpError(401, "Your access has ended.");
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
      const sequence =
        (
          await c.query(
            "SELECT COUNT(*)::integer AS n FROM operations_boq_issuances",
          )
        ).rows[0].n + 1;
      const number = `OPS-BOQ-${String(sequence).padStart(6, "0")}`;
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
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `operations.boq.issue:${row.id}:ipo:${input.ipoId}`,
      ]);
      return row;
    });
  }
}
