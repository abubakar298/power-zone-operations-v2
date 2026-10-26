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
import { ProcurementAccessRepository } from "../server/procurement/access.js";
import { NotificationsRepository } from "../server/notifications/repository.js";
import { hashPassword } from "../server/auth/crypto.js";

const ORIGIN = "http://127.0.0.1:3000";

test("Buyer self-approval tells Abu Bakar and Moaz every time; the buyer sees every item on each received PO", async () => {
  const db = await testDatabase();
  try {
    const password = "self-approval-test-password-2026";
    const hash = await hashPassword(password);
    const u = { owner: randomUUID(), admin: randomUUID(), buyer: randomUUID(), approver: randomUUID(), moaz: randomUUID(), store: randomUUID() };
    const people: [string, string, string][] = [
      [u.owner, "Coordinator", "Coordinator"], [u.admin, "Admin", "Admin"], [u.buyer, "Operations", "Hamza Mir"],
      [u.approver, "Management", "Abu Bakar"], [u.moaz, "Operations", "Moaz Ahsan"], [u.store, "Inventory", "Shaigan"],
    ];
    for (const [id, role, name] of people)
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, name, hash, role]);
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','test'),($2,'approver','test')", [u.buyer, u.approver]);
    const records = await createDashboardSamples(db.pool, u.owner, u.admin);
    const ops = new OperationsRepository(db.pool);
    for (const r of records.filter((x: any) => x.ipoId).slice(0, 2)) await ops.issue(u.owner, { ipoId: r.ipoId, notes: "test", requestKey: randomUUID() });
    const repo = new ProcurementRepository(db.pool);

    // Admin marks Moaz to be told; any role can be.
    const access = new ProcurementAccessRepository(db.pool);
    const list = await access.change(u.admin, { email: `${u.moaz}@example.test`, capability: "notify", action: "grant", reason: "Told about self-approvals" });
    assert.ok(list.grants.some((g) => g.capability === "notify" && g.name === "Moaz Ahsan"));

    // The buyer sees each received PO's details and every item that has to go; no prices.
    const overview = await repo.overview(u.buyer);
    const po = overview.receivedPOs.find((p) => p.pending)!;
    assert.ok(po.lines.length > 0 && po.lines.length === po.items);
    assert.ok(po.lines.every((l) => l.name && Number(l.quantity) > 0 && typeof l.short === "boolean"));
    assert.ok("poNumber" in po && "deliveryAddress" in po);
    assert.ok(!/"(rate|price|cost|total)"/i.test(JSON.stringify(po.lines)), "item lists carry no prices");
    assert.deepEqual(po.shortItems.sort(), po.lines.filter((l) => l.short).map((l) => l.name).sort());

    // A draft with quotes; the buyer approves it himself, which needs the password again.
    let pr = await repo.createFromToBuy(u.buyer);
    assert.equal(pr.can.selfApprove, false, "not before every item has a quotation");
    await assert.rejects(repo.selfApprove(u.buyer, pr.id, { note: "" }), /Add a quotation for/);
    for (const l of pr.lines) pr = await repo.addQuote(u.buyer, pr.id, l.id, { vendor: "Powerline", rate: "100", note: "" });
    assert.equal(pr.can.selfApprove, true);
    await assert.rejects(repo.selfApprove(u.approver, pr.id, { note: "" }), /Only the Procurement buyer/);

    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: ORIGIN, DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "self-approval-setup-token-123456789012" }));
    const login = async (id: string) => {
      const res = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: `${id}@example.test`, password });
      return { cookie: res.headers["set-cookie"] as unknown as string[], csrf: res.body.csrfToken as string };
    };
    const buyer = await login(u.buyer);
    const post = (path: string, body: object) => request(app).post(path).set("Cookie", buyer.cookie).set("Origin", ORIGIN).set("X-CSRF-Token", buyer.csrf).send(body);
    const self = () => post(`/api/procurement/requests/${pr.id}/self-approve`, { note: "Site start on Monday" });
    assert.equal((await self()).status, 403, "the password is needed first");
    assert.equal((await post("/api/auth/confirm-password", { password })).status, 200);
    const done = await self();
    assert.equal(done.status, 200, done.text);
    assert.equal(done.body.status, "approved");
    assert.equal(done.body.selfApproved, true);
    assert.equal(done.body.decidedBy, "Hamza Mir");
    assert.deepEqual(done.body.events.slice(0, 1).map((e: any) => e.kind), ["self_approved"]);
    assert.ok(done.body.lines.every((l: any) => l.lastRate === null || l.lastRate.source !== undefined), "last rates are frozen as on a normal send");
    assert.ok((await repo.listRequests(u.approver)).find((r) => r.id === pr.id)!.selfApproved);

    // Abu Bakar and Moaz are told, in the bell; the buyer is not.
    const notifications = new NotificationsRepository(db.pool);
    const bell = async (id: string, role: string) => (await notifications.list({ id, role } as any)).filter((n: any) => n.kind === "Purchase self-approved");
    const forApprover = await bell(u.approver, "Management"), forMoaz = await bell(u.moaz, "Operations");
    assert.equal(forApprover.length, 1);
    assert.equal(forMoaz.length, 1);
    assert.match(forMoaz[0].reference, new RegExp(`${pr.number} .* self-approved by Hamza Mir · Site start on Monday`));
    assert.equal((await bell(u.buyer, "Operations")).length, 0);
    assert.equal((await bell(u.store, "Inventory")).length, 0);
    await assert.rejects(db.pool.query("DELETE FROM procurement_notices"), /immutable/);

    // And by email through the existing queue when email is on.
    await db.pool.query("UPDATE notification_settings SET email_enabled=true");
    await notifications.sync();
    const sent: { to: string; subject: string }[] = [];
    const delivery = { configured: true, send: async (m: any) => { sent.push(m); return "id"; } };
    for (let i = 0; i < 12; i++) await notifications.deliverOne(delivery as any, ORIGIN);
    const mail = sent.filter((m) => /Purchase self-approved by the buyer/.test(m.subject)).map((m) => m.to).sort();
    assert.deepEqual(mail, [`${u.approver}@example.test`, `${u.moaz}@example.test`].sort(), JSON.stringify(sent.map((m) => [m.to, m.subject])));

    // From waiting-for-Abu-Bakar too; Abu Bakar still cannot decide a request he raised himself (unchanged).
    let second = await repo.createRequest(u.buyer, { title: "Second", purpose: "", neededBy: null, deliveryTo: "Power Zone Store", paymentTerms: "" });
    second = await repo.addLine(u.buyer, second.id, { itemKey: pr.lines[0].itemKey, quantity: "1", unit: "", note: "" });
    second = await repo.addQuote(u.buyer, second.id, second.lines[0].id, { vendor: "X", rate: "5", note: "" });
    second = await repo.submit(u.buyer, second.id);
    assert.equal(second.can.selfApprove, true);
    second = await repo.selfApprove(u.buyer, second.id, { note: "" });
    assert.equal(second.status, "approved");
    assert.equal((await bell(u.moaz, "Operations")).length, 2, "told every time");
  } finally {
    await db.close();
  }
});
