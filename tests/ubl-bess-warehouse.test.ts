import { materialDocumentPolicy } from "../shared/material-documents.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { ProjectWorkflowRepository } from "../server/project-workflow/repository.js";
import { MaterialDraftRepository } from "../server/inventory/material-drafts.js";
import {
  fixedPreparationRows,
  variablePreparationRows,
} from "../shared/material-preparation.js";
test("approved BESS IPOs supply existing fixed/variable warehouse rows without budget service stock or additional charges", async () => {
  const db = await testDatabase();
  try {
    const actor = randomUUID(),
      owner = randomUUID();
    await db.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,'warehouse-bess@example.test','Atif','unused','Coordinator')",
      [actor],
    );
    await db.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,'owner-bess@example.test','Owner','unused','Admin')",
      [owner],
    );
    const repo = new ProjectWorkflowRepository(db.pool),
      warehouse = new MaterialDraftRepository(db.pool);
    for (const key of ["20-40", "30-40", "30-60"]) {
      const f = (
        await db.pool.query(
          "SELECT id FROM project_framework_current WHERE configuration_key=$1",
          ["UBL-BESS-" + key],
        )
      ).rows[0];
      const created = await repo.create(actor, {
        requestKey: randomUUID(),
        customerId: 5,
        siteName: "Warehouse BESS fixture " + key,
        siteCode: "STOCK-" + key,
        route: "direct-framework",
        frameworkId: f.id,
        notes: "Isolated warehouse integration check",
      });
      const p = await repo.preview(actor, created.id, {
        kind: "framework",
        frameworkId: f.id,
      });
      const file = await repo.attach(actor, created.id, {
        kind: "PO / confirmation",
        filename: "test-po.pdf",
        mime: "application/pdf",
        base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
      });
      const { r } = await repo.record(actor, created.id);
      await repo.action(actor, r.id, {
        version: r.version,
        requestKey: randomUUID(),
        action: "receipt",
        input: {
          reference: "STOCK-PO-" + key,
          date: "2026-11-06",
          evidenceId: file.id,
          basisType: "framework",
          frameworkId: f.id,
          confirmationType: "Customer PO",
          actual: p.comparison,
          reviewed: true,
          notes: "Approved exact warehouse scope",
        },
      });
      const ipo = (
        await db.pool.query(
          "SELECT ipo_id FROM project_workflow_issuances WHERE record_id=$1",
          [r.id],
        )
      ).rows[0].ipo_id;
      const intake = await warehouse.intake(owner),
        source = intake.sources.find((s) => s.siteId === ipo);
      assert(
        source,
        "IPO is available through the normal warehouse intake link",
      );
      const fixed = fixedPreparationRows(
          source,
          intake.catalogue,
          randomUUID,
          intake.aliases,
        ),
        variable = variablePreparationRows(
          [source],
          intake.catalogue,
          randomUUID,
          intake.aliases,
        );
      assert(
        !fixed.some((l) => !l.itemId || !l.unit),
        "every fixed item resolves to an existing stock ID and unit",
      );
      for (const id of [
        "CH-CBL-AC-16MM/4C-PK",
        "CH-CBL-AC-25MM/4C-PK",
        "CH-CBL-ERT-10MM/1C-PK",
      ])
        assert(variable.some((l) => l.itemId === id));
      assert.equal(
        fixed.find((l) => l.itemId === "CH-BMS-HV")?.out,
        key === "30-60" ? "4" : "2",
      );
      assert(
        !fixed.some((l) =>
          /Installation Cost|Electrical Labour|Deliveries/.test(l.description),
        ),
      );
      assert(
        variable.every((l) => l.out === ""),
        "approved allowance must not invent dispatched quantities",
      );
      assert.equal(
        (await db.pool.query("SELECT count(*) FROM stock_on_hand_entries"))
          .rows[0].count,
        "0",
      );
      const saved = await warehouse.save(owner, {
        version: 0,
        requestKey: randomUUID(),
        kind: "variable",
        parent: false,
        warehouse: "Lahore warehouse",
        sites: [
          {
            sourceKind: source.sourceKind,
            basisId: source.basisId,
            basisVersion: 1,
            siteId: ipo,
          },
        ],
        lines: variable,
        transport: {
          issuedTo: "",
          vehicle: "",
          driver: "",
          driverIdentity: "",
        },
      });
      assert.equal(saved.stockPosting, false);
      const box = intake.catalogue.find((row) => row.itemId === "CH-11WAY-DB"),
        mixed = intake.catalogue.find(
          (row) => materialDocumentPolicy(row).group === "internal-variable",
        );
      assert(box);
      assert(mixed);
      const extra = (item: typeof box) => ({
        key: randomUUID(),
        itemId: item!.itemId,
        description: item!.description,
        unit: item!.units[0],
        out: "1",
        sites: [ipo],
      });
      await warehouse.save(owner, {
        version: 0,
        requestKey: randomUUID(),
        kind: "fixed",
        parent: false,
        warehouse: "Lahore warehouse",
        sites: [
          {
            sourceKind: source.sourceKind,
            basisId: source.basisId,
            basisVersion: 1,
            siteId: ipo,
          },
        ],
        lines: [...fixed, extra(box)],
        transport: {
          issuedTo: "",
          vehicle: "",
          driver: "",
          driverIdentity: "",
        },
      });
      await warehouse.save(owner, {
        id: saved.id,
        version: saved.version,
        requestKey: randomUUID(),
        kind: "variable",
        parent: false,
        warehouse: "Lahore warehouse",
        sites: [
          {
            sourceKind: source.sourceKind,
            basisId: source.basisId,
            basisVersion: 1,
            siteId: ipo,
          },
        ],
        lines: [...variable, extra(mixed)],
        transport: {
          issuedTo: "",
          vehicle: "",
          driver: "",
          driverIdentity: "",
        },
      });
      const frozen = (
        await db.pool.query(
          "SELECT snapshot FROM internal_purchase_orders WHERE id=$1",
          [ipo],
        )
      ).rows[0].snapshot;
      assert.equal(
        frozen.approvedCostSnapshot.costTotal,
        ["2895000.00", "3300500.00", "4480500.00"][
          ["20-40", "30-40", "30-60"].indexOf(key)
        ],
      );
      assert.equal(
        (await db.pool.query("SELECT count(*) FROM stock_on_hand_entries"))
          .rows[0].count,
        "0",
      );
    }
  } finally {
    await db.close();
  }
});
