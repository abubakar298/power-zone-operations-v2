import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { fingerprint } from "../boq/repository.js";
import { price, quote } from "./engine.js";
import type { PricingInput, QuotationInput } from "./schema.js";
export class CommercialRepository {
  constructor(private pool: Pool) {}
  async manager(c: Pool | PoolClient, id: string) {
    const user = (
      await c.query(
        "SELECT active,role FROM users WHERE id=$1" +
          ("release" in c ? " FOR SHARE" : ""),
        [id],
      )
    ).rows[0];
    if (!user?.active) throw new HttpError(401, "Your access has ended.");
    if (!["Admin", "Management"].includes(user.role))
      throw new HttpError(
        403,
        "Admin or Management commercial access required.",
      );
  }
  async boq(c: Pool | PoolClient, id: string) {
    const r = (await c.query("SELECT * FROM boq_revisions WHERE id=$1", [id]))
      .rows[0];
    if (!r) throw new HttpError(404, "Approved BOQ revision not found.");
    return r;
  }
  async pricingPreview(actor: string, input: PricingInput) {
    await this.manager(this.pool, actor);
    const b = await this.boq(this.pool, input.boqRevisionId),
      snapshot = price(b.snapshot, b.number, input);
    return { snapshot, fingerprint: fingerprint(snapshot) };
  }
  async pricingList(actor: string) {
    await this.manager(this.pool, actor);
    return (
      await this.pool.query(
        "SELECT id,number,version,boq_revision_id,created_at,snapshot->>'boqNumber' AS boq_number,snapshot->>'netTotal' AS total FROM commercial_pricing_versions ORDER BY created_at DESC LIMIT 200",
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
      const b = await this.boq(c, input.boqRevisionId),
        snapshot = price(b.snapshot, b.number, input),
        fp = fingerprint(snapshot);
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
  ) {
    const p = await this.pricingGet(actor, input.pricingId, c),
      b = await this.boq(c, p.boq_revision_id),
      customer = (await c.query("SELECT contact_person,phone FROM customers WHERE id=$1", [p.snapshot.customer.id])).rows[0],
      wording = (await c.query("SELECT description FROM quotation_description_defaults WHERE key='bms'")).rows[0]?.description,
      snapshot = quote(p.snapshot, b.snapshot, input, wording);
    snapshot.customer = { ...snapshot.customer, contactPerson: customer?.contact_person ?? "", phone: customer?.phone ?? "" };
    return {
      snapshot,
      fingerprint: input.additionalItem ? fingerprint({ snapshot, additionalItem: input.additionalItem }) : fingerprint(snapshot),
      boqRevisionId: b.id,
    };
  }
  async quotationSave(
    actor: string,
    input: QuotationInput,
    expected: string,
    key: string,
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019003)");
      const preview = await this.quotationPreview(actor, input, c);
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
      const version = Number(
          (
            await c.query(
              "SELECT COALESCE(max(version),0)+1 AS version FROM quotation_versions WHERE boq_revision_id=$1",
              [preview.boqRevisionId],
            )
          ).rows[0].version,
        ),
        number = `Q-${preview.snapshot.boqNumber}-V${version}`;
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
      if (input.additionalItem) await c.query("INSERT INTO quotation_additional_inputs(quotation_id,input) VALUES($1,$2)", [row.id, input.additionalItem]);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `quotation.${number}.saved`]);
      return row;
    });
  }
  async quotationList() {
    return (
      await this.pool.query(
        "SELECT id,number,version,pricing_id,boq_revision_id,created_at,snapshot->>'boqNumber' AS boq_number,snapshot->'customer'->>'name' AS customer,snapshot->>'siteName' AS site FROM quotation_versions ORDER BY created_at DESC LIMIT 200",
      )
    ).rows;
  }
  async quotationGet(id: string) {
    const row = (
      await this.pool.query("SELECT * FROM quotation_versions WHERE id=$1", [
        id,
      ])
    ).rows[0];
    if (!row) throw new HttpError(404, "Quotation not found.");
    return row;
  }
  async additionalInput(actor: string, id: string) {
    await this.manager(this.pool, actor);
    return (await this.pool.query("SELECT input FROM quotation_additional_inputs WHERE quotation_id=$1", [id])).rows[0]?.input;
  }
}
