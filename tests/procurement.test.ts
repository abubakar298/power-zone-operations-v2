import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { ProcurementRepository } from "../server/procurement/repository.js";
import { hashPassword } from "../server/auth/crypto.js";

test("Procurement: stock against coming sites, purchase requests with quotations, Abu Bakar's approval, ordering, receiving, and access", async () => {
  const db = await testDatabase();
  try {
    const password = "procurement-test-password-2026";
    const hash = await hashPassword(password);
    const u = { owner: randomUUID(), admin: randomUUID(), buyer: randomUUID(), ops: randomUUID(), approver: randomUUID(), store: randomUUID(), accounts: randomUUID() };
    const people: [string, string, string][] = [
      [u.owner, "Coordinator", "Coordinator"], [u.admin, "Admin", "Admin"], [u.buyer, "Operations", "Hamza Mir"], [u.ops, "Operations", "Ops Person"],
      [u.approver, "Management", "Abu Bakar"], [u.store, "Inventory", "Shaigan"], [u.accounts, "Accounts", "Accounts"],
    ];
    for (const [id, role, name] of people)
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, name, hash, role]);
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','test'),($2,'approver','test')", [u.buyer, u.approver]);

    const records = await createDashboardSamples(db.pool, u.owner, u.admin);
    const ops = new OperationsRepository(db.pool);
    for (const r of records.filter((x: any) => x.ipoId).slice(0, 2)) await ops.issue(u.owner, { ipoId: r.ipoId, notes: "test", requestKey: randomUUID() });
    const repo = new ProcurementRepository(db.pool);

    // Who sees what.
    assert.deepEqual((await repo.me(u.buyer)).buyer, true);
    assert.deepEqual((await repo.me(u.approver)).approver, true);
    await assert.rejects(repo.overview(u.ops), /not part of your workspace/);
    await assert.rejects(repo.overview(u.accounts), /not part of your workspace/);

    // Stock against the two received POs.
    let o = await repo.overview(u.buyer);
    assert.equal(o.receivedPOs.length, 2);
    assert.ok(o.receivedPOs.every((p) => p.pending && p.material === "short"), "nothing is in stock yet");
    const cable = o.inventory.find((i) => /DC Cable Red/.test(i.itemKey))!;
    assert.ok(cable && cable.boughtByBuyer && Number(cable.toBuy) > 0);
    const battery = o.inventory.find((i) => /^BAT/.test(i.itemKey))!;
    assert.equal(battery.boughtByBuyer, false, "batteries are not bought through Procurement");
    assert.ok(!o.inventory.some((i) => /^(Labour|Delivery|Structure)/.test(i.itemKey)), "service lines are not stock");
    await repo.setCount(u.store, { itemKey: cable.itemKey, quantity: "10", unit: "m", note: "Store count" });
    await assert.rejects(repo.setCount(u.ops, { itemKey: cable.itemKey, quantity: "1", unit: "m", note: "" }), /Only Store can enter stock counts/);
    await assert.rejects(repo.setCount(u.buyer, { itemKey: cable.itemKey, quantity: "1", unit: "m", note: "" }), /Only Store can enter stock counts/);
    o = await repo.overview(u.buyer);
    const counted = o.inventory.find((i) => i.itemKey === cable.itemKey)!;
    assert.equal(counted.inStock, "10");
    assert.equal(Number(counted.toBuy), Number(cable.toBuy) - 10);

    // A request from "To buy": no batteries, BMS or inverters.
    let r = await repo.createFromToBuy(u.buyer);
    const requestedNow = (await repo.overview(u.buyer)).inventory.find((i) => i.itemKey === cable.itemKey)!;
    assert.equal(requestedNow.toBuy, "0", "items already on a request are not counted to buy again");
    assert.equal(requestedNow.requested, counted.toBuy);
    await assert.rejects(repo.createFromToBuy(u.buyer).then((x) => { if (x.lines.some((l) => l.itemKey === cable.itemKey)) throw new Error("cable requested twice"); throw new Error("Nothing to buy"); }), /Nothing to buy/);
    assert.ok(r.lines.length > 0);
    assert.ok(r.lines.every((l) => !/^(BAT|CH-BMS|HYB)/.test(l.itemKey)), "batteries, BMS and inverters stay off the buyer's request");
    assert.match(r.number, /^PR-\d{2}-\d{3}$/);
    await assert.rejects(repo.addLine(u.buyer, r.id, { itemKey: battery.itemKey, quantity: "1", unit: "", note: "" }), /not bought through Procurement/);
    await assert.rejects(repo.addQuote(u.ops, r.id, r.lines[0].id, { vendor: "X", rate: "1", note: "" }), /Only the Procurement buyer/);

    // Quotations: the lowest is chosen until the buyer picks another.
    const line = r.lines.find((l) => l.itemKey === cable.itemKey)!;
    r = await repo.addQuote(u.buyer, r.id, line.id, { vendor: "Pak Cables", rate: "120", note: "" });
    r = await repo.addQuote(u.buyer, r.id, line.id, { vendor: "Powerline", rate: "110", note: "" });
    let l1 = r.lines.find((l) => l.id === line.id)!;
    assert.equal(l1.chosen?.vendor, "Powerline", "the lowest is chosen until the buyer picks another");
    r = await repo.chooseQuote(u.buyer, r.id, line.id, l1.best!.id);
    l1 = r.lines.find((l) => l.id === line.id)!;
    assert.equal(l1.chosen?.vendor, "Powerline");
    assert.equal(l1.lastRate, null, "cable has no rate in the rate master yet");
    await assert.rejects(repo.submit(u.buyer, r.id), /Add a quotation for/);
    for (const l of r.lines.filter((x) => x.id !== line.id)) r = await repo.addQuote(u.buyer, r.id, l.id, { vendor: "Powerline", rate: "50", note: "" });
    r = await repo.submit(u.buyer, r.id);
    assert.equal(r.status, "pending_approval");
    await assert.rejects(db.pool.query("UPDATE purchase_request_lines SET quantity=1 WHERE request_id=$1", [r.id]), /only change while the request is a draft/);
    await assert.rejects(repo.addQuote(u.buyer, r.id, line.id, { vendor: "Late", rate: "1", note: "" }), /Only a draft request can be changed/);

    // Only Abu Bakar decides; sending back or rejecting needs a note.
    await assert.rejects(repo.decide(u.buyer, r.id, { decision: "approve", note: "" }), /Only Abu Bakar/);
    await assert.rejects(repo.decide(u.admin, r.id, { decision: "approve", note: "" }), /Only Abu Bakar/);
    await assert.rejects(repo.decide(u.approver, r.id, { decision: "send_back", note: "" }), /Write a note/);
    r = await repo.decide(u.approver, r.id, { decision: "send_back", note: "Get a second quote for the cable." });
    assert.equal(r.status, "draft");
    assert.equal(r.decisionNote, "Get a second quote for the cable.");
    r = await repo.submit(u.buyer, r.id);
    r = await repo.decide(u.approver, r.id, { decision: "approve", note: "OK" });
    assert.equal(r.status, "approved");
    assert.equal(r.can.order, false, "the approver does not order");

    // On order counts against what to buy; the buyer orders; Store receives into stock.
    o = await repo.overview(u.buyer);
    assert.equal(o.inventory.find((i) => i.itemKey === cable.itemKey)!.onOrder, l1.quantity);
    r = await repo.markOrdered(u.buyer, r.id, { orderReference: "Powerline SO-2210" });
    assert.equal(r.status, "ordered");
    const one = { lines: [{ itemKey: cable.itemKey, quantity: "1" }], note: "" };
    await assert.rejects(repo.markReceived(u.accounts, r.id, one), /Only Store can receive/);
    await assert.rejects(repo.markReceived(u.buyer, r.id, one), /Only Store can receive/, "the buyer does not receive; Store does");
    // Store (Shaigan) sees what to receive and every item to count, but no purchase prices.
    const store = await repo.storeView(u.store);
    const waiting = store.toReceive.find((x) => x.id === r.id)!;
    assert.ok(waiting && waiting.lines.length === r.lines.length, "the ordered request is waiting at Store");
    assert.ok(!JSON.stringify(store).includes('"rate"') && !JSON.stringify(store).includes('"total"'), "Store's page carries no prices");
    assert.ok(store.items.some((i) => i.itemKey === battery.itemKey), "Store counts batteries too");
    await assert.rejects(repo.storeView(u.buyer), /belongs to Store/);
    await assert.rejects(repo.listRequests(u.store), /not part of the Store workspace/);
    await assert.rejects(repo.getRequest(u.store, r.id), /not part of the Store workspace/);
    assert.equal((await repo.overview(u.store)).requests.length, 0, "Store's overview has no request totals");
    // Part of the cable arrives: it goes into stock, the rest stays on order and on Store's list.
    const part = await repo.markReceived(u.store, r.id, { lines: [{ itemKey: cable.itemKey, quantity: "5" }], note: "First lot" });
    assert.equal(part.status, "ordered");
    const partRow = (await repo.overview(u.buyer)).inventory.find((i) => i.itemKey === cable.itemKey)!;
    assert.equal(Number(partRow.inStock), 15);
    assert.equal(Number(partRow.onOrder), Number(l1.quantity) - 5, "only what is still due counts as on order");
    const dueLine = (await repo.storeView(u.store)).toReceive.find((x) => x.id === r.id)!.lines.find((l) => l.itemKey === cable.itemKey)!;
    assert.equal(Number(dueLine.received), 5);
    assert.equal(Number(dueLine.due), Number(l1.quantity) - 5);
    assert.equal(Number((await repo.getRequest(u.buyer, r.id)).lines.find((l) => l.itemKey === cable.itemKey)!.received), 5);
    await assert.rejects(repo.markReceived(u.store, r.id, { lines: [{ itemKey: cable.itemKey, quantity: l1.quantity }], note: "" }), /still due on this order/);
    await assert.rejects(repo.markReceived(u.store, r.id, { lines: [{ itemKey: cable.itemKey, quantity: "0" }], note: "" }), /at least one item/);
    await assert.rejects(repo.markReceived(u.store, r.id, { lines: [{ itemKey: battery.itemKey, quantity: "1" }], note: "" }), /not on this order/);
    // The rest arrives and the request closes.
    const rest = (await repo.storeView(u.store)).toReceive.find((x) => x.id === r.id)!.lines.map((l) => ({ itemKey: l.itemKey, quantity: l.due }));
    const received = await repo.markReceived(u.store, r.id, { lines: rest, note: "All arrived" });
    assert.equal(received.status, "received");
    assert.ok(!(await repo.storeView(u.store)).toReceive.some((x) => x.id === r.id), "a fully received order leaves Store's list");
    assert.ok(!("totals" in received), "receiving returns no prices to Store");
    r = await repo.getRequest(u.buyer, r.id);
    assert.equal(r.status, "received");
    o = await repo.overview(u.buyer);
    const after = o.inventory.find((i) => i.itemKey === cable.itemKey)!;
    assert.equal(Number(after.inStock), 10 + Number(l1.quantity), "received quantities are added to stock");
    assert.equal(after.onOrder, "0");
    assert.deepEqual(r.events.map((e) => e.kind).reverse(), ["created", "submitted", "sent_back", "submitted", "approved", "ordered", "part_received", "received"]);
    await assert.rejects(db.pool.query("DELETE FROM purchase_request_events WHERE request_id=$1", [r.id]), /immutable/);

    // The approved purchase is now the cable's last buying rate.
    let next = await repo.createRequest(u.buyer, { title: "Cable top-up", purpose: "", neededBy: null, deliveryTo: "Power Zone Store", paymentTerms: "" });
    next = await repo.addLine(u.buyer, next.id, { itemKey: cable.itemKey, quantity: "5", unit: l1.unit, note: "" });
    assert.match(next.lines[0].lastRate!.source, new RegExp(`Last purchase ${r.number}`));
    assert.equal(next.lines[0].lastRate!.rate, "110");
    next = await repo.cancel(u.buyer, next.id, { note: "not needed" });
    assert.equal(next.status, "cancelled");

    // HTTP: the buyer gets Procurement and nothing from Operations; other Operations logins are unchanged.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "procurement-setup-token-12345678901" }));
    const login = async (id: string) => {
      const res = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: `${id}@example.test`, password });
      assert.equal(res.status, 200, res.text);
      return res.headers["set-cookie"] as unknown as string[];
    };
    const buyer = await login(u.buyer), other = await login(u.ops), approver = await login(u.approver), accounts = await login(u.accounts);
    const get = (cookie: string[], path: string) => request(app).get(path).set("Cookie", cookie);
    assert.equal((await get(buyer, "/api/procurement/overview")).status, 200);
    assert.equal((await get(buyer, "/api/site-workflow")).status, 403);
    assert.equal((await get(buyer, "/api/project-workflow/advance-inbox")).status, 403);
    assert.equal((await get(other, "/api/procurement/me")).status, 200);
    assert.equal((await get(other, "/api/procurement/overview")).status, 403);
    assert.equal((await get(other, "/api/site-workflow")).status, 200);
    assert.equal((await get(approver, "/api/procurement/requests")).status, 200);
    assert.equal((await get(accounts, "/api/procurement/overview")).status, 403);
    const storeLogin = await login(u.store);
    assert.equal((await get(storeLogin, "/api/procurement/store")).status, 200);
    assert.equal((await get(storeLogin, "/api/procurement/requests")).status, 403);
  } finally {
    await db.close();
  }
});
