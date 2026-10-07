import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
const text = z.string().trim().max(2000);
export const customerImportSchema = z
  .object({
    source: z.string().trim().min(1).max(500),
    rows: z
      .array(
        z
          .object({
            name: text.min(1).max(200),
            contact_person: text,
            phone: text.max(100),
            address: text,
            city: text.max(200),
            province: text.max(200),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
  })
  .strict();
type Input = z.infer<typeof customerImportSchema>;
const fields = [
  "name",
  "contact_person",
  "phone",
  "address",
  "city",
  "province",
] as const;
const normal = (s: string) =>
  s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const canonical = (s: string) => normal(s).replace(/[^\p{L}\p{N}]/gu, "");
const protectedCustomer = (s: string) => canonical(s) === "mrarshad";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function similar(a: string, b: string) {
  const x = canonical(a),
    y = canonical(b);
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 8) return false;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    prev = row;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length) >= 0.88;
}
export function customerImportPlan(input: Input, customers: any[]) {
  const rows = input.rows.map((source, index) => {
    const exact = customers.filter(
      (c) => normal(c.name) === normal(source.name),
    );
    const duplicate =
      input.rows.filter((r) => canonical(r.name) === canonical(source.name))
        .length > 1;
    if (protectedCustomer(source.name))
      return {
        row: index + 1,
        source,
        action: "Unchanged",
        id: exact[0]?.id,
        reason: "Mr. Arshad is protected; all details retained.",
      };
    if (duplicate || exact.length > 1)
      return {
        row: index + 1,
        source,
        action: "Needs review",
        candidates: exact.map((c) => ({ id: c.id, name: c.name })),
        reason: "Duplicate customer name; confirmation required.",
      };
    if (exact.length === 1) {
      const old = exact[0],
        values = { ...old };
      for (const f of fields) if (source[f]) values[f] = source[f];
      return {
        row: index + 1,
        source,
        id: old.id,
        action: fields.some((f) => values[f] !== old[f])
          ? "Updated"
          : "Unchanged",
        values,
      };
    }
    const candidates = customers.filter(
      (c) =>
        similar(c.name, source.name) ||
        (source.phone &&
          c.phone &&
          source.phone
            .split(/[;,]/)
            .some((p) =>
              c.phone
                .split(/[;,]/)
                .some(
                  (q: string) => p.replace(/\s/g, "") === q.replace(/\s/g, ""),
                ),
            )),
    );
    if (candidates.length)
      return {
        row: index + 1,
        source,
        action: "Needs review",
        candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
        reason: "Possible name or phone match; confirmation required.",
      };
    const relatedSource = input.rows
      .map((r, i) => ({ ...r, row: i + 1 }))
      .filter((r) => r.row !== index + 1 && similar(r.name, source.name));
    if (relatedSource.length)
      return {
        row: index + 1,
        source,
        action: "Needs review",
        candidates: relatedSource.map((r) => ({
          id: `Sheet row ${r.row}`,
          name: r.name,
        })),
        reason: "Similar new names in the sheet; confirmation required.",
      };
    return { row: index + 1, source, action: "Added", values: source };
  });
  return {
    fingerprint: hash({ input, customers }),
    rows,
    counts: {
      added: rows.filter((r) => r.action === "Added").length,
      updated: rows.filter((r) => r.action === "Updated").length,
      unchanged: rows.filter((r) => r.action === "Unchanged").length,
      needsReview: rows.filter((r) => r.action === "Needs review").length,
    },
    protectedCustomers: customers
      .filter((c) => protectedCustomer(c.name))
      .map((c) => ({ id: c.id, name: c.name })),
    retainedAbsent: customers.filter(
      (c) => !input.rows.some((r) => normal(r.name) === normal(c.name)),
    ).length,
  };
}
export async function importCustomers(
  pool: Pool,
  actor: string,
  input: Input,
  expected?: string,
  confirmedBackup?: boolean,
) {
  return transaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(742019002)");
    const user = (
      await c.query("SELECT role FROM users WHERE id=$1 AND active FOR SHARE", [
        actor,
      ])
    ).rows[0];
    if (user?.role !== "Admin")
      throw new HttpError(403, "Administrator access required.");
    const customers = (
      await c.query("SELECT * FROM customers ORDER BY id FOR UPDATE")
    ).rows;
    const plan = customerImportPlan(input, customers);
    if (!expected) return plan;
    if (expected !== plan.fingerprint)
      throw new HttpError(
        409,
        "Customer data changed. Preview and review the import again.",
      );
    if (
      !confirmedBackup ||
      !(
        await c.query(
          "SELECT 1 FROM audit_log WHERE user_id=$1 AND action='backup.download.prepared' AND created_at>now()-interval '2 hours' LIMIT 1",
          [actor],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Download and confirm a fresh full database backup before importing.",
      );
    let next = Math.max(-1, ...customers.map((r) => r.id)) + 1;
    const changes: any[] = [];
    for (const row of plan.rows) {
      if (row.action === "Updated") {
        const v = row.values!;
        await c.query(
          "UPDATE customers SET name=$1,contact_person=$2,phone=$3,address=$4,city=$5,province=$6,version=version+1 WHERE id=$7",
          [...fields.map((f) => v[f]), row.id],
        );
        changes.push({ id: row.id, action: row.action, source: row.source });
      } else if (row.action === "Added") {
        let code = `C${next}`;
        while (
          customers.some(
            (r) => r.short_code.toLowerCase() === code.toLowerCase(),
          )
        )
          code += "N";
        await c.query(
          "INSERT INTO customers(id,short_code,name,contact_person,phone,address,city,province,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Active')",
          [next, code, ...fields.map((f) => row.source[f])],
        );
        changes.push({ id: next, action: row.action, source: row.source });
        next++;
      }
    }
    const id = randomUUID(),
      result = { ...plan, changes };
    await c.query(
      "INSERT INTO customer_import_batches(id,source,source_hash,before_customers,result,created_by) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        input.source,
        hash(input.rows),
        JSON.stringify(customers),
        JSON.stringify(result),
        actor,
      ],
    );
    await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
      actor,
      `customers.import:${id}`,
    ]);
    return { ...result, batchId: id };
  });
}
