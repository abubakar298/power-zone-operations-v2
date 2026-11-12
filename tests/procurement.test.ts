import { test } from "node:test";
import {materialStockFixture} from "./material-stock-fixture.js";
import {WarehouseAuthorityRepository} from "../server/inventory/warehouse-ledger.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { ProcurementRepository } from "../server/procurement/repository.js";
import { procurementWarehouseStock } from "../server/procurement/warehouse-stock.js";
import { OperationsBoardRepository } from "../server/operations-board/repository.js";
import { commandSchema } from "../server/operations-board/schema.js";
import { recordPtEntry } from "../server/accounts/pt-entries.js";
import { MaterialStockRepository } from "../server/inventory/material-stock.js";
import { PurchaseReceivingRepository } from "../server/inventory/purchase-receiving.js";
import { RfqRepository, buildRfqPdf, buildApprovedPurchasePdf } from "../server/procurement/rfq.js";
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
    await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[u.store,u.admin]);
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','test'),($2,'approver','test')", [u.buyer, u.approver]);

    const records = await createDashboardSamples(db.pool, u.owner, u.admin);
    const ops = new OperationsRepository(db.pool);
    for (const r of records.filter((x: any) => x.ipoId).slice(0, 2)) await ops.issue(u.owner, { ipoId: r.ipoId, notes: "test", requestKey: randomUUID() });
    const repo = new ProcurementRepository(db.pool);
    const keeper=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Fictional storekeeper',$3,'Inventory')",[keeper,keeper+'@example.test',hash]);
    await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','storekeeper',$2)",[keeper,u.admin]);
    await assert.rejects(repo.overview(keeper),/dispatcher access/);
    await assert.rejects(repo.storeView(keeper),/dispatcher access/);
    await assert.rejects(repo.setCount(keeper,{itemKey:'test',quantity:'1',unit:'m',note:''}),/dispatcher access/);
    await assert.rejects(repo.markReceived(keeper,randomUUID(),{lines:[],note:''}),/dispatcher access/);


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
    const authorityFixture=await materialStockFixture(db.pool,'CH-CBL-AC-16MM/4C-PK');
    await new WarehouseAuthorityRepository(db.pool).command(u.admin,{warehouse:'Lahore warehouse',version:0,sourceSha256:authorityFixture.stockSha,state:'active',reason:'Fictional warehouse governance test.',requestKey:randomUUID()});
    const beforeGuard=(await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n;
    await assert.rejects(repo.setCount(u.store,{itemKey:cable.itemKey,quantity:'99',unit:'m',note:'Must not bypass warehouse ledger.'}),/Global counts and receipts/);
    await assert.rejects(repo.markReceived(u.store,r.id,{lines:[{itemKey:cable.itemKey,quantity:'1'}],note:'Must select warehouse.'}),/Global counts and receipts/);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,beforeGuard);
  } finally {
    await db.close();
  }
});

