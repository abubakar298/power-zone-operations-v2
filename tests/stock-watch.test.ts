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
import { StockWatchRepository, assess } from "../server/procurement/stock-watch.js";
import { NotificationsRepository } from "../server/notifications/repository.js";
import { hashPassword } from "../server/auth/crypto.js";

test("Inverter, battery and BMS watch: shortages alert Abu Bakar once, his orders count as on order, Store receives them", async () => {
  const db = await testDatabase();
  try {
    const password = "stock-watch-test-password-2026";
    const hash = await hashPassword(password);
    const u = { owner: randomUUID(), admin: randomUUID(), approver: randomUUID(), buyer: randomUUID(), store: randomUUID() };
    const people: [string, string, string][] = [
      [u.owner, "Coordinator", "Coordinator"], [u.admin, "Admin", "Admin"], [u.approver, "Management", "Abu Bakar"], [u.buyer, "Operations", "Hamza Mir"], [u.store, "Inventory", "Shaigan"],
    ];
    for (const [id, role, name] of people)
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, name, hash, role]);
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','test'),($2,'approver','test')", [u.buyer, u.approver]);
    await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[u.store,u.admin]);
    const records = await createDashboardSamples(db.pool, u.owner, u.admin);
    const ops = new OperationsRepository(db.pool);
    for (const r of records.filter((x: any) => x.ipoId).slice(0, 2)) await ops.issue(u.owner, { ipoId: r.ipoId, notes: "test", requestKey: randomUUID() });

    const watch = new StockWatchRepository(db.pool);
    const procurement = new ProcurementRepository(db.pool);
    const morning = new Date("2026-10-24T02:00:00Z"), later = new Date("2026-10-24T05:00:00Z"); // 07:00 and 10:00 in Pakistan

    // The lead-time arithmetic on its own.
    const row = { itemKey: "BAT-X", name: "Battery", unit: "No.", inStock: "2", receivedNeed: "1", upcomingNeed: "5", onOrder: "0" } as any;
    const a = assess(row, [
      { itemKey: "BAT-X", label: "Site A", kind: "upcoming", date: "2026-12-10", qty: 3 },
      { itemKey: "BAT-X", label: "Site B", kind: "received", date: "2026-11-01", qty: 1 },
      { itemKey: "BAT-X", label: "Site C", kind: "upcoming", date: "2026-12-01", qty: 2 },
    ], { leadDays: 30, minStock: 0 }, "2026-10-24");
    assert.equal(a.level, "plan");
    assert.equal(a.short, "4");
    assert.deepEqual(a.firstShort, { label: "Site C", kind: "upcoming", date: "2026-12-01" }, "received first, then upcoming by date");
    assert.equal(a.orderBy, "2026-11-01", "30 days before Site C");
    assert.equal(assess(row, [], { leadDays: 0, minStock: 5 }, "2026-10-24").level, "urgent", "the stock to keep counts as needed now");

    // Only Abu Bakar (and management, read-only) sees it.
    await assert.rejects(watch.view(u.buyer), /for Abu Bakar/);
    await assert.rejects(watch.view(u.store), /for Abu Bakar/);
    assert.equal((await watch.view(u.admin)).can.change, false);

    // The first check alerts him about everything short; an unchanged position does not repeat it.
    let first = await watch.check(morning);
    assert.ok(first.short > 0 && first.alerts === 1, JSON.stringify(first));
    assert.equal((await watch.check(morning)).alerts, 0, "nothing changed, no new alert");
    const rows = await watch.rows();
    const battery = rows.find((r) => /^BAT/.test(r.itemKey))!;
    assert.ok(battery && ["urgent", "plan"].includes(battery.level));
    assert.ok(rows.every((r) => !/cable|panel/i.test(r.name)), "only inverters, batteries and BMS are watched");

    // Historical stock alerts remain saved but are suppressed from the bell.
    const notifications = new NotificationsRepository(db.pool);
    let inbox = await notifications.list({ id: u.approver, role: "Management" } as any);
    assert.equal(inbox.filter((n: any) => n.kind === "Stock shortage").length, 0);
    assert.equal((await notifications.list({ id: u.admin, role: "Admin" } as any)).filter((n: any) => n.kind === "Stock shortage").length, 0, "only Abu Bakar is alerted");

    // A morning summary once a day from 9:00, while anything is short.
    assert.equal((await watch.check(later)).alerts, 1);
    assert.equal((await watch.check(later)).alerts, 0);

    // Keeping stock in hand makes the shortage bigger: a new alert.
    await assert.rejects(watch.saveSetting(u.buyer, battery.itemKey, { leadDays: 45, minStock: "4" }), /Only Abu Bakar/);
    const alerts = async (kind: string) => (await db.pool.query("SELECT count(*)::int AS n FROM stock_watch_alerts WHERE kind=$1", [kind])).rows[0].n as number;
    const shortages = await alerts("shortage");
    await watch.saveSetting(u.approver, battery.itemKey, { leadDays: 45, minStock: "4" });
    const kept = (await watch.rows()).find((r) => r.itemKey === battery.itemKey)!;
    assert.equal(kept.leadDays, 45);
    assert.equal(Number(kept.short), Number(battery.short) + 4);
    assert.equal(await alerts("shortage"), shortages + 1, "opening or saving the page runs the check");
    assert.equal((await watch.check(later)).alerts, 0);

    // His order counts as on order; it is not in Hamza's list; Store sees it to receive.
    const cable = rows.length ? (await procurement.overview(u.buyer)).inventory.find((i) => /DC Cable Red/.test(i.itemKey))! : null;
    await assert.rejects(watch.createOrder(u.approver, { vendor: "X", orderReference: "Y", expectedOn: null, note: "", lines: [{ itemKey: cable!.itemKey, quantity: "1", rate: null }] }), /Hamza orders it/);
    await assert.rejects(watch.createOrder(u.buyer, { vendor: "X", orderReference: "Y", expectedOn: null, note: "", lines: [{ itemKey: battery.itemKey, quantity: "1", rate: null }] }), /Only Abu Bakar/);
    const view = await watch.createOrder(u.approver, { vendor: "Sunpower", orderReference: "SP-2210", expectedOn: "2026-10-20", note: "", lines: [{ itemKey: battery.itemKey, quantity: kept.short, rate: "250000" }] });
    const order = view.orders[0];
    assert.equal(order.vendor, "Sunpower");
    assert.equal(view.rows.find((r) => r.itemKey === battery.itemKey)!.onOrder, kept.short);
    assert.notEqual(view.rows.find((r) => r.itemKey === battery.itemKey)!.level, "plan");
    assert.ok(!(await procurement.listRequests(u.buyer)).some((r) => r.id === order.id), "Hamza's list leaves out Abu Bakar's orders");
    assert.ok((await procurement.listRequests(u.approver)).some((r) => r.id === order.id));
    const waiting = (await procurement.storeView(u.store)).toReceive.find((x) => x.id === order.id)!;
    assert.equal(waiting.lines[0].vendor, "Sunpower");
    assert.equal(waiting.expectedOn, "2026-10-20");

    // Past its expected date and not in: one overdue alert.
    assert.equal(await alerts("overdue"), 1);
    assert.equal((await watch.check(later)).alerts, 0);

    // Store receives it; it is no longer on order and stock goes up.
    await procurement.markReceived(u.store, order.id, { lines: waiting.lines.map((l) => ({ itemKey: l.itemKey, quantity: l.due })), note: "" });
    const after = (await watch.rows()).find((r) => r.itemKey === battery.itemKey)!;
    assert.equal(after.onOrder, "0");
    assert.equal(Number(after.inStock), Number(battery.inStock) + Number(kept.short));

    // Even with general email enabled, stock-shortage messages remain suppressed.
    await db.pool.query("UPDATE notification_settings SET email_enabled=true");
    await notifications.sync();
    const sent: { to: string; subject: string }[] = [];
    const delivery = { configured: true, send: async (m: any) => { sent.push(m); return "provider-id"; } };
    for (let i = 0; i < 10; i++) await notifications.deliverOne(delivery as any, "http://127.0.0.1:3000");
    const shortageMail = sent.filter((m) => /Inverter, battery & BMS shortage/.test(m.subject));
    assert.equal(shortageMail.length,0);
    assert.equal((await notifications.settings()).types.find((t:{kind:string})=>t.kind==='Stock shortage').email_enabled,false);
    const prior=(await db.pool.query("SELECT id FROM notifications WHERE kind='Stock shortage' LIMIT 1")).rows[0];
    await db.pool.query("INSERT INTO notification_email_queue(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET state='queued'",[prior.id]);
    await notifications.deliverOne(delivery as any,"http://127.0.0.1:3000");
    assert.equal((await db.pool.query("SELECT state FROM notification_email_queue WHERE id=$1",[prior.id])).rows[0].state,'cancelled');
    assert.equal(sent.filter(m=>/Inverter, battery & BMS shortage/.test(m.subject)).length,0);
    await assert.rejects(db.pool.query("DELETE FROM stock_watch_alerts"), /immutable/);

    // HTTP.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "stock-watch-setup-token-1234567890123" }));
    const login = async (id: string) => (await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: `${id}@example.test`, password })).headers["set-cookie"] as unknown as string[];
    assert.equal((await request(app).get("/api/procurement/stock-watch").set("Cookie", await login(u.approver))).status, 200);
    assert.equal((await request(app).get("/api/procurement/stock-watch").set("Cookie", await login(u.buyer))).status, 403);
  } finally {
    await db.close();
  }
});
