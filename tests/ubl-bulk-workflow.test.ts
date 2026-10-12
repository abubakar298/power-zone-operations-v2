import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { UblWorkflowRepository } from "../server/ubl/workflow-repository.js";
import {
  transition,
  ublStages,
  publicDocument,
} from "../server/ubl/workflow-state.js";
import { ublIpoSample } from "../server/ubl/ipo-sample.js";
test("UBL routes preserve acceptance, verification and separate advance preparation", () => {
  const d = {
    configuration: "20-20-30",
    technicalVerified: true,
    poNumber: "PO-A",
  };
  assert.equal(transition(ublStages[2], "po", "Coordinator", d), ublStages[5]);
  assert.equal(
    transition(ublStages[3], "advance", "Coordinator", d),
    ublStages[4],
  );
  assert.equal(transition(ublStages[4], "po", "Coordinator", d), ublStages[5]);
  assert.equal(transition(ublStages[6], "return", "Accounts", d), ublStages[5]);
  assert.equal(transition(ublStages[2], "defer", "Coordinator", d), "Deferred");
  assert.throws(
    () => transition(ublStages[4], "confirmed", "Coordinator", d),
    /Accounts must accept/,
  );
  assert.throws(
    () => transition(ublStages[6], "accept", "Coordinator", d),
    /department/,
  );
  assert.throws(
    () =>
      transition(ublStages[3], "advance", "Coordinator", {
        ...d,
        technicalVerified: false,
      }),
    /technical verification/,
  );
  assert.throws(
    () =>
      transition(ublStages[2], "po", "Coordinator", {
        ...d,
        configuration: "15-20-30",
      }),
    /four agreed/,
  );
  const existing = { ...d, originalOrderPreserved: true, ipoNumber: 315 };
  assert.equal(
    transition(ublStages[3], "revision-pending", "Admin", existing),
    "Existing job—Revised PO pending",
  );
  assert.throws(
    () => transition(ublStages[3], "revision-pending", "Admin", d),
    /existing job/,
  );
  assert.throws(
    () =>
      transition(
        "Existing job—Revised PO pending",
        "advance",
        "Coordinator",
        existing,
      ),
    /heads-up/,
  );
  assert.equal(
    transition(
      "Existing job—Revised PO pending",
      "po",
      "Coordinator",
      existing,
    ),
    ublStages[5],
  );
  const sensitive = {
    baseline: { cost: 123 },
    budgetSnapshot: { cost: 12 },
    sample: {
      budgetedCost: "100",
      markupAmount: "20",
      phases: [
        {
          name: "BMS",
          sellingExcludingGst: "120",
          budgetedCost: "100",
          markup: "20",
        },
      ],
    },
  };
  assert.equal(publicDocument(sensitive, "Accounts").baseline.cost, 123);
  for (const role of ["Coordinator", "Design", "Operations"]) {
    const p = publicDocument(sensitive, role);
    assert.equal(p.baseline, undefined);
    assert.equal(p.sample.phases[0].budgetedCost, undefined);
    assert.equal(p.sample.phases[0].sellingExcludingGst, "120");
  }
});
test("Reviewed bulk import is audited, idempotent, canonical and traverses IPO/Accounts/BOQ safely", async () => {
  const db = await testDatabase();
  try {
    const ids: Record<string, string> = {};
    for (const role of [
      "Admin",
      "Design",
      "Coordinator",
      "Operations",
      "Accounts",
      "Inventory",
    ]) {
      ids[role] = randomUUID();
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [
          ids[role],
          `${role.toLowerCase()}@example.test`,
          role,
          "fixture-only",
          role,
        ],
      );
    }
    const repo = new UblWorkflowRepository(db.pool),
      sha = (await repo.sources(ids.Admin))[0].sha256;
    const originalOrders = (
      await db.pool.query(
        "SELECT site_id,baseline FROM ubl_site_orders ORDER BY site_id",
      )
    ).rows;
    const before = Number(
      (await db.pool.query("SELECT count(*) FROM sites")).rows[0].count,
    );
    await assert.rejects(
      repo.import(ids.Coordinator, sha),
      /Administrator or Management/,
    );
    await repo.import(ids.Admin, sha);
    assert.equal((await repo.import(ids.Admin, sha)).repeated, true);
    const all = (await repo.list(ids.Coordinator)).requests;
    assert.equal(all.length, 36);
    assert.equal(
      Number((await db.pool.query("SELECT count(*) FROM sites")).rows[0].count),
      before + 34,
    );
    assert.equal(all.filter((r) => r.site_id === null).length, 1);
    assert.equal(all.filter((r) => r.data.configuration).length, 17);
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT site_id,baseline FROM ubl_site_orders ORDER BY site_id",
        )
      ).rows,
      originalOrders,
    );
    const sukho = (
      await db.pool.query(
        "SELECT site_id FROM ubl_site_orders WHERE branch_code='2756'",
      )
    ).rows[0];
    assert.equal(
      all.find((r) => r.branch_code === "2756").site_id,
      sukho.site_id,
    );
    assert.equal(
      all.find((r) => r.branch_code === "2756").data.originalOrderPreserved,
      true,
    );
    assert.equal(all.filter((r) => r.stage === ublStages[3]).length, 10);
    await assert.rejects(repo.list(ids.Inventory), /department access/);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*) FROM ubl_workflow_documents WHERE kind='Survey intake'",
        )
      ).rows[0].count,
      "36",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*) FROM ubl_workflow_documents WHERE kind='Recommendation draft'",
        )
      ).rows[0].count,
      "22",
    );
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM ubl_workflow_demand")).rows[0]
        .count,
      "0",
    );
    const go = all.find((r) => r.branch_code === "1967");
    let version = 1;
    await assert.rejects(
      repo.action(ids.Coordinator, go.id, version, "advance", {
        recipientId: ids.Operations,
      }),
      /technical verification/,
    );
    await repo.action(ids.Design, go.id, version++, "verify", {
      verified: true,
      configuration: "20-20-30",
      pricingStage: "Revised",
    });
    await assert.rejects(
      repo.action(ids.Design, go.id, 1, "save", {}),
      /changed/,
    );
    await repo.action(ids.Coordinator, go.id, version++, "advance", {
      recipientId: ids.Operations,
      notes: "Customer heads-up; preparation only",
    });
    assert.equal(
      (
        await db.pool.query(
          "SELECT mode FROM ubl_workflow_demand WHERE request_id=$1",
          [go.id],
        )
      ).rows[0].mode,
      "Provisional",
    );
    await repo.action(ids.Operations, go.id, version++, "acknowledge", {
      notes: "Material planning reviewed",
    });
    await assert.rejects(
      repo.action(ids.Coordinator, go.id, version, "po", {
        poNumber: "PO-GOJRA",
        date: "2026-10-13",
        configuration: "25-20-30",
        pricingStage: "Revised",
      }),
      /attach its original/,
    );
    await repo.attach(
      ids.Coordinator,
      go.id,
      "Customer PO",
      "PO.pdf",
      "application/pdf",
      Buffer.from("%PDF-fixture"),
    );
    await assert.rejects(
      repo.action(ids.Coordinator, go.id, version, "po", {
        poNumber: "PO-GOJRA",
        date: "2026-10-13",
        configuration: "25-20-30",
        pricingStage: "Revised",
      }),
      /differs from/,
    );
    await repo.action(ids.Coordinator, go.id, version++, "po", {
      poNumber: "PO-GOJRA",
      date: "2026-10-13",
      configuration: "20-20-30",
      pricingStage: "Revised",
    });
    await repo.action(ids.Coordinator, go.id, version++, "ipo", {
      ipoNumber: "9999",
    });
    let detail = await repo.detail(ids.Accounts, go.id);
    const ipo = detail.documents.find((d) => d.kind === "IPO / PT");
    assert.equal(ipo.snapshot.sample.totalPayable, "5279116.00");
    assert.equal(ipo.snapshot.sample.agreedWatts, 20000);
    const template = (
      await db.pool.query(
        "SELECT snapshot FROM ubl_site_document_versions WHERE snapshot->>'configuration_id'='20-20-30' AND snapshot->>'pricing_stage'='Revised' LIMIT 1",
      )
    ).rows[0].snapshot;
    const frozen = ublIpoSample({ ...template, status: "Active" });
    assert.deepEqual(
      ipo.snapshot.sample.phases.map((p: any) => p.sellingExcludingGst),
      frozen.phases.map((p) => p.sellingExcludingGst),
    );
    assert.equal(
      (await repo.detail(ids.Coordinator, go.id)).documents.find(
        (d) => d.kind === "IPO / PT",
      ).snapshot.baseline,
      undefined,
    );
    await assert.rejects(
      repo.action(ids.Coordinator, go.id, version, "accept", {}),
      /department/,
    );
    await repo.action(ids.Accounts, go.id, version++, "return", {
      notes: "Verify PO allocation",
    });
    await repo.action(ids.Design, go.id, version++, "verify", {
      verified: true,
      configuration: "20-20-30",
      pricingStage: "Revised",
    });
    await repo.action(ids.Coordinator, go.id, version++, "ipo", {
      ipoNumber: "9999",
    });
    await repo.action(ids.Accounts, go.id, version++, "accept", {});
    await repo.action(ids.Coordinator, go.id, version++, "confirmed", {
      recipientId: ids.Operations,
    });
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*),max(mode) AS mode FROM ubl_workflow_demand WHERE request_id=$1",
          [go.id],
        )
      ).rows[0].count,
      "1",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT mode FROM ubl_workflow_demand WHERE request_id=$1",
          [go.id],
        )
      ).rows[0].mode,
      "Confirmed",
    );
    assert.equal(
      (await repo.detail(ids.Operations, go.id)).request.stage,
      "Confirmed BOQ issued",
    );
    const unaffected = (await repo.list(ids.Admin)).requests.find(
      (r) => r.branch_code === "2771",
    );
    assert.equal(
      unaffected.version,
      1,
      "Partial batch action must not advance other sites",
    );
    assert.equal(
      (await db.pool.query("SELECT created_by FROM ubl_workflow_batches"))
        .rows[0].created_by,
      ids.Admin,
    );
  } finally {
    await db.close();
  }
});
