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
import { hashPassword } from "../server/auth/crypto.js";

test("Site execution: one record per issuance, stage history, UPS rule, daily picture checks, problems and department access", async () => {
  const db = await testDatabase();
  try {
    const owner = randomUUID(), admin = randomUUID(), operations = randomUUID(), inventory = randomUUID(), accounts = randomUUID();
    const password = "site-execution-test-password-517";
    const hash = await hashPassword(password);
    for (const [id, role] of [[owner, "Coordinator"], [admin, "Admin"], [operations, "Operations"], [inventory, "Inventory"], [accounts, "Accounts"]])
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, role, hash, role]);
    const records = await createDashboardSamples(db.pool, owner, admin);
    const source = records.find((r: any) => r.ipoId)!;
    const issuance = await new OperationsRepository(db.pool).issue(owner, { ipoId: source.ipoId, notes: "For Operations", requestKey: randomUUID() });

    const repo = new SiteExecutionRepository(db.pool);
    const sites = await repo.list(operations);
    assert.equal(sites.length, 1);
    const site = sites[0];
    assert.equal(site.issuanceId, issuance.id);
    assert.equal(site.stage, "ipo_received");
    assert.equal(site.jobKey, `ipo:${source.ipoId}`);
    assert.ok(site.poDate, "PO date comes from the IPO");
    assert.equal(site.late, false);
    assert.equal((await repo.list(operations)).length, 1, "listing again creates no duplicate");

    // Stage moves are recorded as immutable events.
    let d = await repo.setStage(operations, site.id, { stage: "material_planning", note: "Starting planning" });
    assert.equal(d.stage, "material_planning");
    assert.equal(d.events[0].kind, "stage_change");
    assert.equal(d.events[0].toStage, "material_planning");
    await assert.rejects(repo.setStage(operations, site.id, { stage: "closed", note: "" }), /Only Management/);
    await assert.rejects(repo.setStage(inventory, site.id, { stage: "procurement", note: "" }), /Only Operations or Management/);
    await assert.rejects(
      db.pool.query("UPDATE site_execution_events SET note='x' WHERE execution_id=$1", [site.id]),
      /immutable/,
    );

    // Dates, monitoring and the UPS rule.
    d = await repo.updateFields(operations, site.id, {
      siteType: "Solar + BESS", region: "Punjab", startDate: "2026-10-10", endDate: "2026-10-12",
      matriCloudStatus: "Connected", fourGStatus: "Not connected", customerSignoff: true,
    });
    assert.equal(d.region, "Punjab");
    assert.equal(d.matriCloudStatus, "Connected");
    assert.equal(d.customerSignoff, true);
    await assert.rejects(repo.updateFields(operations, site.id, { endDate: "2026-10-01" }), /End date cannot be before/);
    d = await repo.updateFields(operations, site.id, { siteType: "UPS" });
    assert.equal(d.siteType, "UPS");
    assert.equal(d.matriCloudStatus, null, "UPS clears the monitoring app status");
    assert.equal(d.fourGStatus, null, "UPS clears the 4G status");
    const fieldEvent = d.events.find((e) => e.kind === "field_update" && e.changes.siteType);
    assert.ok(fieldEvent && fieldEvent.changes.siteType.to === "UPS");

    // Daily picture checks: three days, one marked, two missing.
    d = await repo.setPhotoCheck(operations, site.id, { date: "2026-10-10", pictures: true });
    d = await repo.setPhotoCheck(operations, site.id, { date: "2026-10-11", pictures: false });
    assert.equal(d.photoChecks.length, 2);
    assert.equal(d.missingPictureDays, 2);
    await assert.rejects(repo.setPhotoCheck(operations, site.id, { date: "2026-10-01", pictures: true }), /start on the start date/);

    // Problems: text immutable, resolution recorded.
    d = await repo.addProblem(operations, site.id, { problem: "Roof access blocked by the branch." });
    assert.equal(d.openProblems, 1);
    const problem = d.problems[0];
    await assert.rejects(db.pool.query("UPDATE site_problems SET problem='changed' WHERE id=$1", [problem.id]), /immutable/);
    d = await repo.resolveProblem(operations, site.id, problem.id, { resolution: "Keys obtained." });
    assert.equal(d.openProblems, 0);
    assert.equal(d.problems[0].status, "Resolved");
    assert.equal(d.problems[0].resolution, "Keys obtained.");

    // Management may close; the board flags late sites after the configured days.
    d = await repo.setStage(admin, site.id, { stage: "closed", note: "Done" });
    assert.equal(d.stage, "closed");
    assert.equal(d.late, false);
    await db.pool.query("UPDATE site_execution_records SET stage='installation', stage_entered_at=now()-interval '3 days' WHERE id=$1", [site.id]);
    assert.equal((await repo.get(accounts, site.id)).late, true);

    // HTTP: Operations writes, Inventory and Accounts read, Inventory cannot write.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "site-execution-setup-token-12345678" }));
    const login = async (id: string) => {
      const r = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: `${id}@example.test`, password });
      assert.equal(r.status, 200, r.text);
      return { cookie: r.headers["set-cookie"], csrf: r.body.csrfToken as string };
    };
    const ops = await login(operations), inv = await login(inventory), acc = await login(accounts);
    const list = await request(app).get("/api/site-execution").set("Cookie", ops.cookie);
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.sites.length, 1);
    assert.equal(list.body.lateAfterDays, 2);
    assert.equal((await request(app).get(`/api/site-execution/${site.id}`).set("Cookie", inv.cookie)).status, 200);
    assert.equal((await request(app).get(`/api/site-execution/${site.id}`).set("Cookie", acc.cookie)).status, 200);
    const denied = await request(app).post(`/api/site-execution/${site.id}/stage`).set("Cookie", inv.cookie).set("Origin", "http://127.0.0.1:3000").set("X-CSRF-Token", inv.csrf).send({ stage: "procurement" });
    assert.equal(denied.status, 403);
    const moved = await request(app).post(`/api/site-execution/${site.id}/stage`).set("Cookie", ops.cookie).set("Origin", "http://127.0.0.1:3000").set("X-CSRF-Token", ops.csrf).send({ stage: "commissioning", note: "via http" });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.body.stage, "commissioning");
    const bad = await request(app).post(`/api/site-execution/${site.id}/fields`).set("Cookie", ops.cookie).set("Origin", "http://127.0.0.1:3000").set("X-CSRF-Token", ops.csrf).send({ startDate: "not-a-date" });
    assert.equal(bad.status, 400);
  } finally {
    await db.close();
  }
});
