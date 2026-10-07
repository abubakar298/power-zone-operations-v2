import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { transaction } from "../db/transaction.js";
import { fingerprint } from "../boq/repository.js";
import { CommercialRepository } from "../commercial/repository.js";
import { quote } from "../commercial/engine.js";
import { HttpError } from "../http/errors.js";
import { allocateDiscount } from "./allocation.js";
import { peachtreeDivision } from "./peachtree.js";
import type { OrderInput } from "./schema.js";

export class OrdersRepository {
  constructor(private pool: Pool) {}
  async quotationTypes(ipoIds: string[]) {
    if (!ipoIds.length) return new Map<string, any>();
    const { rows } = await this.pool.query(
      `SELECT i.id,p.snapshot->'input'->>'presentation' AS presentation,p.snapshot->'input'->>'taxMode' AS "taxMode" FROM internal_purchase_orders i JOIN quotation_versions q ON q.id::text=i.snapshot->>'quotationId' JOIN commercial_pricing_versions p ON p.id=q.pricing_id WHERE i.id=ANY($1::uuid[])`,
      [ipoIds],
    );
    return new Map(
      rows.map((r) => [
        r.id,
        { presentation: r.presentation, taxMode: r.taxMode },
      ]),
    );
  }
  async defaults(quotationId: string) {
    const row = (
      await this.pool.query(
        `SELECT c.*, q.snapshot->'input'->>'proposedBy' AS proposed_by,p.snapshot->'input'->>'presentation' AS presentation,p.snapshot->'input'->>'taxMode' AS tax_mode FROM quotation_versions q JOIN commercial_pricing_versions p ON p.id=q.pricing_id JOIN boq_revisions b ON b.id=q.boq_revision_id JOIN boqs o ON o.id=b.boq_id JOIN customers c ON c.id=o.customer_id WHERE q.id=$1`,
        [quotationId],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Quotation customer not found.");
    return {
      customerName: row.name,
      invoiceCompany: row.name,
      quotationType: { presentation: row.presentation, taxMode: row.tax_mode },
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
    const extraSelling = new Decimal(extra?.cost ?? "0").mul(
      new Decimal(extra?.markup ?? "0").div(100).add(1),
    );
    const extraTax = extraSelling.mul(
      new Decimal(extra?.taxRate ?? "0").div(100),
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
    const lines = detailed.lines.map((l, i) => ({
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      group: l.group,
      beforeTax: l.amount!,
      taxRate:
        i === detailed.lines.length - 1 && extra
          ? extra.taxRate
          : p.snapshot.rows.find((r: any) => r.key === l.group).taxRate,
    }));
    const allocation = allocateDiscount(
      lines,
      subtotal,
      tax10,
      tax18,
      footer("Special Discount") ?? "0.00",
      footer("Net Total"),
    );
    const document = await this.checkDocument(c, actor, input.documentId);
    const snapshot = {
      engineVersion: 1,
      input,
      source: "Accepted quotation",
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
        "SELECT s.*,jsonb_build_object('presentation',p.snapshot->'input'->>'presentation','taxMode',p.snapshot->'input'->>'taxMode') AS \"quotationType\",u.display_name AS prepared_by,i.id AS ipo_id,i.number AS ipo_number FROM ipo_submissions s LEFT JOIN quotation_versions q ON q.id::text=s.input->>'quotationId' LEFT JOIN commercial_pricing_versions p ON p.id=q.pricing_id JOIN users u ON u.id=s.created_by LEFT JOIN internal_purchase_orders i ON i.submission_id=s.id WHERE s.created_by=$1 OR EXISTS(SELECT 1 FROM users WHERE id=$1 AND active AND role IN('Admin','Management')) ORDER BY s.created_at DESC LIMIT 200",
        [actor],
      )
    ).rows;
  }
  async approve(actor: string, id: string, key: string) {
    await new CommercialRepository(this.pool).manager(this.pool, actor, false);
    const s = (
      await this.pool.query("SELECT * FROM ipo_submissions WHERE id=$1", [id])
    ).rows[0];
    if (!s) throw new HttpError(404, "IPO submission not found.");
    return this.save(actor, s.input, s.fingerprint, key, s.created_by, s.id);
  }
  async save(
    actor: string,
    input: OrderInput,
    expected: string,
    key: string,
    owner = actor,
    submissionId?: string,
  ) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019004)");
      await new CommercialRepository(this.pool).manager(c, actor, false);
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
        input.poNumber &&
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
          input.poNumber,
          input.documentId ?? null,
          input,
          actor,
        ],
      );
      const serial =
        Number(
          (
            await c.query(
              "SELECT count(*) AS count FROM internal_purchase_orders",
            )
          ).rows[0].count,
        ) + 1;
      const number = `IPO-${String(serial).padStart(6, "0")}`;
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
      return row;
    });
  }
  async list() {
    const rows = (
      await this.pool.query(
        "SELECT id,number,created_at,snapshot->>'quotationNumber' AS quotation_number,snapshot->'input'->>'poNumber' AS po_number,snapshot->'customer'->>'name' AS customer,snapshot->'allocation'->>'total' AS total FROM internal_purchase_orders ORDER BY created_at DESC LIMIT 200",
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
    return {
      ...row,
      quotationType: (await this.quotationTypes([row.id])).get(row.id),
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
        "SELECT * FROM customer_po_documents d WHERE d.id=$1 AND (d.owner_id=$2 OR EXISTS(SELECT 1 FROM customer_purchase_orders p WHERE p.document_id=d.id) OR (EXISTS(SELECT 1 FROM users WHERE id=$2 AND active AND role IN('Admin','Management')) AND EXISTS(SELECT 1 FROM ipo_submissions s WHERE s.input->>'documentId'=d.id::text)))",
        [id, actor],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "PO document not found.");
    return row;
  }
}