test("Warehouse stock uses the Inventory ledger and creates one retry-safe multi-item draft", async () => {
  const db = await testDatabase();
  try {
    const cableId = "CH-CBL-DC-16MM/1C-B";
    const acBreakerId = "CH-BRK-AC-10A/1P";
    const breakerId = "CH-BRK-DC-16A/2P";
    const warehouse = "Lahore warehouse";
    const unknownId = "CH-11WAY-DB";
    const fixture = await materialStockFixture(db.pool, cableId, { canonicalIds: 4 }, [
      { itemId: acBreakerId, warehouse, unit: "piece", description: "AC breaker", opening: 9, in: 0, out: 0, closing: 9, openingStatus: "Reviewed source", review: "" },
      { itemId: breakerId, warehouse, unit: "piece", description: "DC breaker", opening: 0, in: 0, out: 0, closing: 0, openingStatus: "Reviewed source", review: "" },
      { itemId: unknownId, warehouse: "Karachi warehouse", unit: "piece", description: "DC breaker", opening: null, in: 0, out: 0, closing: null, openingStatus: "Not recorded", review: "" },
    ]);
    const buyer = randomUUID();
    await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Test buyer','isolated','Operations')",
      [buyer, buyer + "@example.test"]);
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','isolated test')", [buyer]);
    await db.pool.query(`INSERT INTO inventory_minimum_stock_versions(warehouse,item_id,unit,version,minimum,source_sha256,reason,request_key,request_sha256,created_by)
      VALUES($1,$2,'piece',1,5,$3,'Fixture minimum',$4,$5,$6)`, [warehouse, breakerId, fixture.stockSha, randomUUID(), "d".repeat(64), fixture.owner]);

    const repo = new ProcurementRepository(db.pool);
    const suppliers = { suppliers: [{ name: "Supplier A", email: "a@example.test", phone: "" }, { name: "Supplier B", email: "", phone: "" }] };
    assert.deepEqual(await repo.addSuppliers(buyer, suppliers), { added: 2, duplicates: 0 });
    assert.deepEqual(await repo.addSuppliers(buyer, suppliers), { added: 0, duplicates: 2 });
    assert.equal((await repo.suppliers(buyer)).length, 2);
    await assert.rejects(repo.suppliers(fixture.reviewer), /Only the Procurement buyer/);

    await assert.rejects(repo.warehouseStock(fixture.reviewer), /available to Procurement buyers and Management/);
    const result = await repo.warehouseStock(buyer);
    assert.deepEqual(result.warehouses, ["Karachi warehouse", warehouse]);
    const row = (itemId: string, scope = warehouse) => result.rows.find(item => item.itemId === itemId && item.warehouse === scope)!;
    assert.equal(row(cableId).onHand, "7");
    assert.equal(row(cableId).minimum, null);
    assert.equal(row(breakerId).onHand, "0");
    assert.equal(row(breakerId).minimum, "5.000000");
    assert.equal(row(unknownId, "Karachi warehouse").onHand, null);
    assert.equal(row(breakerId).category, "DC switchgear");
    assert.equal(row(acBreakerId).purchaseItem?.itemKey, acBreakerId);

    const input = {
      requestKey: randomUUID(), title: "Two warehouse items", warehouse, purpose: "", neededBy: null, paymentTerms: "",
      lines: [{ itemId: acBreakerId, unit: "piece", quantity: "6" }, { itemId: breakerId, unit: "piece", quantity: "2" }],
    };
    await assert.rejects(repo.createWarehouseDraft(buyer, { ...input, lines: [...input.lines, { itemId: "NO SUCH ITEM", unit: "piece", quantity: "1" }] }),
      /no reviewed purchase item/);
    assert.equal((await repo.listRequests(buyer)).length, 0);
    const [first, replay] = await Promise.all([repo.createWarehouseDraft(buyer, input), repo.createWarehouseDraft(buyer, input)]);
    assert.equal(first.id, replay.id);
    assert.equal(first.deliveryTo, warehouse);
    assert.equal(first.status, "draft");
    assert.deepEqual(first.lines.map(line => [line.itemKey, line.quantity]).sort(), [[acBreakerId, "6"], [breakerId, "2"]]);
    assert.equal((await repo.listRequests(buyer)).length, 1);
    await assert.rejects(repo.createWarehouseDraft(buyer, { ...input, title: "Different request" }), /already used/);
    await assert.rejects(repo.createWarehouseDraft(fixture.owner, { ...input, requestKey: randomUUID() }), /Only the Procurement buyer/);

    const coordinator = randomUUID();
    const accounts = randomUUID();
    for (const [id, role] of [[coordinator, "Coordinator"], [accounts, "Accounts"]]) {
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$3)", [id, id + "@example.test", role]);
    }
    const samples = await createDashboardSamples(db.pool, coordinator, fixture.owner);
    const ipoId = samples.find((sample: { ipoId?: string }) => sample.ipoId)!.ipoId!;
    const issuance = await new OperationsRepository(db.pool).issue(coordinator, { ipoId, notes: "Reservation fixture", requestKey: randomUUID() });
    await db.pool.query(`INSERT INTO operations_stock_demand(issuance_id,line_number,item_key,brand,quantity,unit)
      VALUES($1,900,$2,'',4,'NOS')`, [issuance.id, acBreakerId]);
    await db.pool.query(`INSERT INTO operations_stock_demand(issuance_id,line_number,item_key,brand,quantity,unit)
      VALUES($1,901,'FIXTURE UNMAPPED STOCK','',3,'NOS')`, [issuance.id]);
    const findReservation = (result: Awaited<ReturnType<typeof repo.warehouseStock>>) =>
      result.reservations.find(reservation => reservation.ipoId === ipoId && reservation.itemId === acBreakerId)!;
    let snapshot = await repo.warehouseStock(buyer);
    assert.equal(findReservation(snapshot).quantity, "4");
    assert.equal(findReservation(snapshot).warehouse, null);
    assert.equal(findReservation(snapshot).expectedUseDate, null);
    assert.equal(snapshot.rows.find(item => item.itemId === acBreakerId)!.afterReservations, "9");

    const board = new OperationsBoardRepository(db.pool);
    const existing = (await board.sites(fixture.owner)).sites.find(site => site.origin?.ipoId === ipoId);
    const boardId = existing?.id ?? "isolated-procurement-reservation";
    if (!existing) await board.importSource(fixture.owner, { sourceSha256: "f".repeat(64), rows: [{
      id: boardId, ipo: "Fixture display number", name: "Fictional project", stage: "received",
      installation: false, projectType: "delivery-only", origin: { ipoId, operationsIssuanceId: issuance.id },
    }] });
    if (existing?.scopePending) {
      const current = (await db.pool.query("SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1", [boardId])).rows[0];
      await db.pool.query(`INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)
        VALUES($1,$2,$3,'Fixture scope','Delivery-only fixture',$4,$5)`,
      [boardId, current.version + 1, { ...current.snapshot, scopePending: false, installation: false, projectType: "delivery-only" },
        randomUUID(), fixture.owner]);
    }
    const decide = async (value: Record<string, unknown>) => board.command(fixture.owner, boardId, commandSchema.parse({
      ...value, version: (await board.site(fixture.owner, boardId)).version, requestKey: randomUUID(),
    }));
    await decide({ action: "assign-team", team: "central", warehouse });
    snapshot = await repo.warehouseStock(buyer);
    assert.equal(findReservation(snapshot).warehouse, warehouse);
    assert.equal(findReservation(snapshot).expectedUseDate, null);
    assert.equal(snapshot.rows.find(item => item.itemId === acBreakerId)!.afterReservations, "5");
    assert.ok(snapshot.unlinkedReservations.some(line => line.ipoId === ipoId && line.itemKey === "FIXTURE UNMAPPED STOCK"));
    const vendor = await board.saveVendor(fixture.owner, { version: 0, requestKey: randomUUID(), team: "central", kind: "vendor",
      name: "Fictional delivery vendor", phone: "", roles: ["delivery", "structure", "electrical", "earthing"], active: true, reason: "" });
    await decide({ action: "plan", dispatchDate: "2026-12-03", assignments: { delivery: vendor.id, structure: vendor.id, electrical: vendor.id, earthing: vendor.id } });
    snapshot = await repo.warehouseStock(buyer);
    assert.equal(findReservation(snapshot).expectedUseDate, "2026-12-03");
    assert.equal(snapshot.rows.find(item => item.itemId === acBreakerId)!.reserved, "4");

    const approver = fixture.owner;
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'approver','isolated test')", [approver]);
    await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,'dispatcher',$3)",
      [fixture.reviewer, warehouse, fixture.owner]);
    const { rfq } = await new RfqRepository(db.pool, repo).create(buyer, first.id,
      { vendors: [{ name: "Supplier A", contact: "" }], dueOn: "2099-12-31", terms: [] });
    assert.deepEqual(rfq.items.map(item => [item.sr, item.category]), [[1, "AC switchgear"], [2, "DC switchgear"]]);
    const supplierPdf = buildRfqPdf(rfq, rfq.vendors[0]);
    assert.match(supplierPdf.toString("latin1"), /\/AcroForm/);
    assert.match(supplierPdf.toString("latin1"), /Remarks - item 2/);
    const award = new Map([[acBreakerId, { vendor: "Supplier A", rate: "110" }], [breakerId, { vendor: "Supplier B", rate: "125" }]]);
    for (const line of first.lines) await repo.addQuote(buyer, first.id, line.id, { ...award.get(line.itemKey)!, note: "" });
    await assert.rejects(repo.selfApprove(buyer, first.id, { note: "" }), /owner must approve/);
    await assert.rejects(repo.submit(buyer, first.id), /recommendation/);
    await repo.submit(buyer, first.id, "Supplier A for AC breakers and Supplier B for DC breakers.");
    const approved = await repo.decide(approver, first.id, { decision: "approve", note: "" });
    assert.deepEqual(approved.lines.map(line => line.chosen?.vendor).sort(), ["Supplier A", "Supplier B"]);
    assert.ok(buildApprovedPurchasePdf(approved).length > 1000);
    await assert.rejects(repo.approvedDocument(accounts, first.id), /not been sent to Accounts/);
    await assert.rejects(repo.approvedDocument(fixture.reviewer, first.id), /Purchase prices/);
    await assert.rejects(repo.markOrdered(buyer, first.id, { orderReference: "Old path" }), /Accounts must forward/);
    await repo.sendApprovedToAccounts(buyer, first.id);
    await repo.sendApprovedToAccounts(buyer, first.id);
    assert.equal((await repo.accountsQueue(accounts)).length, 1);
    assert.equal((await repo.storeView(fixture.reviewer)).toReceive.length, 0);
    await assert.rejects(repo.accountsAction(buyer, first.id, "acknowledge"), /Accounts user/);
    await repo.accountsAction(accounts, first.id, "acknowledge");
    await assert.rejects(repo.accountsAction(accounts, first.id, "forward"), /record its PT reference/);
    const ptInput = { sourceKind: "Procurement" as const, sourceId: first.id, sourceVersion: 1, ptReference: "PT-TEST-1", entryDate: "2026-12-01", notes: "" };
    const pt = await recordPtEntry(db.pool, accounts, ptInput);
    assert.equal((await recordPtEntry(db.pool, accounts, ptInput)).id, pt.id);
    assert.equal((await repo.accountsQueue(accounts))[0].ptReference, "PT-TEST-1");
    await repo.accountsAction(accounts, first.id, "forward");
    await repo.accountsAction(accounts, first.id, "forward");
    const receiving = (await repo.storeView(fixture.reviewer)).toReceive;
    assert.deepEqual(receiving.map(purchase => purchase.id), [first.id]);
    assert.equal(receiving[0].lines.find(line => line.itemKey === acBreakerId)?.due, "6");

    await new WarehouseAuthorityRepository(db.pool).command(approver, { warehouse, version: 0,
      sourceSha256: fixture.stockSha, state: "active", reason: "Isolated purchase receipt test.", requestKey: randomUUID() });
    const stock = new MaterialStockRepository(db.pool);
    const proof = await stock.uploadEvidence(fixture.reviewer, { warehouse, filename: "test-receiving.pdf", mediaType: "application/pdf",
      base64: Buffer.from("%PDF-1.7 isolated purchase fixture").toString("base64") });
    const receivingRepo = new PurchaseReceivingRepository(db.pool);
    const before = (await stock.positions(fixture.reviewer, warehouse)).positions.find(position => position.itemId === acBreakerId)!;
    const partial = {
      requestId: first.id, requestKey: randomUUID(), warehouse, sourceSha256: fixture.stockSha, authorityVersion: 1,
      evidenceId: proof.id, reason: "Received two AC breakers.", lines: [{ itemKey: acBreakerId, itemId: acBreakerId,
        unit: "piece", quantity: "2", ledgerRevision: before.ledgerRevision }],
    };
    const receipt = await receivingRepo.receive(fixture.reviewer, partial);
    assert.equal((await receivingRepo.receive(fixture.reviewer, partial)).id, receipt.id);
    assert.match(receipt.number, /^CPZ-IGP-/);
    const after = (await stock.positions(fixture.reviewer, warehouse)).positions.find(position => position.itemId === acBreakerId)!;
    assert.equal(after.currentClosing, "11");
    assert.equal((await repo.storeView(fixture.reviewer)).toReceive[0].lines.find(line => line.itemKey === acBreakerId)?.due, "4");
    assert.equal(Number((await repo.warehouseStock(buyer)).rows.find(line => line.itemId === acBreakerId)?.incoming[0].quantity), 4);

    const secondSite = randomUUID();
    const draftId = randomUUID();
    const dispatchId = randomUUID();
    const lineKeys = [randomUUID(), randomUUID()];
    const dispatchSnapshot = {
      sites: [{ siteId: ipoId }, { siteId: secondSite }],
      lines: [{ key: lineKeys[0], sites: [ipoId] }, { key: lineKeys[1], sites: [ipoId, secondSite] }],
    };
    await db.pool.query("INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)", [draftId, fixture.owner]);
    await db.pool.query(`INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by)
      VALUES($1,1,$2,$3,$4,$5)`, [draftId, dispatchSnapshot, randomUUID(), "a".repeat(64), fixture.owner]);
    await db.pool.query(`INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by)
      VALUES($1,'FIXTURE-PARENT-DO',$2,1,$3,$4,$5,$6,$7,$8)`,
    [dispatchId, draftId, fixture.stockSha, warehouse, dispatchSnapshot, randomUUID(), "b".repeat(64), fixture.owner]);
    for (const [index, lineKey] of lineKeys.entries()) {
      await db.pool.query(`INSERT INTO inventory_material_dispatch_lines(dispatch_id,line_key,source_sha256,ledger_key,item_id,unit,description,quantity)
        VALUES($1,$2,$3,$4,$5,'piece','AC breaker',1)`, [dispatchId, lineKey, fixture.stockSha, after.ledgerKey, acBreakerId]);
      await db.pool.query(`INSERT INTO inventory_warehouse_operational_movements(id,source_sha256,ledger_key,ledger_revision,kind,draft_id,dispatch_id,line_key,in_delta,out_delta,closing_before,closing_after,created_by)
        VALUES($1,$2,$3,$4,'dispatch-out',$5,$6,$7,0,1,$8,$9,$10)`,
      [randomUUID(), fixture.stockSha, after.ledgerKey, after.ledgerRevision + index + 1, draftId, dispatchId, lineKey, 11 - index, 10 - index, fixture.owner]);
    }
    snapshot = await repo.warehouseStock(buyer);
    assert.equal(findReservation(snapshot).quantity, "3", "A posted parent DO line linked to a single IPO reduces only that reservation.");
    assert.equal(findReservation(snapshot).sharedDispatchPending, true, "An unsplit shared line requires allocation review.");
    assert.equal(snapshot.rows.find(item => item.itemId === acBreakerId)!.afterReservations, "6");

    // Exercise the real projection with a backlog of IPOs and versioned Operations records.
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by)
        SELECT gen_random_uuid(),p.customer_id,'PROC-LOAD-PO-'||n,'{}',$2
        FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id
        CROSS JOIN generate_series(1,1000) n WHERE i.id=$1`, [ipoId, fixture.owner]);
      await client.query(`INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by)
        SELECT gen_random_uuid(),id,replace(po_number,'-PO-','-IPO-'),'{}','fixture',gen_random_uuid(),$1
        FROM customer_purchase_orders WHERE po_number LIKE 'PROC-LOAD-PO-%'`, [fixture.owner]);
      await client.query(`INSERT INTO operations_boq_issuances(id,ipo_id,boq_revision_id,number,snapshot,request_key,created_by)
        SELECT gen_random_uuid(),i.id,o.boq_revision_id,i.number,'{}',gen_random_uuid(),$2
        FROM internal_purchase_orders i JOIN operations_boq_issuances o ON o.id=$1
        WHERE i.number LIKE 'PROC-LOAD-IPO-%'`, [issuance.id, fixture.owner]);
      await client.query(`INSERT INTO operations_stock_demand(issuance_id,line_number,item_key,brand,quantity,unit)
        SELECT id,1,$1,'',1,'piece' FROM operations_boq_issuances WHERE number LIKE 'PROC-LOAD-IPO-%'`, [acBreakerId]);
      await client.query(`INSERT INTO operations_board_sites(id,created_by)
        SELECT 'proc-load-'||ipo_id,$1 FROM operations_boq_issuances WHERE number LIKE 'PROC-LOAD-IPO-%'`, [fixture.owner]);
      await client.query(`INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by)
        SELECT 'proc-load-'||o.ipo_id,v,jsonb_build_object('stage','received','procurementWarehouse',$1::text,
          'origin',jsonb_build_object('ipoId',o.ipo_id,'operationsIssuanceId',o.id)),
          'Fixture history','Projection scale test',gen_random_uuid(),$2
        FROM operations_boq_issuances o CROSS JOIN generate_series(1,5) v WHERE o.number LIKE 'PROC-LOAD-IPO-%'`,
      [warehouse, fixture.owner]);
      await client.query("SET LOCAL statement_timeout='5s'");
      const backlog = await procurementWarehouseStock(client);
      assert.equal(backlog.reservations.filter(line => line.ipoNumber.startsWith("PROC-LOAD-IPO-") && line.warehouse === warehouse).length, 1000);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  } finally {
    await db.close();
  }
});
