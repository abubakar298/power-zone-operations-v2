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
import { deviceOf } from "../server/security/events.js";
import { hashPassword } from "../server/auth/crypto.js";

const ORIGIN = "http://127.0.0.1:3000";

test("Security: price access, no self-approval, Admin-managed access, idle sign-out, password before approving, security log", async () => {
  const db = await testDatabase();
  try {
    const password = "security-test-password-2026";
    const hash = await hashPassword(password);
    const u = {
      owner: randomUUID(), admin: randomUUID(), buyer: randomUUID(), approver: randomUUID(), manager: randomUUID(), accounts: randomUUID(),
      store: randomUUID(), ops: randomUUID(), design: randomUUID(), both: randomUUID(), newBuyer: randomUUID(), locked: randomUUID(),
    };
    const people: [string, string, string][] = [
      [u.owner, "Coordinator", "Coordinator"], [u.admin, "Admin", "Admin"], [u.buyer, "Operations", "Hamza Mir"], [u.approver, "Management", "Abu Bakar"],
      [u.manager, "Management", "Other Manager"], [u.accounts, "Accounts", "Accounts"], [u.store, "Inventory", "Shaigan"], [u.ops, "Operations", "Ops Person"],
      [u.design, "Design", "Designer"], [u.both, "Management", "Buyer And Approver"], [u.newBuyer, "Operations", "New Buyer"], [u.locked, "Admin", "Lockout Test"],
    ];
    for (const [id, role, name] of people)
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, name, hash, role]);
    await db.pool.query(
      "INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','test'),($2,'approver','test'),($3,'buyer','test'),($3,'approver','test')",
      [u.buyer, u.approver, u.both],
    );
    await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[u.store,u.admin]);
    const records = await createDashboardSamples(db.pool, u.owner, u.admin);
    const ops = new OperationsRepository(db.pool);
    for (const r of records.filter((x: any) => x.ipoId).slice(0, 1)) await ops.issue(u.owner, { ipoId: r.ipoId, notes: "test", requestKey: randomUUID() });
    const repo = new ProcurementRepository(db.pool);

    // A request with quotes, waiting for approval.
    let pr = await repo.createFromToBuy(u.buyer);
    for (const l of pr.lines) pr = await repo.addQuote(u.buyer, pr.id, l.id, { vendor: "Powerline", rate: "100", note: "" });
    pr = await repo.submit(u.buyer, pr.id);

    // 1. Prices: buyer, approver, Admin, Management and Accounts; never Store, other Operations, Design or Coordination.
    for (const who of [u.buyer, u.approver, u.admin, u.manager, u.accounts]) {
      assert.ok((await repo.listRequests(who)).some((r) => r.id === pr.id));
      assert.ok(Number((await repo.getRequest(who, pr.id)).totals.atChosen) > 0);
    }
    for (const who of [u.store, u.ops, u.design, u.owner]) {
      await assert.rejects(repo.listRequests(who), /not part of/);
      await assert.rejects(repo.getRequest(who, pr.id), /not part of/);
    }
    assert.ok((await repo.searchItems(u.store, "cable")).every((i) => !("rate" in i)), "Store's item search carries no rates");
    assert.ok((await repo.searchItems(u.buyer, "cable")).some((i) => "rate" in i));
    assert.equal((await repo.overview(u.store)).requests.length, 0);

    // 2. Nobody decides a request they created or sent, whatever their role.
    let own = await repo.createRequest(u.both, { title: "Own", purpose: "", neededBy: null, deliveryTo: "Power Zone Store", paymentTerms: "" });
    own = await repo.addLine(u.both, own.id, { itemKey: pr.lines[0].itemKey, quantity: "1", unit: "", note: "" });
    own = await repo.addQuote(u.both, own.id, own.lines[0].id, { vendor: "X", rate: "5", note: "" });
    own = await repo.submit(u.both, own.id);
    await assert.rejects(repo.decide(u.both, own.id, { decision: "approve", note: "" }), /cannot decide a request you created or sent/);
    assert.equal((await repo.decide(u.approver, own.id, { decision: "approve", note: "" })).status, "approved", "another approver can");

    // 3. Only Admin grants or removes Procurement access, by exact email; every change is kept.
    const access = new ProcurementAccessRepository(db.pool);
    const newEmail = `${u.newBuyer}@example.test`;
    await assert.rejects(access.change(u.manager, { email: newEmail, capability: "buyer", action: "grant", reason: "test" }), /Only Admin/);
    await assert.rejects(access.change(u.admin, { email: "nobody@example.test", capability: "buyer", action: "grant", reason: "test" }), /exactly that email/);
    await assert.rejects(access.change(u.admin, { email: `${u.manager}@example.test`, capability: "buyer", action: "grant", reason: "test" }), /must be an Operations login/);
    let list = await access.change(u.admin, { email: newEmail, capability: "buyer", action: "grant", reason: "New buyer" });
    assert.ok(list.grants.some((g) => g.email === newEmail && g.capability === "buyer"));
    assert.equal((await repo.me(u.newBuyer)).buyer, true);
    await assert.rejects(access.change(u.admin, { email: newEmail, capability: "buyer", action: "grant", reason: "again" }), /already a buyer/);
    list = await access.change(u.admin, { email: newEmail, capability: "buyer", action: "remove", reason: "Left the company" });
    assert.equal((await repo.me(u.newBuyer)).buyer, false);
    assert.deepEqual(list.events.slice(0, 2).map((e) => [e.action, e.reason, e.actor]), [["remove", "Left the company", "Admin"], ["grant", "New buyer", "Admin"]]);
    await assert.rejects(db.pool.query("UPDATE procurement_access_events SET reason='x'"), /immutable/);

    // HTTP from here: idle sign-out, password before approving, the security log.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: ORIGIN, DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "security-test-setup-token-12345678901" }));
    const login = async (id: string, pw = password) => {
      const res = await request(app).post("/api/auth/login").set("Origin", ORIGIN).set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15").send({ email: `${id}@example.test`, password: pw });
      return { status: res.status, cookie: res.headers["set-cookie"] as unknown as string[], csrf: res.body.csrfToken as string };
    };
    const tokenOf = async (id: string) => (await db.pool.query("SELECT token_hash FROM auth_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [id])).rows[0].token_hash as string;
    const idleFor = async (token: string, minutes: number) => db.pool.query(`UPDATE auth_sessions SET last_activity_at=now() - make_interval(mins => $2) WHERE token_hash=$1`, [token, minutes]);
    const post = (s: { cookie: string[]; csrf: string }, path: string, body: object) =>
      request(app).post(path).set("Cookie", s.cookie).set("Origin", ORIGIN).set("X-CSRF-Token", s.csrf).send(body);

    // 4. Idle sign-out: 30 minutes without real activity; background refreshes do not count; the 12-hour limit stays.
    assert.equal(readConfig({ NODE_ENV: "test", APP_ORIGIN: ORIGIN, DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "x".repeat(32), PZ_IDLE_MINUTES: "45" }).idleMinutes, 45);
    assert.throws(() => readConfig({ NODE_ENV: "test", APP_ORIGIN: ORIGIN, DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "x".repeat(32), PZ_IDLE_MINUTES: "1" }));
    const accounts = await login(u.accounts);
    const accountsToken = await tokenOf(u.accounts);
    await idleFor(accountsToken, 29);
    assert.equal((await request(app).get("/api/auth/session").set("Cookie", accounts.cookie).set("X-PZ-Background", "1")).status, 200);
    const still = (await db.pool.query("SELECT now() - last_activity_at > interval '28 minutes' AS idle FROM auth_sessions WHERE token_hash=$1", [accountsToken])).rows[0].idle;
    assert.equal(still, true, "a background refresh does not count as activity");
    await idleFor(accountsToken, 31);
    const ended = await request(app).get("/api/procurement/requests").set("Cookie", accounts.cookie);
    assert.equal(ended.status, 401);
    assert.match(ended.body.message, /signed out after 30 minutes without activity/);
    assert.equal((await db.pool.query("SELECT 1 FROM auth_sessions WHERE token_hash=$1", [accountsToken])).rowCount, 0);
    const active = await login(u.accounts);
    await idleFor(await tokenOf(u.accounts), 29);
    assert.equal((await request(app).get("/api/procurement/requests").set("Cookie", active.cookie)).status, 200, "real activity");
    await idleFor(await tokenOf(u.accounts), 0);
    await db.pool.query("UPDATE auth_sessions SET expires_at=now() - interval '1 second' WHERE user_id=$1", [u.accounts]);
    assert.equal((await request(app).get("/api/auth/session").set("Cookie", active.cookie)).status, 401, "the 12-hour limit still applies");

    // 5. Approving needs the password again within 5 minutes; a wrong one is refused and counts toward the lockout.
    const approver = await login(u.approver);
    let pending = await repo.createRequest(u.buyer, { title: "Needs approval", purpose: "", neededBy: null, deliveryTo: "Power Zone Store", paymentTerms: "" });
    pending = await repo.addLine(u.buyer, pending.id, { itemKey: pr.lines[0].itemKey, quantity: "1", unit: "", note: "" });
    pending = await repo.addQuote(u.buyer, pending.id, pending.lines[0].id, { vendor: "X", rate: "5", note: "" });
    pending = await repo.submit(u.buyer, pending.id);
    const approve = () => post(approver, `/api/procurement/requests/${pending.id}/decide`, { decision: "approve", note: "" });
    assert.equal((await approve()).status, 403);
    assert.match((await approve()).body.message, /Enter your password to approve/);
    assert.equal((await post(approver, "/api/auth/confirm-password", { password: "wrong-password-123" })).status, 403);
    assert.equal((await approve()).status, 403, "a wrong password does not unlock approving");
    assert.equal((await post(approver, "/api/auth/confirm-password", { password })).status, 200);
    assert.equal((await approve()).status, 200);
    await db.pool.query("UPDATE auth_sessions SET reauth_at=now() - interval '6 minutes' WHERE user_id=$1", [u.approver]);
    const late = await post(approver, `/api/procurement/stock-watch/orders`, { vendor: "Sunpower", orderReference: "SP-1", lines: [{ itemKey: "BAT-X", quantity: "1" }] });
    assert.equal(late.status, 403, "after 5 minutes the password is asked again");
    assert.match(late.body.message, /Enter your password/);
    const locked = await login(u.locked);
    let tries = 0, status = 0;
    while (tries < 15 && status !== 429) { status = (await post(locked, "/api/auth/confirm-password", { password: "not-the-password" })).status; tries++; }
    assert.equal(status, 429, "wrong passwords lead to the lockout");
    assert.equal((await login(u.locked)).status, 429, "and sign-in is locked too");

    // 7. Security log: sign-ins, failures, price views and exports, approvals, access changes; Admin reads it.
    await login(u.store, "wrong-password-123");
    const buyer = await login(u.buyer);
    assert.equal((await request(app).get(`/api/procurement/requests/${pr.id}`).set("Cookie", buyer.cookie)).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    const before = (await db.pool.query("SELECT count(*)::int AS n FROM security_events WHERE kind='view'")).rows[0].n;
    assert.equal((await request(app).get(`/api/procurement/requests/${pr.id}`).set("Cookie", buyer.cookie).set("X-PZ-Background", "1")).status, 200);
    assert.equal((await request(app).get(`/api/procurement/requests/${pr.id}/comparison.pdf`).set("Cookie", buyer.cookie)).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    const kinds = (await db.pool.query("SELECT kind, count(*)::int AS n FROM security_events GROUP BY 1")).rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.kind]: r.n }), {});
    for (const k of ["sign-in", "sign-in.failed", "sign-in.locked", "sign-out.idle", "password-check", "password-check.failed", "view", "export", "approval", "procurement-access.grant", "procurement-access.remove"])
      assert.ok(kinds[k] > 0, `security log has ${k}: ${JSON.stringify(kinds)}`);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM security_events WHERE kind='view'")).rows[0].n, before, "background refreshes are not logged as views");
    const signIn = (await db.pool.query("SELECT ip, device, user_id FROM security_events WHERE kind='sign-in' ORDER BY created_at DESC LIMIT 1")).rows[0];
    assert.ok(signIn.ip && signIn.user_id && signIn.device === "Safari on macOS");
    assert.equal(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"), "Chrome on Windows");
    const admin = await login(u.admin);
    const log = await request(app).get("/api/security-events?kind=sign-in.failed").set("Cookie", admin.cookie);
    assert.equal(log.status, 200);
    assert.ok(log.body.events.length > 0 && log.body.events.every((e: any) => e.kind === "sign-in.failed"));
    const manager = await login(u.manager);
    assert.equal((await request(app).get("/api/security-events").set("Cookie", manager.cookie)).status, 403);
    assert.equal((await request(app).get("/api/procurement/access").set("Cookie", manager.cookie)).status, 403);
    assert.equal((await post(admin, "/api/procurement/access/change", { email: newEmail.toUpperCase(), capability: "buyer", action: "grant", reason: "Back again" })).status, 200, "email matched exactly, case aside");
    await assert.rejects(db.pool.query("DELETE FROM security_events"), /immutable/);

    // Prices over HTTP: Accounts can export the comparison; Store and Coordination cannot.
    const store = await login(u.store);
    assert.equal((await request(app).get(`/api/procurement/requests/${pr.id}/comparison.pdf`).set("Cookie", store.cookie)).status, 403);
    assert.equal((await request(app).get(`/api/procurement/requests/${pr.id}/comparison.xlsx`).set("Cookie", (await login(u.owner)).cookie)).status, 403);
    const accounts2 = await login(u.accounts);
    assert.equal((await request(app).get(`/api/procurement/requests/${pr.id}/comparison.xlsx`).set("Cookie", accounts2.cookie)).status, 200);
    const items = await request(app).get("/api/procurement/items?q=cable").set("Cookie", store.cookie);
    assert.ok(!JSON.stringify(items.body).includes('"rate"'), "no rates reach Store");
  } finally {
    await db.close();
  }
});
