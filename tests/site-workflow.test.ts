import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { SiteWorkflowRepository } from "../server/site-workflow/repository.js";
import { hashPassword } from "../server/auth/crypto.js";

test("Site workflow: IPO received → planning → delivery → (install & commission | delivery only) → … → closed, with gates, vendors, pictures, problems, cables and access", async () => {
  const db = await testDatabase();
  try {
    const owner = randomUUID(), admin = randomUUID(), operations = randomUUID(), inventory = randomUUID(), accounts = randomUUID();
    const password = "site-workflow-test-password-2026";
    const hash = await hashPassword(password);
    for (const [id, role] of [[owner, "Coordinator"], [admin, "Admin"], [operations, "Operations"], [inventory, "Inventory"], [accounts, "Accounts"]])
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, role, hash, role]);
    const records = await createDashboardSamples(db.pool, owner, admin);
    const sources = records.filter((r: any) => r.ipoId);
    assert.ok(sources.length >= 2, "the training batch has at least two IPOs");
    const ops = new OperationsRepository(db.pool);
    const issued: { id: string }[] = [];
    for (const s of sources.slice(0, 2)) issued.push(await ops.issue(owner, { ipoId: s.ipoId, notes: "test", requestKey: randomUUID() }));

    const repo = new SiteWorkflowRepository(db.pool);
    const board = await repo.list(operations);
    assert.equal(board.length, 2, "one workflow row per issuance");
    assert.ok(board.every((s) => s.stage === "ipo_received" && s.nextStage === "planning" && s.previousStage === null));
    assert.equal((await repo.list(accounts)).length, 2, "Accounts reads the board");
    await assert.rejects(repo.list(randomUUID()), /not active/);
    const a = board.find((s) => s.issuanceId === issued[0].id)!, b = board.find((s) => s.issuanceId === issued[1].id)!;

    // --- Site A: the full installation path. ---
    let d = await repo.forward(operations, a.id, { note: "Planning starts" });
    assert.equal(d.stage, "planning");
    assert.equal(d.events[0].kind, "stage_forward");
    await assert.rejects(repo.forward(operations, a.id, { note: "" }), /expected delivery date/);
    d = await repo.update(operations, a.id, { expectedStart: "2026-10-12", expectedDelivery: "2026-10-11", expectedCompletion: "2026-10-15", region: "Punjab", siteType: "Solar + BESS" });
    assert.equal(d.region, "Punjab");
    assert.ok(d.events.find((e) => e.kind === "field_update" && e.changes.expectedDelivery?.to === "2026-10-11"));
    // Vendors are chosen under planning.
    const vendor = await repo.saveVendor(operations, { name: "Fast Movers", category: "Delivery", contactPerson: "", phone: "", notes: "", status: "Active" });
    await assert.rejects(repo.saveVendor(operations, { name: "fast movers", category: "Delivery", contactPerson: "", phone: "", notes: "", status: "Active" }), /already exists/);
    d = await repo.assignVendor(operations, a.id, { category: "Delivery", vendorId: vendor.id, agreedDate: "2026-10-11", notes: "" });
    assert.equal(d.vendors[0].vendorName, "Fast Movers");
    await assert.rejects(repo.assignVendor(operations, a.id, { category: "Structure", vendorId: vendor.id, agreedDate: null, notes: "" }), /is a Delivery vendor/);
    await assert.rejects(db.pool.query("UPDATE site_workflow_vendor_assignments SET notes='x' WHERE id=$1", [d.vendors[0].id]), /only be removed/);
    d = await repo.forward(operations, a.id, { note: "" });
    assert.equal(d.stage, "delivery");
    await assert.rejects(repo.forward(operations, a.id, { note: "" }), /Decide first/);
    d = await repo.update(operations, a.id, { scope: "installation" });
    await assert.rejects(repo.forward(operations, a.id, { note: "" }), /delivery date/);
    d = await repo.update(operations, a.id, { deliveredOn: "2026-10-11" });
    d = await repo.forward(operations, a.id, { note: "" });
    assert.equal(d.stage, "installation");
    await assert.rejects(repo.update(operations, a.id, { scope: "delivery_only" }), /Go back to Delivery/);
    await assert.rejects(repo.forward(operations, a.id, { note: "" }), /installation start date/);
    await assert.rejects(repo.setPictures(operations, a.id, { day: "2026-10-12", pictures: true }), /start date first/);
    d = await repo.update(operations, a.id, { startedOn: "2026-10-12", installationCompletedOn: "2026-10-13" });
    await assert.rejects(repo.update(operations, a.id, { installationCompletedOn: "2026-10-10" }), /cannot finish before/);
    d = await repo.setPictures(operations, a.id, { day: "2026-10-12", pictures: true });
    d = await repo.setPictures(operations, a.id, { day: "2026-10-13", pictures: false });
    assert.equal(d.pictureDays.length, 2);
    assert.equal(d.missingPictureDays, 1);
    await assert.rejects(repo.setPictures(operations, a.id, { day: "2026-10-30", pictures: true }), /Picture days run/);
    d = await repo.addProblem(operations, a.id, { problem: "Roof access blocked." });
    assert.equal(d.openProblems, 1);
    await assert.rejects(db.pool.query("UPDATE site_workflow_problems SET problem='x' WHERE id=$1", [d.problems[0].id]), /immutable/);
    d = await repo.resolveProblem(operations, a.id, d.problems[0].id, { resolution: "Keys found." });
    assert.equal(d.openProblems, 0);
    d = await repo.forward(operations, a.id, { note: "" });
    assert.equal(d.stage, "commissioning");
    d = await repo.update(operations, a.id, { commissionedOn: "2026-10-14", matriCloud: "Connected", fourG: "Not connected" });
    assert.equal(d.matriCloud, "Connected");
    d = await repo.update(operations, a.id, { siteType: "UPS" });
    assert.equal(d.matriCloud, null, "UPS clears the monitoring status");
    assert.equal(d.fourG, null);
    d = await repo.update(operations, a.id, { siteType: "Solar + BESS", matriCloud: "Connected", fourG: "Connected" });
    d = await repo.forward(operations, a.id, { note: "" });
    assert.equal(d.stage, "handover");
    // Cables against BOQ and additional items belong to handover.
    assert.ok(d.cables.length >= 2, "cable lines come from the BOQ");
    const cable = d.cables[0], boq = Number(cable.boqQty);
    await assert.rejects(repo.setCable(operations, a.id, { itemKey: "not-a-cable", usedQty: "1", returnedQty: "0", note: "" }), /not a cable line/);
    d = await repo.setCable(operations, a.id, { itemKey: cable.itemKey, usedQty: String(boq + 5), returnedQty: "0", note: "Longer run" });
    let line = d.cables.find((c) => c.itemKey === cable.itemKey)!;
    assert.equal(line.variance, "5");
    assert.match(line.direction, /invoice/);
    d = await repo.setCable(operations, a.id, { itemKey: cable.itemKey, usedQty: String(boq - 2), returnedQty: "2", note: "" });
    line = d.cables.find((c) => c.itemKey === cable.itemKey)!;
    assert.match(line.direction, /refund/);
    d = await repo.addAdditionalItem(operations, a.id, { description: "Extra conduit 25mm", quantity: "12", unit: "MTRS", reason: "Concealed run" });
    assert.equal(d.additionalItems.length, 1);
    await assert.rejects(db.pool.query("UPDATE site_workflow_additional_items SET quantity=20 WHERE id=$1", [d.additionalItems[0].id]), /only be withdrawn/);
    await assert.rejects(repo.forward(operations, a.id, { note: "" }), /handover date/);
    d = await repo.update(operations, a.id, { handedOverOn: "2026-10-15", customerSignoff: true });
    d = await repo.forward(operations, a.id, { note: "" });
    assert.equal(d.stage, "doc_dispatch");
    await assert.rejects(repo.forward(operations, a.id, { note: "" }), /submitted to the customer/);
    d = await repo.update(operations, a.id, { doDate: "2026-10-11", acknowledgementDate: "2026-10-15", submittedToCustomerDate: "2026-10-16", advanceClaimed: true });
    d = await repo.forward(operations, a.id, { note: "All documents out" });
    assert.equal(d.stage, "closed");
    assert.ok(d.closedAt, "closing stamps closed_at");
    assert.equal(d.nextStage, null);
    await assert.rejects(repo.forward(operations, a.id, { note: "" }), /closed/);
    // Going back needs a reason and reopens the site.
    await assert.rejects(repo.back(operations, a.id, { note: "" }), /Say why/);
    d = await repo.back(operations, a.id, { note: "Ack was for the wrong branch" });
    assert.equal(d.stage, "doc_dispatch");
    assert.equal(d.closedAt, null);
    assert.equal(d.events[0].kind, "stage_back");
    await assert.rejects(db.pool.query("UPDATE site_workflow_events SET note='x' WHERE workflow_id=$1", [a.id]), /immutable/);

    // --- Site B: delivery only closes straight after delivery. ---
    d = await repo.forward(operations, b.id, { note: "" });
    d = await repo.update(operations, b.id, { expectedDelivery: "2026-10-10" });
    d = await repo.forward(operations, b.id, { note: "" });
    d = await repo.update(operations, b.id, { scope: "delivery_only", deliveredOn: "2026-10-10" });
    assert.equal(d.nextStage, "closed");
    d = await repo.forward(operations, b.id, { note: "Customer installs" });
    assert.equal(d.stage, "closed");
    assert.equal(d.previousStage, "delivery");
    d = await repo.back(operations, b.id, { note: "They want us to install after all" });
    assert.equal(d.stage, "delivery");
    d = await repo.update(operations, b.id, { scope: "installation" });
    assert.equal(d.nextStage, "installation");

    // Access: Store and Accounts read, only Operations and management write.
    await assert.rejects(repo.forward(inventory, a.id, { note: "" }), /Only Operations or Management/);
    await assert.rejects(repo.update(accounts, a.id, { notes: "x" }), /Only Operations or Management/);
    const report = await repo.report(accounts);
    assert.equal(report.sites.length, 2);
    assert.equal(report.cables.filter((c) => c.flagged).length, 1);
    assert.equal(report.additionalItems.length, 1);

    // HTTP: the Operations login reaches the workflow; Store may read but not write.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "site-workflow-setup-token-1234567890" }));
    const login = async (id: string) => {
      const r = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: `${id}@example.test`, password });
      assert.equal(r.status, 200, r.text);
      return { cookie: r.headers["set-cookie"] as unknown as string[], csrf: r.body.csrfToken as string };
    };
    const op = await login(operations), inv = await login(inventory);
    const overview = await request(app).get("/api/site-workflow").set("Cookie", op.cookie);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.sites.length, 2);
    assert.equal(overview.body.stages[0].key, "ipo_received");
    assert.equal(overview.body.stages.at(-1).key, "closed");
    const move = await request(app).post(`/api/site-workflow/${b.id}/forward`).set("Cookie", op.cookie).set("Origin", "http://127.0.0.1:3000").set("X-CSRF-Token", op.csrf).send({ note: "" });
    assert.equal(move.status, 200, move.text);
    assert.equal(move.body.stage, "installation", "site B had its delivery date and scope, so it moves on");
    const blocked = await request(app).post(`/api/site-workflow/${b.id}/forward`).set("Cookie", op.cookie).set("Origin", "http://127.0.0.1:3000").set("X-CSRF-Token", op.csrf).send({ note: "" });
    assert.equal(blocked.status, 422, blocked.text);
    assert.match(blocked.body.message ?? blocked.text, /installation start date/);
    const denied = await request(app).post(`/api/site-workflow/${b.id}/forward`).set("Cookie", inv.cookie).set("Origin", "http://127.0.0.1:3000").set("X-CSRF-Token", inv.csrf).send({ note: "" });
    assert.equal(denied.status, 403);
    assert.equal((await request(app).get(`/api/site-workflow/${b.id}`).set("Cookie", inv.cookie)).status, 200);
    assert.equal((await request(app).get("/api/site-workflow/report").set("Cookie", inv.cookie)).status, 200);
  } finally {
    await db.close();
  }
});
