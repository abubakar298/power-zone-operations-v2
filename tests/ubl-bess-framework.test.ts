import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { testDatabase } from "./database.js";
import { ProjectWorkflowRepository } from "../server/project-workflow/repository.js";
import { restrictedCostView } from "../server/http/cost-visibility.js";
import { ptDisplayRows } from "../server/orders/pt-detail.js";
import {
  buildIpoPdf,
  buildPeachtreePdf,
} from "../server/orders/document-renderers.js";
test("three frozen UBL BESS agreements issue exact separate equipment PT entries, retain contract/actual cable and protect existing solar", async () => {
  const db = await testDatabase();
  try {
    const actor = randomUUID(),
      manager = randomUUID();
    for (const [id, role] of [
      [actor, "Coordinator"],
      [manager, "Management"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$3)",
        [id, id + "@example.test", role, "unused"],
      );
    await db.pool.query("UPDATE customers SET ntn='1234567-8',strn='UBL-STRN-TEST' WHERE id=5");
    const repo = new ProjectWorkflowRepository(db.pool),
      before = (
        await db.pool.query(
          "SELECT configuration_key,payload FROM project_framework_versions WHERE payload->>'type'='ubl-solar' ORDER BY configuration_key,version",
        )
      ).rows;
    for (const [index, key] of ["20-40", "30-40", "30-60"].entries()) {
      const f = (
        await db.pool.query(
          "SELECT * FROM project_framework_current WHERE configuration_key=$1",
          ["UBL-BESS-" + key],
        )
      ).rows[0];
      assert(f);
      const c = await repo.create(actor, {
          requestKey: randomUUID(),
          customerId: 5,
          siteName: "Isolated approved BESS " + key,
          siteCode: "BESS-" + key,
          route: "direct-framework",
          frameworkId: f.id,
          notes: "Disposable approved agreement validation",
        }),
        d = await repo.detail(actor, c.id);
      const { r: privateRecord } = await repo.record(actor, c.id);
      const safe = restrictedCostView(privateRecord.data.basis.boq);
      assert.equal(safe.total, null);
      assert(
        safe.lines.every(
          (line: any) => line.rate === null && line.total === null,
        ),
      );
      assert.equal(safe.installationAllowance.total, undefined);
      assert(safe.epc.every((line: any) => line.cost === null));
      const preview = await repo.preview(actor, c.id, {
        kind: "framework",
        frameworkId: f.id,
      });
      assert.equal(
        preview.comparison.total,
        ["4200000.00", "4670000.00", "6150000.00"][index],
      );
      assert(
        preview.comparison.materials.some(
          (line: any) =>
            line.itemId === "CH-CBL-AC-25MM/4C-PK" &&
            line.qty === "10" &&
            line.description.includes("contractual"),
        ),
      );
      assert(preview.costing);
      assert(
        preview.costing.lines.every(
          (l: any) => l.restricted && l.cost === null,
        ),
      );
      const evidence = await repo.attach(actor, c.id, {
        kind: "PO / confirmation",
        filename: "approved-test.pdf",
        mime: "application/pdf",
        base64: Buffer.from("%PDF-1.4\n% test only\n%%EOF").toString("base64"),
      });
      const input = {
        reference: "BESS-PO-" + key,
        date: "2026-11-06",
        evidenceId: evidence.id,
        basisType: "framework",
        frameworkId: f.id,
        confirmationType: "Customer PO",
        actual: preview.comparison,
        reviewed: true,
        notes: "Exact approved BESS agreement test",
      };
      const snapshot = await repo.salePreview(actor, c.id, input);
      assert.equal(snapshot.allocation.total, preview.comparison.total);
      assert.equal(snapshot.input.customerNtn,'1234567-8');assert.equal(snapshot.input.customerStrn,'UBL-STRN-TEST');
      assert.equal(snapshot.cableAdjustment.initialDeduction, "0.00");
      assert.deepEqual(
        ptDisplayRows(snapshot.peachtree).map((p: any) => p.amount),
        f.payload.approved.selling,
      );
      const command = {
        version: d.record.version,
        requestKey: randomUUID(),
        action: "receipt",
        input,
      };
      await repo.action(actor, c.id, command);
      await repo.action(actor, c.id, command);
      const issued = (
        await db.pool.query(
          "SELECT i.snapshot,o.snapshot AS operations FROM project_workflow_issuances w JOIN internal_purchase_orders i ON i.id=w.ipo_id JOIN operations_boq_issuances o ON o.id=w.operations_id WHERE w.record_id=$1",
          [c.id],
        )
      ).rows[0];
      assert.equal(
        issued.snapshot.approvedCostSnapshot.costTotal,
        ["2895000.00", "3300500.00", "4480500.00"][index],
      );
      assert.equal(
        issued.snapshot.peachtree.epcBreakup[0].amount,
        f.payload.approved.selling[3],
      );
      const battery = issued.operations.items.find(
        (l: any) => l.itemId === "CH-BAT-HV-05 KW",
      );
      assert.equal(battery.qty, key === "30-60" ? "12" : "8");
      assert.equal(
        issued.operations.items.find((l: any) => l.itemId === "CH-BMS-HV").qty,
        key === "30-60" ? "4" : "2",
      );
      assert.equal(
        issued.operations.items.find(
          (l: any) => l.itemId === "CH-CBL-AC-16MM/4C-PK",
        ).qty,
        "10",
      );
      assert.equal(
        issued.operations.items.find(
          (l: any) => l.itemId === "CH-CBL-AC-25MM/4C-PK",
        ).qty,
        "20",
      );
      assert(
        !issued.operations.items.some(
          (l: any) => l.key === "Installation Cost",
        ),
      );
      assert.equal(
        snapshot.configurationContract.find((l: any) => l.contractItemId)
          .itemId,
        "CH-CBL-AC-25MM/4C-PK",
      );
      const ipo = buildIpoPdf(
          snapshot,
          "DRAFT - NOT ISSUED",
          snapshot.peachtree,
          { includePt: false },
        ),
        pt = buildPeachtreePdf(
          snapshot,
          snapshot.peachtree,
          "DRAFT - NOT ISSUED",
        );
      assert(ipo.length < 1000000 && pt.length < 1000000);
      assert(ipo.length > 1000 && pt.length > 1000);
      assert.equal(
        new Decimal(snapshot.allocation.subtotal)
          .add(snapshot.allocation.tax)
          .toFixed(2),
        snapshot.allocation.total,
      );
    }
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM internal_purchase_orders"))
        .rows[0].count,
      "3",
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT configuration_key,payload FROM project_framework_versions WHERE payload->>'type'='ubl-solar' ORDER BY configuration_key,version",
        )
      ).rows,
      before,
    );
  } finally {
    await db.close();
  }
});
