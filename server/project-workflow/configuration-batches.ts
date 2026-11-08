import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { ipoInvoiceTerms } from "../../shared/ipo-invoice-terms.js";
import { Decimal } from "decimal.js";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { fingerprint } from "../boq/repository.js";
import { HttpError } from "../http/errors.js";
import { createSchema, fileSchema } from "./schema.js";
import { ProjectWorkflowRepository } from "./repository.js";
import {
  buildIpoPdf,
  buildPeachtreePdf,
} from "../orders/document-renderers.js";
const site = createSchema
  .omit({
    requestKey: true,
    customerId: true,
    route: true,
    notes: true,
    headsup: true,
  })
  .extend({ frameworkId: z.uuid().optional() });
const file = fileSchema.omit({ kind: true });
const inputSchema = z
  .object({
    requestKey: z.uuid(),
    customerId: z.number().int().nonnegative(),
    route: z.enum(["survey-framework", "direct-framework"]),
    notes: z.string().trim().min(1).max(4000),
    rows: z.array(site).min(1).max(50),
    evidence: file.optional(),
    po: z
      .object({
        reference: z.string().trim().min(1).max(100),
        date: z.iso.date(),
        total: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/),
      })
      .strict()
      .optional(),
  })
  .strict();
function childKey(key: string, position: number) {
  const h = createHash("sha256")
    .update(key + ":" + position)
    .digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-5" +
    h.slice(13, 16) +
    "-a" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
}
async function batch(
  pool: Pool | PoolClient,
  actor: string,
  id: string,
  lock = false,
) {
  const row = (
    await pool.query(
      "SELECT b.*,u.role,u.active FROM approved_configuration_batches b JOIN users u ON u.id=$1 WHERE b.id=$2" +
        (lock ? " FOR UPDATE OF b" : ""),
      [actor, id],
    )
  ).rows[0];
  if (
    !row ||
    !row.active ||
    !["Coordinator", "Management", "Admin"].includes(row.role) ||
    (row.created_by !== actor && !["Management", "Admin"].includes(row.role))
  )
    throw new HttpError(404, "Configuration batch not found.");
  return row;
}
export async function createConfigurationBatch(
  pool: Pool,
  actor: string,
  raw: unknown,
) {
  const input = inputSchema.parse(raw);
  if (input.route === "direct-framework" && (!input.po || !input.evidence))
    throw new HttpError(
      422,
      "Enter the shared PO reference, date, total and original attachment.",
    );
  if (
    input.route === "survey-framework" &&
    input.rows.some((row) => row.frameworkId)
  )
    throw new HttpError(
      422,
      "Select the configuration after the survey, during technical review.",
    );
  if (
    input.route === "direct-framework" &&
    input.rows.some((row) => !row.frameworkId)
  )
    throw new HttpError(
      422,
      "Select an approved configuration for each Direct PO site.",
    );
  if (input.route === "survey-framework" && input.po)
    throw new HttpError(
      422,
      "Record the customer PO after the survey is reviewed.",
    );
  if (
    new Set(input.rows.map((r) => r.siteCode.toLowerCase())).size !==
    input.rows.length
  )
    throw new HttpError(422, "A site can appear only once in this batch.");
  return transaction(pool, async (c) => {
    const repo = new ProjectWorkflowRepository(pool),
      u = await repo.user(actor, c);
    repo.requireRole(u, ["Coordinator"]);
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "approved-batch:" + input.requestKey,
    ]);
    const old = (
      await c.query(
        "SELECT * FROM approved_configuration_batches WHERE request_key=$1",
        [input.requestKey],
      )
    ).rows[0];
    if (old) {
      if (
        old.created_by !== actor ||
        old.input_fingerprint !== fingerprint(input)
      )
        throw new HttpError(
          409,
          "This batch key belongs to different details.",
        );
      return { id: old.id, repeated: true };
    }
    const customer = (
      await c.query(
        "SELECT * FROM customers WHERE id=$1 AND status='Active' AND upper(short_code)='UBL'",
        [input.customerId],
      )
    ).rows[0];
    if (!customer)
      throw new HttpError(
        422,
        "Mixed approved configuration batches require UBL.",
      );
    if (
      input.po &&
      (
        await c.query(
          "SELECT 1 FROM customer_purchase_orders WHERE customer_id=$1 AND lower(po_number)=lower($2) UNION ALL SELECT 1 FROM approved_configuration_batches WHERE customer_id=$1 AND lower(snapshot#>>'{po,reference}')=lower($2)",
          [input.customerId, input.po.reference],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "This PO is already registered. Open its existing batch.",
      );
    const records = [];
    let total = new Decimal(0);
    for (const [i, row] of input.rows.entries()) {
      const framework =
        input.route === "direct-framework"
          ? (
              await c.query(
                "SELECT * FROM project_framework_versions WHERE id=$1 AND customer_id=$2",
                [row.frameworkId, input.customerId],
              )
            ).rows[0]
          : null;
      if (
        input.route === "direct-framework" &&
        (!framework ||
          !["ubl-solar", "ubl-bess-installation"].includes(
            framework.payload.type,
          ))
      )
        throw new HttpError(
          422,
          "Choose an approved UBL solar or BESS installation configuration for every site.",
        );
      const created = await repo.create(
        actor,
        {
          ...row,
          customerId: input.customerId,
          route: input.route,
          notes: input.notes,
          requestKey: childKey(input.requestKey, i),
        },
        c,
      );
      const { r } = await repo.record(actor, created.id, c);
      if (r.data.basis) total = total.add(r.data.basis.order.allocation.total);
      records.push(r);
    }
    if (input.po && !total.eq(input.po.total))
      throw new HttpError(
        422,
        "The shared PO total must match the sum of the selected approved configurations. Review any scope or price difference through the existing approval process.",
      );
    const evidence = input.evidence
      ? await repo.attach(
          actor,
          records[0].id,
          {
            ...input.evidence,
            kind:
              input.route === "direct-framework"
                ? "PO / confirmation"
                : "Request evidence",
          },
          c,
        )
      : null;
    const id = randomUUID(),
      snapshot = {
        notes: input.notes,
        po: input.po ?? null,
        total: input.route === "direct-framework" ? total.toFixed(2) : null,
        sites: records.map((r) => ({
          id: r.id,
          siteId: r.site_id,
          siteName: r.site_name,
          siteCode: r.site_code,
          framework: r.data.basis?.source ?? null,
          total: r.data.basis?.order.allocation.total ?? null,
        })),
      };
    await c.query(
      "INSERT INTO approved_configuration_batches(id,customer_id,route,request_key,input_fingerprint,snapshot,evidence_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        input.customerId,
        input.route,
        input.requestKey,
        fingerprint(input),
        snapshot,
        evidence?.id ?? null,
        actor,
      ],
    );
    for (const [i, r] of records.entries())
      await c.query(
        "INSERT INTO approved_configuration_batch_sites(batch_id,record_id,position) VALUES($1,$2,$3)",
        [id, r.id, i + 1],
      );
    await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
      actor,
      "project.approved-configuration-batch.created:" + id,
    ]);
    return { id, repeated: false };
  });
}
async function projection(pool: Pool | PoolClient, actor: string, b: any) {
  const repo = new ProjectWorkflowRepository(pool as Pool),
    members = (
      await pool.query(
        "SELECT r.* FROM approved_configuration_batch_sites m JOIN project_workflow_records r ON r.id=m.record_id WHERE m.batch_id=$1 ORDER BY m.position",
        [b.id],
      )
    ).rows;
  for (const r of members) await repo.record(actor, r.id, pool);
  const records = members.map((r) => ({
    id: r.id,
    version: r.version,
    siteName: r.site_name,
    siteCode: r.site_code,
    stage: r.stage,
    framework: r.data.basis?.source ?? null,
    comparison: r.data.basis?.comparison ?? null,
    sourceFingerprint: r.data.basis?.fingerprint ?? null,
  }));
  return {
    id: b.id,
    route: b.route,
    snapshot: b.snapshot,
    evidenceId: b.evidence_id,
    records,
    fingerprint: fingerprint({ snapshot: b.snapshot, records }),
  };
}
export async function configurationBatchPreview(
  pool: Pool,
  actor: string,
  id: string,
  documents = false,
) {
  const b = await batch(pool, actor, id),
    value = await projection(pool, actor, b),
    confirmed = (
      await pool.query(
        "SELECT 1 FROM approved_configuration_batch_confirmations WHERE batch_id=$1",
        [id],
      )
    ).rowCount;
  const repo = new ProjectWorkflowRepository(pool);
  const previews =
    documents && b.route === "direct-framework" && !confirmed
      ? await Promise.all(
          value.records.map(async (r) => {
            const input = receiptInput(b, r);
            const s = await repo.salePreview(actor, r.id, input);
            return {
              recordId: r.id,
              ipo: buildIpoPdf(s, "DRAFT - NOT ISSUED", s.peachtree, {
                includePt: false,
              }).toString("base64"),
              pt: buildPeachtreePdf(
                s,
                s.peachtree,
                "DRAFT - NOT ISSUED",
              ).toString("base64"),
            };
          }),
        )
      : [];
  return { ...value, confirmed: !!confirmed, previews };
}
function receiptInput(b: any, r: any, invoiceTerms?: string) {
  return {
    reference: b.snapshot.po.reference,
    date: b.snapshot.po.date,
    evidenceId: b.evidence_id,
    ...(invoiceTerms ? { invoiceTerms } : {}),
    basisType: "framework",
    frameworkId: r.framework.id,
    confirmationType: "Customer PO",
    actual: r.comparison,
    reviewed: true,
    notes: b.snapshot.notes,
  };
}
export async function confirmConfigurationBatch(
  pool: Pool,
  actor: string,
  id: string,
  raw: unknown,
) {
  const input = z
    .object({
      requestKey: z.uuid(),
      fingerprint: z.string().length(64),
      reviewed: z.literal(true),
      invoiceTermsBySite: z.record(z.uuid(), z.enum(ipoInvoiceTerms)).optional(),
    })
    .strict()
    .parse(raw);
  return transaction(pool, async (c) => {
    const b = await batch(c, actor, id, true),
      repo = new ProjectWorkflowRepository(pool);
    if (b.route !== "direct-framework")
      throw new HttpError(
        422,
        "Survey batches follow the normal survey and customer order stages.",
      );
    const existing = (
      await c.query(
        "SELECT * FROM approved_configuration_batch_confirmations WHERE batch_id=$1 OR request_key=$2",
        [id, input.requestKey],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.batch_id !== id ||
        existing.created_by !== actor ||
        existing.input_fingerprint !== fingerprint(input)
      )
        throw new HttpError(
          409,
          "This confirmation belongs to another request.",
        );
      return { id, repeated: true };
    }
    const view = await projection(c, actor, b);
    if (view.fingerprint !== input.fingerprint)
      throw new HttpError(
        409,
        "A batch site changed. Preview and review the latest batch before issuing.",
      );
    const invoiceTerms = input.invoiceTermsBySite;
    if (invoiceTerms && (
      Object.keys(invoiceTerms).length !== view.records.length ||
      view.records.some(row => !Object.hasOwn(invoiceTerms, row.id))
    )) {
      throw new HttpError(422, "Confirm invoice terms for every site in this batch.");
    }
    for (const row of view.records) {
      if (row.stage !== "po_receipt")
        throw new HttpError(
          409,
          "This batch contains a site already processed separately. Review the current site status.",
        );
      await repo.action(
        actor,
        row.id,
        {
          version: row.version,
          requestKey: childKey(input.requestKey, view.records.indexOf(row)),
          action: "receipt",
          input: receiptInput(b, row, invoiceTerms?.[row.id]),
        },
        c,
      );
    }
    await c.query(
      "INSERT INTO approved_configuration_batch_confirmations(batch_id,request_key,input_fingerprint,snapshot,created_by) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        input.requestKey,
        fingerprint(input),
        {
          records: view.records.map((r) => r.id),
          reviewedFingerprint: view.fingerprint,
          ...(invoiceTerms ? { invoiceTermsBySite: invoiceTerms } : {}),
        },
        actor,
      ],
    );
    return { id, repeated: false };
  });
}
