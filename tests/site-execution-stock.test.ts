import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { SiteExecutionRepository } from "../server/site-execution/repository.js";
import { StockRepository } from "../server/site-execution/stock.js";
import { VendorsRepository } from "../server/site-execution/vendors.js";
import { ProcurementRepository } from "../server/site-execution/procurement.js";
import { hashPassword } from "../server/auth/crypto.js";

test("Stock counts, reservations with availability, shortage from issued BOQs, vendors, assignments and procurement", async () => {
  const db = await testDatabase();
  try {
    const owner = randomUUID(), admin = randomUUID(), operations = randomUUID(), store = randomUUID(), accounts = randomUUID();
    const password = "site-stock-test-password-9031";
    const hash = await hashPassword(password);
    for (const [id, role] of [[owner, "Coordinator"], [admin, "Admin"], [operations, "Operations"], [store, "Inventory"], [accounts, "Accounts"]])
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, role, hash, role]);
    const records = await createDashboardSamples(db.pool, owner, admin);
    const ops = new OperationsRepository(db.pool);
    const issued: { id: string }[] = [];
    for (const r of records.filter((x: any) => x.ipoId))
      issued.push(await ops.issue(owner, { ipoId: r.ipoId, notes: "test", requestKey: randomUUID() }));
    assert.ok(issued.length >= 1);

    const sites = new SiteExecutionRepository(db.pool), stock = new StockRepository(db.pool);
    const list = await sites.list(operations);
    const site = list.find((s) => s.issuanceId === issued[0].id)!;
    const materials = await stock.siteMaterials(operations, site.id);
    assert.ok(materials.lines.length > 0, "site BOQ lines come from operations_stock_demand");
    const line = materials.lines[0];
    assert.equal(line.existing, null, "no count yet");

    // Shortage before any count equals the full requirement across planning-stage sites.
    let overview = await stock.overview(store);
    const before = overview.items.find((i) => i.itemKey === line.itemKey)!;
    assert.ok(before, "item appears in the shortage overview");
    assert.equal(before.counted, false);
    assert.equal(Number(before.shortage), Number(before.required));
    assert.ok(Number(before.requiredIssued) >= Number(line.boqQty));

    // Store enters a count; Operations reserves within availability only.
    await assert.rejects(stock.setCount(accounts, { itemKey: line.itemKey, quantity: "5", note: "" }), /Only Store/);
    await stock.setCount(store, { itemKey: line.itemKey, quantity: "5", note: "Opening count" });
    await assert.rejects(stock.reserve(operations, site.id, { itemKey: line.itemKey, quantity: "6", note: "" }), /Only 5 available/);
    const reservationId = await stock.reserve(operations, site.id, { itemKey: line.itemKey, quantity: "3", note: "For first delivery" });
    await assert.rejects(stock.reserve(operations, site.id, { itemKey: line.itemKey, quantity: "3", note: "" }), /Only 2 available/);
    await assert.rejects(stock.reserve(store, site.id, { itemKey: line.itemKey, quantity: "1", note: "" }), /Only Operations or Management/);
    overview = await stock.overview(operations);
    const after = overview.items.find((i) => i.itemKey === line.itemKey)!;
    assert.equal(after.existing, "5");
    assert.equal(after.reserved, "3");
    assert.equal(after.available, "2");
    assert.equal(Number(after.shortage), Math.max(Number(after.required) - 5, 0));
    assert.equal(overview.reservations.length, 1);
    const detail = await sites.get(operations, site.id);
    assert.equal(detail.reservations.length, 1);
    assert.equal(detail.events[0].kind, "reservation");
    await assert.rejects(db.pool.query("UPDATE stock_reservations SET quantity=1 WHERE id=$1", [reservationId]), /only be released once/);
    await stock.release(operations, site.id, reservationId, { reason: "Dispatched" });
    assert.equal((await stock.overview(operations)).items.find((i) => i.itemKey === line.itemKey)!.reserved, "0");
    await assert.rejects(stock.release(operations, site.id, reservationId, { reason: "again" }), /not found/);

    // A site that moved past planning stops counting as required.
    await sites.setStage(operations, site.id, { stage: "dispatched", note: "" });
    const afterDispatch = (await stock.overview(operations)).items.find((i) => i.itemKey === line.itemKey);
    assert.ok(!afterDispatch || Number(afterDispatch.requiredIssued) === Number(after.requiredIssued) - Number(line.boqQty));

    // Vendors: unique per category, right category and active when assigned, one active per category.
    const vendors = new VendorsRepository(db.pool);
    const steel = await vendors.save(operations, { name: "Steel Works", category: "Structure", regions: ["Punjab"], contactPerson: "", phone: "", email: "", notes: "", status: "Active" });
    await assert.rejects(vendors.save(operations, { name: " steel works ", category: "Structure", regions: [], contactPerson: "", phone: "", email: "", notes: "", status: "Active" }), /already exists/);
    const movers = await vendors.save(operations, { name: "Fast Movers", category: "Delivery", regions: [], contactPerson: "", phone: "", email: "", notes: "", status: "Active" });
    await assert.rejects(vendors.assign(operations, site.id, { category: "Structure", vendorId: movers.id, agreedDate: null, notes: "" }), /is a Delivery vendor/);
    const a1 = await vendors.assign(operations, site.id, { category: "Structure", vendorId: steel.id, agreedDate: "2026-10-20", notes: "" });
    const steel2 = await vendors.save(operations, { name: "Steel Works Two", category: "Structure", regions: [], contactPerson: "", phone: "", email: "", notes: "", status: "Active" });
    const a2 = await vendors.assign(operations, site.id, { category: "Structure", vendorId: steel2.id, agreedDate: null, notes: "Replacement" });
    let d = await sites.get(operations, site.id);
    assert.equal(d.vendors.length, 1, "one active vendor per category");
    assert.equal(d.vendors[0].id, a2);
    assert.notEqual(a1, a2);
    await vendors.unassign(operations, site.id, a2);
    d = await sites.get(operations, site.id);
    assert.equal(d.vendors.length, 0);
    await vendors.save(operations, { id: steel.id, name: "Steel Works", category: "Structure", regions: [], contactPerson: "", phone: "", email: "", notes: "", status: "Inactive" });
    await assert.rejects(vendors.assign(operations, site.id, { category: "Structure", vendorId: steel.id, agreedDate: null, notes: "" }), /inactive/);

    // Procurement: created from a shortage, status moves recorded, closed requests frozen.
    const procurement = new ProcurementRepository(db.pool);
    const pid = await procurement.create(operations, { executionId: site.id, itemKey: line.itemKey, serviceCategory: null, description: `Buy ${line.name}`, quantity: "10", unit: line.unit, vendorId: null, expectedDate: null, amount: null, notes: "" });
    await procurement.update(operations, pid, { status: "Quoted", vendorId: movers.id, amount: "1500.50", note: "Quote received" });
    assert.equal((await stock.overview(operations)).items.find((i) => i.itemKey === line.itemKey)?.onOrder, "10");
    await procurement.update(operations, pid, { status: "Received", note: "" });
    await assert.rejects(procurement.update(operations, pid, { status: "Ordered", note: "" }), /cannot change status/);
    const reqs = await procurement.list(accounts, site.id);
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].status, "Received");
    assert.equal(reqs[0].vendorName, "Fast Movers");
    assert.equal((await db.pool.query("SELECT count(*)::int n FROM procurement_request_events WHERE request_id=$1", [pid])).rows[0].n, 3);

    // HTTP: Store may post counts but not reservations; Accounts reads the overview.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "site-stock-setup-token-123456789012" }));
    const login = async (id: string) => {
      const r = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: `${id}@example.test`, password });
      assert.equal(r.status, 200, r.text);
      return { cookie: r.headers["set-cookie"], csrf: r.body.csrfToken as string };
    };
    const inv = await login(store), acc = await login(accounts);
    const counted = await request(app).post("/api/site-execution/stock/counts").set("Cookie", inv.cookie).set("Origin", "http://127.0.0.1:3000").set("X-CSRF-Token", inv.csrf).send({ itemKey: line.itemKey, quantity: "7", note: "Recount" });
    assert.equal(counted.status, 200, counted.text);
    assert.equal(counted.body.items.find((i: any) => i.itemKey === line.itemKey).existing, "7");
    const denied = await request(app).post(`/api/site-execution/${site.id}/reservations`).set("Cookie", inv.cookie).set("Origin", "http://127.0.0.1:3000").set("X-CSRF-Token", inv.csrf).send({ itemKey: line.itemKey, quantity: "1" });
    assert.equal(denied.status, 403);
    const read = await request(app).get("/api/site-execution/stock").set("Cookie", acc.cookie);
    assert.equal(read.status, 200);
    assert.ok(Array.isArray(read.body.items));
  } finally {
    await db.close();
  }
});
