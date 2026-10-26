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
import { MiscItemsRepository } from "../server/procurement/misc.js";
import { hashPassword } from "../server/auth/crypto.js";

test("Misc items BOQ: Design fills it per site, Hamza buys the items, Store sends them, and it stays hidden elsewhere", async () => {
  const db = await testDatabase();
  try {
    const password = "misc-items-test-password-2026";
    const hash = await hashPassword(password);
    const u = { owner: randomUUID(), admin: randomUUID(), design: randomUUID(), buyer: randomUUID(), ops: randomUUID(), store: randomUUID(), manager: randomUUID() };
    const people: [string, string, string][] = [
      [u.owner, "Coordinator", "Coordinator"], [u.admin, "Admin", "Admin"], [u.design, "Design", "Design Engineer"], [u.buyer, "Operations", "Hamza Mir"],
      [u.ops, "Operations", "Ops Person"], [u.store, "Inventory", "Shaigan"], [u.manager, "Management", "Abu Bakar"],
    ];
    for (const [id, role, name] of people)
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, name, hash, role]);
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','test')", [u.buyer]);

    const records = await createDashboardSamples(db.pool, u.owner, u.admin);
    const ops = new OperationsRepository(db.pool);
    const sample = records.find((x: any) => x.ipoId)!;
    await ops.issue(u.owner, { ipoId: sample.ipoId, notes: "test", requestKey: randomUUID() });
    const issuance = (await db.pool.query("SELECT id FROM operations_boq_issuances ORDER BY created_at LIMIT 1")).rows[0].id as string;
    const customer = (await db.pool.query("SELECT id FROM customers ORDER BY id LIMIT 1")).rows[0].id as number;

    // Two sites: A has its customer PO (IPO issued, not delivered); B is an upcoming heads-up without a PO.
    const site = async (code: string, survey?: object) => {
      const id = randomUUID();
      await db.pool.query(
        `INSERT INTO project_workflow_records(id,customer_id,site_name,site_code,route,stage,coordinator_id,data,request_key,created_by)
         VALUES($1,$2,$3,$4,'survey-quote','advance_pending',$5,$6,$7,$5)`,
        [id, customer, `Misc site ${code}`, code, u.owner, JSON.stringify(survey ? { surveyInputs: survey } : {}), randomUUID()],
      );
      const doc = randomUUID();
      await db.pool.query(
        "INSERT INTO project_workflow_documents(id,record_id,kind,version,number,snapshot,created_by) VALUES($1,$2,'Advance planning',1,$3,$4,$5)",
        [doc, id, `ADV-${code}`, JSON.stringify({ items: [] }), u.owner],
      );
      return { id, doc };
    };
    const a = await site("MSCA");
    const b = await site("MSCB", { panelQty: 44, panelWattage: 570, inverter: "HYB-3P-020", batteryKwh: 30 });
    await db.pool.query("INSERT INTO project_advance_planning(record_id,mode,document_id,operations_owner_id,confirmed_issuance_id) VALUES($1,'Confirmed',$2,$3,$4)", [a.id, a.doc, u.owner, issuance]);
    await db.pool.query("INSERT INTO project_advance_planning(record_id,mode,document_id,operations_owner_id) VALUES($1,'Provisional',$2,$3)", [b.id, b.doc, u.owner]);

    const misc = new MiscItemsRepository(db.pool);
    const procurement = new ProcurementRepository(db.pool);

    // The sheet's list and its four options.
    const cat = await misc.catalogue(u.design);
    assert.equal(cat.items.length, 38);
    assert.deepEqual(cat.options.map((o) => o.key), ["30-30-40", "35-30-40", "20-20-30", "25-20-30"]);
    const big = cat.options.find((o) => o.key === "30-30-40")!, small = cat.options.find((o) => o.key === "20-20-30")!;
    assert.equal(big.items.length, 37, "30-30-40 has no 18*24 box");
    assert.equal(small.items.length, 34);
    const screw = cat.items.find((i) => i.name === "Self Screw 1/2 Inch")!;
    assert.equal(big.items.find((i) => i.itemKey === screw.itemKey)!.quantity, "160");
    assert.equal(cat.items.find((i) => i.name === "Cat 6 Cable Mtr")!.unit, "Mtr");
    await assert.rejects(misc.catalogue(u.owner), /not part of your workspace/);
    await assert.rejects(misc.catalogue(u.ops), /not part of your workspace/);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM item_master WHERE key LIKE 'MSC-%'")).rows[0].n, 0, "misc items stay out of the rate master");

    // Design fills site A from an option, adds an item on the spot; only Design (or Admin) can.
    let sa = await misc.site(u.design, a.id);
    assert.equal(sa.boq, null);
    assert.equal(sa.can.edit, true);
    assert.equal(sa.suggestion, null, "no survey inputs, no suggestion");
    const sb = await misc.site(u.design, b.id);
    assert.equal(sb.suggestion!.optionKey, "25-20-30", "25.08 kW PV, 20 kW inverter, 30 kWh battery");
    const box = await misc.addItem(u.design, { name: "Junction Box 4x4", unit: "Nos" });
    assert.equal(box.itemKey, "MSC-039");
    await assert.rejects(misc.addItem(u.design, { name: " junction box 4X4 ", unit: "Nos" }), /already on the list as MSC-039/);
    const linesA = [...big.items, { itemKey: box.itemKey, quantity: "2" }];
    await assert.rejects(misc.save(u.store, a.id, { version: null, optionKey: "30-30-40", lines: linesA, note: "" }), /Only Design/);
    await assert.rejects(misc.save(u.buyer, a.id, { version: null, optionKey: "30-30-40", lines: linesA, note: "" }), /Only Design/);
    sa = await misc.save(u.design, a.id, { version: null, optionKey: "30-30-40", lines: linesA, note: "Roof site" });
    assert.equal(sa.boq!.version, 1);
    assert.equal(sa.boq!.lines.length, 38);
    await assert.rejects(misc.save(u.design, a.id, { version: null, optionKey: "30-30-40", lines: linesA, note: "" }), /saved this misc items list meanwhile/);
    await assert.rejects(misc.save(u.design, a.id, { version: 1, optionKey: null, lines: [{ itemKey: "MSC-001", quantity: "1" }, { itemKey: "MSC-001", quantity: "2" }], note: "" }), /twice/);
    await misc.save(u.design, b.id, { version: null, optionKey: "20-20-30", lines: small.items, note: "" });

    // Hamza: misc items count against the coming sites like any other item, and he can buy them.
    let row = (await procurement.overview(u.buyer)).inventory.find((i) => i.itemKey === screw.itemKey)!;
    assert.ok(row.misc && row.boughtByBuyer && row.inRateMaster);
    assert.equal(row.receivedNeed, "160", "site A has its PO");
    assert.equal(row.upcomingNeed, "130", "site B is upcoming");
    assert.equal(row.toBuy, "290");
    assert.equal((await procurement.overview(u.buyer)).inventory.find((i) => i.itemKey === box.itemKey)!.receivedNeed, "2");
    assert.ok((await procurement.searchItems(u.buyer, "self screw")).some((i) => i.itemKey === screw.itemKey && i.misc));
    let pr = await procurement.createRequest(u.buyer, { title: "Misc for sites", purpose: "", neededBy: null, deliveryTo: "Power Zone Store", paymentTerms: "" });
    pr = await procurement.addLine(u.buyer, pr.id, { itemKey: screw.itemKey, quantity: "290", unit: "", note: "" });
    assert.equal(pr.lines[0].unit, "Nos");
    assert.equal(pr.lines[0].name, "Self Screw 1/2 Inch");
    assert.equal((await procurement.overview(u.buyer)).inventory.find((i) => i.itemKey === screw.itemKey)!.toBuy, "0", "on a request now");
    await procurement.setCount(u.store, { itemKey: screw.itemKey, quantity: "40", unit: "", note: "" });
    await assert.rejects(db.pool.query("INSERT INTO stock_on_hand_entries(item_key,kind,quantity,unit,created_by) VALUES('MSC-999','count',1,'Nos',$1)", [u.store]), /not in the rate master or the misc items list/);

    // Hamza and Shaigan see every site's list; Design opens it from the survey step only.
    const forBuyer = await misc.sites(u.buyer);
    assert.deepEqual(forBuyer.sites.map((s) => [s.siteCode, s.po]).sort(), [["MSCA", "received"], ["MSCB", "upcoming"]]);
    assert.equal(forBuyer.can.send, false);
    assert.equal((await misc.sites(u.store)).can.send, true);
    await assert.rejects(misc.sites(u.design), /survey step/);
    await assert.rejects(misc.sites(u.owner), /not part of your workspace/);

    // Store sends site A's misc items: they leave the buying needs, and the list is locked.
    await assert.rejects(misc.markSent(u.buyer, a.id, { note: "" }), /Only Store/);
    await misc.markSent(u.store, a.id, { note: "With the first truck" });
    row = (await procurement.overview(u.buyer)).inventory.find((i) => i.itemKey === screw.itemKey)!;
    assert.equal(row.receivedNeed, "0");
    assert.equal(row.upcomingNeed, "130");
    await assert.rejects(misc.markSent(u.store, a.id, { note: "" }), /already sent/);
    await assert.rejects(misc.save(u.design, a.id, { version: 1, optionKey: "30-30-40", lines: linesA, note: "" }), /already sent/);
    sa = await misc.site(u.manager, a.id);
    assert.equal(sa.can.edit, false);
    assert.equal(sa.boq!.sentBy, "Shaigan");
    assert.deepEqual(sa.events.map((e) => e.kind), ["sent", "saved"]);
    await assert.rejects(db.pool.query("DELETE FROM site_misc_boq_events WHERE record_id=$1", [a.id]), /immutable/);

    // The buyer keeps the list tidy; Design cannot rename items.
    assert.equal((await misc.updateItem(u.buyer, box.itemKey, { unit: "Pcs" })).unit, "Pcs");
    await assert.rejects(misc.updateItem(u.design, box.itemKey, { unit: "Nos" }), /Only the Procurement buyer/);

    // HTTP: the right people reach it; everyone else is refused.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "misc-items-setup-token-123456789012" }));
    const login = async (id: string) => {
      const res = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: `${id}@example.test`, password });
      assert.equal(res.status, 200, res.text);
      return { cookie: res.headers["set-cookie"] as unknown as string[], csrf: res.body.csrfToken as string };
    };
    const get = (s: { cookie: string[] }, path: string) => request(app).get(path).set("Cookie", s.cookie);
    const design = await login(u.design), buyer = await login(u.buyer), other = await login(u.ops), coordinator = await login(u.owner), store = await login(u.store);
    assert.equal((await get(design, `/api/procurement/misc/sites/${b.id}`)).status, 200);
    assert.equal((await get(buyer, "/api/procurement/misc/sites")).status, 200);
    assert.equal((await get(store, "/api/procurement/misc/sites")).status, 200);
    assert.equal((await get(other, "/api/procurement/misc/sites")).status, 403);
    assert.equal((await get(coordinator, `/api/procurement/misc/sites/${b.id}`)).status, 403);
    const sent = await request(app).post(`/api/procurement/misc/sites/${b.id}/sent`).set("Cookie", store.cookie).set("Origin", "http://127.0.0.1:3000")
      .set("X-CSRF-Token", store.csrf).send({ note: "" });
    assert.equal(sent.status, 200, sent.text);
  } finally {
    await db.close();
  }
});
