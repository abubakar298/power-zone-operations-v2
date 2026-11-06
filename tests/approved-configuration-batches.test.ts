import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { ProjectWorkflowRepository } from "../server/project-workflow/repository.js";
import {
  createConfigurationBatch,
  configurationBatchPreview,
  confirmConfigurationBatch,
} from "../server/project-workflow/configuration-batches.js";
test("mixed approved Direct PO batch retains four distinct scopes under one customer PO; retries never duplicate IPOs, demands or evidence", async () => {
  const db = await testDatabase();
  try {
    const actor = randomUUID(),
      other = randomUUID();
    for (const id of [actor, other])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Atif','unused','Coordinator')",
        [id, id + "@example.test"],
      );
    const keys = [
        "20-20-30:Revised",
        "UBL-BESS-20-40",
        "UBL-BESS-30-40",
        "UBL-BESS-30-60",
      ],
      frameworks = (
        await db.pool.query(
          "SELECT * FROM project_framework_current WHERE configuration_key=ANY($1)",
          [keys],
        )
      ).rows;
    const raw = {
      requestKey: randomUUID(),
      customerId: 5,
      route: "direct-framework",
      notes: "Disposable mixed batch proof",
      rows: keys.map((key, i) => ({
        siteName: "Batch fixture " + i,
        siteCode: "MIX-" + i,
        frameworkId: frameworks.find((f) => f.configuration_key === key).id,
      })),
      po: {
        reference: "SHARED-MIXED-PO",
        date: "2026-11-06",
        total: "20299116.00",
      },
      evidence: {
        filename: "shared-po.pdf",
        mime: "application/pdf",
        base64: Buffer.from(
          "%PDF-1.4\n% disposable approved batch\n%%EOF",
        ).toString("base64"),
      },
    };
    const created = await createConfigurationBatch(db.pool, actor, raw);
    assert.equal(
      (await createConfigurationBatch(db.pool, actor, raw)).id,
      created.id,
    );
    await assert.rejects(
      createConfigurationBatch(db.pool, actor, {
        ...raw,
        notes: "Different request",
      }),
      /different details/,
    );
    await assert.rejects(
      configurationBatchPreview(db.pool, other, created.id),
      /not found/,
    );
    const preview = await configurationBatchPreview(
      db.pool,
      actor,
      created.id,
      true,
    );
    assert.equal(preview.previews.length, 4);
    assert.equal(preview.records.length, 4);
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM project_workflow_files"))
        .rows[0].count,
      "1",
    );
    for (const r of preview.records)
      assert.equal(
        (
          await new ProjectWorkflowRepository(db.pool).file(
            actor,
            r.id,
            preview.evidenceId,
          )
        ).filename,
        "shared-po.pdf",
      );
    await assert.rejects(
      confirmConfigurationBatch(db.pool, actor, created.id, {
        requestKey: randomUUID(),
        fingerprint: "0".repeat(64),
        reviewed: true,
      }),
      /changed/,
    );
    const command = {
      requestKey: randomUUID(),
      fingerprint: preview.fingerprint,
      reviewed: true,
    };
    await confirmConfigurationBatch(db.pool, actor, created.id, command);
    await confirmConfigurationBatch(db.pool, actor, created.id, command);
    for (const [table, count] of [
      ["customer_purchase_orders", "1"],
      ["internal_purchase_orders", "4"],
      ["operations_boq_issuances", "4"],
      ["ipo_accounts_handoffs", "4"],
      ["project_workflow_files", "1"],
    ])
      assert.equal(
        (await db.pool.query("SELECT count(*) FROM " + table)).rows[0].count,
        count,
        table,
      );
    const header = (
      await db.pool.query("SELECT input FROM customer_purchase_orders")
    ).rows[0];
    assert.equal(header.input.approvedConfigurationBatch.total, "20299116.00");
    assert.equal(header.input.approvedConfigurationBatch.siteCount, 4);
    const ipos = (
      await db.pool.query(
        "SELECT snapshot,customer_po_id FROM internal_purchase_orders",
      )
    ).rows;
    assert.equal(new Set(ipos.map((r) => r.customer_po_id)).size, 1);
    assert.equal(
      new Set(ipos.map((r) => r.snapshot.approvedCommercialSource.id)).size,
      4,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*) FROM project_workflow_records WHERE stage='issued'",
        )
      ).rows[0].count,
      "4",
    );
    await assert.rejects(
      db.pool.query(
        "INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,'DUPLICATE-SITE',$3,'x',$4,$5)",
        [
          randomUUID(),
          ipos[0].customer_po_id,
          ipos[0].snapshot,
          randomUUID(),
          actor,
        ],
      ),
      /already has an IPO/,
    );
    // The old individual uniqueness protection remains active outside a registered batch.
    await assert.rejects(
      db.pool.query(
        "INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,'ILLEGAL-DUPLICATE','{}','x',$3,$4)",
        [randomUUID(), ipos[0].customer_po_id, randomUUID(), actor],
      ),
      /outside this approved batch/,
    );
  } finally {
    await db.close();
  }
});
