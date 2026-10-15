import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { SiteExecutionRepository } from "../server/site-execution/repository.js";
import { ClosureRepository } from "../server/site-execution/closure.js";
import { hashPassword } from "../server/auth/crypto.js";

test("Cables against BOQ flag any variance; additional items are append-only and reported for Accounts", async () => {
  const db = await testDatabase();
  try {
    const owner = randomUUID(), admin = randomUUID(), operations = randomUUID(), accounts = randomUUID();
    const hash = await hashPassword("site-closure-test-password-4471");
    for (const [id, role] of [[owner, "Coordinator"], [admin, "Admin"], [operations, "Operations"], [accounts, "Accounts"]])
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, role, hash, role]);
    const records = await createDashboardSamples(db.pool, owner, admin);
    const source = records.find((r: any) => r.ipoId)!;
    const issuance = await new OperationsRepository(db.pool).issue(owner, { ipoId: source.ipoId, notes: "test", requestKey: randomUUID() });
    const sites = new SiteExecutionRepository(db.pool), closure = new ClosureRepository(db.pool);
    const site = (await sites.list(operations)).find((s) => s.issuanceId === issuance.id)!;

    const cables = await closure.cables(accounts, site.id);
    assert.ok(cables.length >= 2, "cable lines come from the BOQ");
    assert.ok(cables.every((c) => c.usedQty === null && c.direction === "Not entered"));
    const cable = cables[0];
    const boq = Number(cable.boqQty);

    await assert.rejects(closure.setCableUsage(accounts, site.id, { itemKey: cable.itemKey, usedQty: "1", returnedQty: "0", note: "" }), /Only Operations/);
    await assert.rejects(closure.setCableUsage(operations, site.id, { itemKey: "not-a-cable", usedQty: "1", returnedQty: "0", note: "" }), /not a cable line/);
    await closure.setCableUsage(operations, site.id, { itemKey: cable.itemKey, usedQty: String(boq + 5), returnedQty: "0", note: "Longer run on roof" });
    let after = (await closure.cables(operations, site.id)).find((c) => c.itemKey === cable.itemKey)!;
    assert.equal(after.variance, "5");
    assert.equal(after.flagged, true);
    assert.match(after.direction, /invoice/);
    await closure.setCableUsage(operations, site.id, { itemKey: cable.itemKey, usedQty: String(boq - 2), returnedQty: "2", note: "" });
    after = (await closure.cables(operations, site.id)).find((c) => c.itemKey === cable.itemKey)!;
    assert.equal(after.variance, "-2");
    assert.match(after.direction, /refund/);
    await closure.setCableUsage(operations, site.id, { itemKey: cable.itemKey, usedQty: String(boq), returnedQty: "0", note: "" });
    after = (await closure.cables(operations, site.id)).find((c) => c.itemKey === cable.itemKey)!;
    assert.equal(after.flagged, false);
    assert.equal(after.direction, "Matches BOQ");
    const detail = await sites.get(operations, site.id);
    assert.equal(detail.events.filter((e) => e.kind === "cable_usage").length, 3);

    const report = await closure.cableVarianceReport(accounts);
    assert.equal(report.sitesReported, 1);
    assert.equal(report.flaggedSites, 0);
    await closure.setCableUsage(operations, site.id, { itemKey: cables[1].itemKey, usedQty: String(Number(cables[1].boqQty) + 1), returnedQty: "0", note: "" });
    assert.equal((await closure.cableVarianceReport(accounts)).flaggedSites, 1);

    const itemId = await closure.addAdditionalItem(operations, site.id, { itemKey: null, description: "Extra conduit 25mm", quantity: "12", unit: "MTRS", reason: "Customer asked for concealed run" });
    let items = await closure.additionalItems(accounts, site.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, "12");
    await assert.rejects(db.pool.query("UPDATE site_additional_items SET quantity=20 WHERE id=$1", [itemId]), /only be withdrawn/);
    await assert.rejects(db.pool.query("DELETE FROM site_additional_items WHERE id=$1", [itemId]), /immutable/);
    assert.equal((await closure.additionalItemsReport(accounts)).length, 1);
    await closure.removeAdditionalItem(operations, site.id, itemId, { reason: "Entered twice" });
    items = await closure.additionalItems(accounts, site.id);
    assert.equal(items[0].removedAt != null, true);
    assert.equal((await closure.additionalItemsReport(accounts)).length, 0);
    await assert.rejects(closure.removeAdditionalItem(operations, site.id, itemId, { reason: "" }), /not found/);
  } finally {
    await db.close();
  }
});
