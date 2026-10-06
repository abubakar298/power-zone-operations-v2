import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { BoqRepository } from "../boq/repository.js";
import { surveySchema } from "../boq/schema.js";
import { CommercialRepository } from "../commercial/repository.js";
import { pricingSchema, quotationSchema } from "../commercial/schema.js";
import { OrdersRepository } from "../orders/repository.js";
import { orderSchema } from "../orders/schema.js";
import { CoordinatorRepository } from "./repository.js";

export async function runRequestedDashboardSamples(
  pool: Pool,
  requestedBatch: string | undefined,
) {
  if (requestedBatch !== "atif-training-20-v1") return;
  const owner = (
    await pool.query(
      "SELECT id FROM users WHERE lower(email)='bess@powerzone.com.pk' AND active AND role='Coordinator'",
    )
  ).rows[0];
  const reviewer = (
    await pool.query(
      "SELECT id FROM users WHERE active AND role IN('Admin','Management') ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  if (!owner || !reviewer)
    throw new Error("Atif and management accounts must exist first.");
  return createDashboardSamples(pool, owner.id, reviewer.id);
}

/** Owner-requested training batch. No HTTP endpoint, credentials or automatic seeding. */
export async function createDashboardSamples(
  pool: Pool,
  owner: string,
  reviewer: string,
) {
  const key = "atif-training-20-v1";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(742019007)");
    const existing = (
      await client.query(
        "SELECT * FROM dashboard_sample_batches WHERE key=$1",
        [key],
      )
    ).rows[0];
    if (existing) {
      if (existing.owner_id !== owner)
        throw new Error("Training batch belongs to another account.");
      await client.query("COMMIT");
      return existing.records;
    }
    const users = (
      await client.query(
        "SELECT id,role,active FROM users WHERE id=ANY($1::uuid[])",
        [[owner, reviewer]],
      )
    ).rows;
    if (
      !users.some(
        (u) => u.id === owner && u.active && u.role === "Coordinator",
      ) ||
      !users.some(
        (u) =>
          u.id === reviewer &&
          u.active &&
          ["Admin", "Management"].includes(u.role),
      )
    )
      throw new Error("Active Coordinator and management reviewer required.");
    const brands = (
      await client.query(
        "SELECT id,category FROM brands WHERE status='Active' ORDER BY id",
      )
    ).rows;
    const brand = (category: string) => {
      const b = brands.find((v) => v.category === category);
      if (!b) throw new Error(`Missing approved brand category: ${category}`);
      return b.id;
    };
    // Repositories retain their normal validation and transactions. All writes here
    // share one outer transaction, so a failed batch leaves no partial sample data.
    let timestamp = new Date(),
      savepoint = 0;
    const query = async (sql: string, values?: any[]) => {
      if (sql === "BEGIN")
        return client.query(`SAVEPOINT sample_${++savepoint}`);
      if (sql === "COMMIT")
        return client.query(`RELEASE SAVEPOINT sample_${savepoint}`);
      if (sql === "ROLLBACK")
        return client.query(`ROLLBACK TO SAVEPOINT sample_${savepoint}`);
      // Synthetic ages are set at initial INSERT only; immutable history is never updated.
      const insert =
        /^(INSERT INTO (?:survey_drafts|boq_review_submissions|boq_review_decisions|boq_revisions|commercial_pricing_versions|quotation_versions|coordination_events|ipo_submissions|internal_purchase_orders)\s*\()([^)]*)(\)\s*VALUES\s*\()([^)]*)(\))/i;
      if (insert.test(sql)) {
        sql = sql.replace(
          insert,
          `$1$2,created_at$3$4,'${timestamp.toISOString()}'$5`,
        );
        timestamp = new Date(timestamp.getTime() + 60000);
      }
      return client.query(sql, values);
    };
    const scoped = {
      query,
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool;
    const boqs = new BoqRepository(scoped),
      commercial = new CommercialRepository(scoped),
      orders = new OrdersRepository(scoped),
      coordination = new CoordinatorRepository(scoped);
    const records: any[] = [];
    let nextCustomer = Number(
      (await client.query("SELECT COALESCE(MAX(id),0)+1 AS id FROM customers"))
        .rows[0].id,
    );
    const ages = [
      4,
      2 * 1440,
      12,
      3 * 1440,
      9,
      125,
      5,
      180,
      8,
      95,
      40,
      1440,
      20,
      4 * 1440,
      6,
      75,
      9,
      110,
      15,
      150,
    ];
    for (let index = 0; index < 20; index++) {
      const n = index + 1,
        stage = Math.floor(index / 2),
        label = String(n).padStart(2, "0"),
        customerId = nextCustomer++;
      timestamp = new Date(Date.now() - (ages[index] + 20) * 60000);
      await client.query(
        "INSERT INTO customers(id,name,short_code,status,notes) VALUES($1,$2,$3,'Active',$4)",
        [
          customerId,
          `SAMPLE Customer ${label}`,
          `SMPAT${label}`,
          "Dummy customer for Atif dashboard training. Not a real customer.",
        ],
      );
      const survey = surveySchema.parse({
        customerId,
        siteName: `SAMPLE – Training Site ${label}`,
        siteCode: `SMPAT${label}`,
        location: "Sample location, Lahore",
        panelQty: 30 + n,
        panelWattage: "645",
        structure: "L2",
        dcMetres: "120",
        earth25: "20",
        earth6: "40",
        earth10: "40",
        inverter: "20 kW",
        batteryKwh: 15,
        smartMeter: false,
        genset: false,
        brands: {
          solar: brand("Solar Panel"),
          inverter: brand("Inverter"),
          battery: brand("Battery & BMS"),
          cable: brand("Cable"),
          switchgear: brand("Switchgear"),
        },
        preparedBy: "Atif Hameed (sample)",
      });
      const draft = await boqs.draft(owner, undefined, 0, survey);
      const record: any = {
        customerId,
        draftId: draft.id,
        site: survey.siteName,
        stage,
      };
      records.push(record);
      if (stage === 0) continue;
      const preview = await boqs.preview(survey);
      const review = await boqs
        .reviews()
        .submit(owner, draft.id, draft.version, preview.fingerprint);
      if (stage === 1) continue;
      const approved = await boqs
        .reviews()
        .decide(reviewer, review.id, "Approved", "SAMPLE training approval.");
      record.boqRevisionId = approved.saved.id;
      if (stage === 2) continue;
      const pricingInput = pricingSchema.parse({
        boqRevisionId: approved.saved.id,
        presentation: ["No Breakup", "Basic Breakup", "Full Breakup"][
          index % 3
        ],
        taxMode: index % 2 ? "Tax Included" : "Show Sales Tax Separately",
        markups: {
          solar: "10",
          structure: "20",
          bess: "25",
          earthing: "20",
          balance: "20",
          rest: "20",
        },
        preparedBy: "Atif Hameed (sample)",
        remarks: "SAMPLE ONLY — dashboard training.",
      });
      const pp = await commercial.pricingPreview(owner, pricingInput);
      const pricing = await commercial.pricingSave(
        owner,
        pricingInput,
        pp.fingerprint,
        randomUUID(),
      );
      const quotationInput = quotationSchema.parse({
        pricingId: pricing.id,
        quotedDate: "2026-10-06",
        validity: "7 days",
        proposedBy: "Atif Hameed (sample)",
        discount: "0",
      });
      const qp = await commercial.quotationPreview(owner, quotationInput);
      const quotation = await commercial.quotationSave(
        owner,
        quotationInput,
        qp.fingerprint,
        randomUUID(),
      );
      record.quotationId = quotation.id;
      if (stage === 3) continue;
      await coordination.event(
        owner,
        quotation.id,
        "Submitted",
        "SAMPLE training review.",
      );
      if (stage === 4) continue;
      if (stage === 5) {
        await coordination.event(
          reviewer,
          quotation.id,
          "Changes requested",
          "SAMPLE: revise the commercial margin after management review.",
        );
        continue;
      }
      await coordination.event(
        reviewer,
        quotation.id,
        "Approved",
        "SAMPLE approval.",
      );
      if (stage === 6) continue;
      await coordination.event(
        owner,
        quotation.id,
        "PO received",
        `SAMPLE approval reference SMP-PO-${label}`,
      );
      if (stage === 7) continue;
      const orderInput = orderSchema.parse({
        quotationId: quotation.id,
        evidenceType: "Verbal sale confirmation",
        evidenceNotes:
          "SAMPLE ONLY — fictional confirmation for dashboard training.",
        orderDate: "2026-10-06",
        invoiceCompany: "Power Zone Engineering & Services",
        salesPerson: "Sample salesperson",
        customerAccepted: true,
        remarks: "SAMPLE ONLY — do not fulfil, invoice or send externally.",
      });
      const op = await orders.preview(owner, orderInput);
      const submission = await orders.submit(
        owner,
        orderInput,
        op.fingerprint,
        randomUUID(),
      );
      record.submissionId = submission.id;
      if (stage === 8) continue;
      record.ipoId = (
        await orders.approve(reviewer, submission.id, randomUUID())
      ).id;
    }
    await client.query(
      "INSERT INTO dashboard_sample_batches(key,owner_id,records) VALUES($1,$2,$3)",
      [key, owner, JSON.stringify(records)],
    );
    await client.query("COMMIT");
    return records;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
