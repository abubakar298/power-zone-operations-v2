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
import { QualityRepository } from "../server/quality/repository.js";
import { bessPapersDeadline, deliveryDeadline, dueAt, requiredKinds } from "../server/quality/rules.js";
import { NotificationsRepository } from "../server/notifications/repository.js";
import { hashPassword } from "../server/auth/crypto.js";

const ORIGIN = "http://127.0.0.1:3000";
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomUUID())]).toString("base64");
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

test("Quality Control: deadlines, checklists, uploads, read-only viewers, notices, red sites, closing and KPI", async () => {
  // Deadlines: Mon-Fri, 9:00-18:00 Pakistan time; due 12:00 next working day; red after 18:00; BESS papers 3 calendar days.
  assert.equal(deliveryDeadline("2026-10-21").dueAt.toISOString(), "2026-10-22T07:00:00.000Z", "Wednesday -> Thursday 12:00");
  assert.equal(deliveryDeadline("2026-10-23").dueAt.toISOString(), "2026-10-26T07:00:00.000Z", "Friday -> Monday 12:00");
  assert.equal(deliveryDeadline("2026-10-24").dueAt.toISOString(), "2026-10-26T07:00:00.000Z", "Saturday -> Monday 12:00");
  assert.equal(deliveryDeadline("2026-10-23").redAfter.toISOString(), "2026-10-26T13:00:00.000Z", "red after Monday 18:00");
  assert.equal(bessPapersDeadline("2026-10-26").toISOString(), "2026-10-29T19:00:00.000Z", "end of Thursday 29 Oct");
  const s = (siteType: string, scope: string) => ({ siteType, scope, deliveredOn: "2026-10-21", bessDeliveredOn: "2026-10-22" });
  assert.deepEqual(requiredKinds(s("Solar", "installation")), ["solar_dc", "installation", "cable_variance", "acknowledgement"]);
  assert.deepEqual(requiredKinds(s("BESS", "installation")), ["bess_dc", "installation", "acknowledgement"]);
  assert.deepEqual(requiredKinds(s("Solar + BESS", "installation")), ["solar_dc", "bess_dc", "installation", "cable_variance", "acknowledgement"]);
  assert.deepEqual(requiredKinds(s("Solar", "delivery_only")), ["solar_dc", "acknowledgement"]);
  assert.equal(dueAt("bess_dc", s("Solar + BESS", "installation"))!.toISOString(), "2026-10-23T07:00:00.000Z", "from the BESS delivery day");
  assert.equal(dueAt("installation", s("Solar + BESS", "installation"))!.toISOString(), bessPapersDeadline("2026-10-22").toISOString());
  assert.equal(dueAt("installation", s("Solar", "installation")), null, "solar-only installation papers have no clock");

  const db = await testDatabase();
  try {
    const password = "quality-test-password-2026";
    const hash = await hashPassword(password);
    const u = { owner: randomUUID(), admin: randomUUID(), qc: randomUUID(), store: randomUUID(), accounts: randomUUID(), accounts2: randomUUID(), ops: randomUUID(), manager: randomUUID() };
    const people: [string, string, string][] = [
      [u.owner, "Coordinator", "Coordinator"], [u.admin, "Admin", "Admin"], [u.qc, "Quality Control", "QC In-charge"], [u.store, "Inventory", "Shaigan"],
      [u.accounts, "Accounts", "Accounts One"], [u.accounts2, "Accounts", "Accounts Two"], [u.ops, "Operations", "Ops Person"], [u.manager, "Management", "Abu Bakar"],
    ];
    for (const [id, role, name] of people)
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, name, hash, role]);
    const records = await createDashboardSamples(db.pool, u.owner, u.admin);
    const ops = new OperationsRepository(db.pool);
    for (const r of records.filter((x: any) => x.ipoId).slice(0, 2)) await ops.issue(u.owner, { ipoId: r.ipoId, notes: "test", requestKey: randomUUID() });
    const workflow = new SiteWorkflowRepository(db.pool);
    await workflow.ensure();
    const [a, b] = (await db.pool.query("SELECT id FROM site_workflow ORDER BY created_at LIMIT 2")).rows.map((r) => r.id as string);
    // Site A: Solar + BESS, delivered five days ago, nothing shared. Site B: solar, delivery only.
    await db.pool.query("UPDATE site_workflow SET stage='installation', site_type='Solar + BESS', scope='installation', delivered_on=$2 WHERE id=$1", [a, daysAgo(5)]);
    await db.pool.query("UPDATE site_workflow SET stage='delivery', site_type='Solar', scope='delivery_only', delivered_on=$2 WHERE id=$1", [b, daysAgo(0)]);

    const qc = new QualityRepository(db.pool);
    let list = await qc.sites(u.qc);
    const siteA = list.sites.find((x) => x.id === a)!;
    assert.equal(siteA.qc.red, true, "delivered five days ago, no papers: red");
    assert.equal(siteA.qc.required, 5);
    assert.equal(list.sites.find((x) => x.id === b)!.qc.red, false, "delivered today: not red yet");
    assert.equal((await workflow.get(u.ops, a)).qc.red, true, "the Operations site board shows it red too");

    // Only Quality Control (or Admin) attaches; only real files; only documents the site needs.
    const file = (kind: string) => ({ kind: kind as any, filename: "dc.png", mime: "image/png" as const, base64: png(), originalSize: 3_000_000 });
    await assert.rejects(qc.attach(u.ops, a, file("solar_dc")), /Only Quality Control/);
    await assert.rejects(qc.attach(u.store, a, file("solar_dc")), /Only Quality Control/);
    await assert.rejects(qc.attach(u.qc, a, { ...file("solar_dc"), base64: Buffer.from("not a picture at all").toString("base64") }), /not a real JPEG, PNG or PDF/);
    await assert.rejects(qc.attach(u.qc, b, file("bess_dc")), /not needed for this site/);
    await assert.rejects(qc.submit(u.qc, a, { kind: "solar_dc", note: "" }), /Attach the pictures/);

    // Admin names the viewers: Store and Accounts only; Management cannot manage it.
    await assert.rejects(qc.changeAccess(u.manager, { email: `${u.store}@example.test`, action: "grant", reason: "Store" }), /Only Admin/);
    await assert.rejects(qc.changeAccess(u.admin, { email: `${u.ops}@example.test`, action: "grant", reason: "nope" }), /Store and Accounts logins/);
    await qc.changeAccess(u.admin, { email: `${u.store}@example.test`, action: "grant", reason: "Shaigan" });
    await qc.changeAccess(u.admin, { email: `${u.accounts}@example.test`, action: "grant", reason: "Accounts" });

    // Attach two pictures, remove one, submit: late (delivered five days ago); viewers are told; the site is no longer red.
    let d = await qc.attach(u.qc, a, file("solar_dc"));
    d = await qc.attach(u.qc, a, file("solar_dc"));
    const draft = d.documents.find((x) => x.kind === "solar_dc")!.drafts;
    assert.equal(draft.length, 2);
    assert.equal(draft[0].originalSize, 3_000_000, "the original size is kept to show the saving");
    d = await qc.removeDraft(u.qc, draft[1].id);
    d = await qc.submit(u.qc, a, { kind: "solar_dc", note: "From the driver's WhatsApp" });
    const sub = d.documents.find((x) => x.kind === "solar_dc")!.submissions[0];
    assert.equal(sub.onTime, false, "after 12:00 on the next working day: late");
    assert.equal(sub.files.length, 1);
    assert.equal(d.qc.red, false);
    await assert.rejects(qc.removeDraft(u.qc, sub.files[0].id), /cannot be removed/);
    await assert.rejects(db.pool.query("DELETE FROM qc_files WHERE id=$1", [sub.files[0].id]), /cannot be changed or removed/);
    await assert.rejects(db.pool.query("DELETE FROM qc_submissions"), /immutable/);

    const notifications = new NotificationsRepository(db.pool);
    const bell = async (id: string, role: string) => (await notifications.list({ id, role } as any)).filter((n: any) => n.kind === "QC documents submitted");
    assert.equal((await bell(u.store, "Inventory")).length, 1);
    assert.equal((await bell(u.accounts, "Accounts")).length, 1);
    assert.equal((await bell(u.accounts2, "Accounts")).length, 0, "only the people Admin named");
    assert.equal((await bell(u.qc, "Quality Control")).length, 0);
    assert.match((await bell(u.store, "Inventory"))[0].reference, /Solar & Structure DC \+ delivery pictures: 1 file submitted by QC In-charge \(late\)/);

    // Viewers see submitted files only, cannot attach; others are refused.
    await qc.attach(u.qc, a, file("installation"));
    const seen = await qc.site(u.store, a);
    assert.equal(seen.can.upload, false);
    assert.equal(seen.documents.find((x) => x.kind === "installation")!.drafts.length, 0, "drafts are not shown to viewers");
    assert.equal((await qc.file(u.accounts, sub.files[0].id)).mime, "image/png");
    const installDraft = (await qc.site(u.qc, a)).documents.find((x) => x.kind === "installation")!.drafts[0];
    await assert.rejects(qc.file(u.store, installDraft.id), /not found/);
    await assert.rejects(qc.sites(u.accounts2), /not part of your workspace/);
    await assert.rejects(qc.sites(u.ops), /not part of your workspace/);
    assert.ok((await qc.sites(u.manager)).sites.length > 0, "Management views");

    // A site cannot close until every required document is in.
    await db.pool.query("UPDATE site_workflow SET stage='doc_dispatch', submitted_to_customer_date=CURRENT_DATE WHERE id=$1", [a]);
    await assert.rejects(workflow.forward(u.ops, a, { note: "" }), /Quality Control documents are still missing: Inverter & battery DC, Installation report \+ BESS installation picture, Cable variance report, Acknowledgement/);
    for (const kind of ["bess_dc", "installation", "cable_variance", "acknowledgement"]) {
      if (kind !== "installation") await qc.attach(u.qc, a, file(kind));
      await qc.submit(u.qc, a, { kind: kind as any, note: "" });
    }
    assert.equal((await workflow.forward(u.ops, a, { note: "" })).stage, "closed");
    await assert.rejects(qc.attach(u.qc, a, file("solar_dc")), /closed/);
    // Delivery-only site: closes once its DC and acknowledgement are in.
    await assert.rejects(workflow.forward(u.ops, b, { note: "" }), /still missing: Solar & Structure DC \+ delivery pictures, Acknowledgement/);
    for (const kind of ["solar_dc", "acknowledgement"]) { await qc.attach(u.qc, b, file(kind)); await qc.submit(u.qc, b, { kind: kind as any, note: "" }); }
    assert.equal((await qc.site(u.qc, b)).documents.find((x) => x.kind === "solar_dc")!.submissions[0].onTime, true, "same day: on time");
    assert.equal((await workflow.forward(u.ops, b, { note: "" })).stage, "closed");

    // KPI: QC and Management; not Store.
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit" }).format(new Date(deliveryDeadline(daysAgo(5)).dueAt)).slice(0, 7);
    const kpi = await qc.kpi(u.qc, month);
    assert.ok(kpi.late >= 1, JSON.stringify(kpi));
    assert.ok((await qc.kpi(u.manager, month)).items.length > 0);
    await assert.rejects(qc.kpi(u.store, month), /for Quality Control and Management/);

    // HTTP: the QC login reaches its workspace; Team can create the role; files open for viewers only.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: ORIGIN, DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "quality-test-setup-token-1234567890123" }));
    const login = async (id: string) => (await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: `${id}@example.test`, password })).headers["set-cookie"] as unknown as string[];
    const qcLogin = await login(u.qc), storeLogin = await login(u.store), opsLogin = await login(u.ops);
    assert.deepEqual((await request(app).get("/api/qc/me").set("Cookie", qcLogin)).body, { upload: true, view: true, manage: false, kpi: true });
    assert.equal((await request(app).get("/api/qc/sites").set("Cookie", qcLogin)).status, 200);
    const fileRes = await request(app).get(`/api/qc/files/${sub.files[0].id}`).set("Cookie", storeLogin);
    assert.equal(fileRes.status, 200);
    assert.match(String(fileRes.headers["content-type"]), /image\/png/);
    assert.equal((await request(app).get(`/api/qc/files/${sub.files[0].id}`).set("Cookie", opsLogin)).status, 403);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM roles WHERE name='Quality Control'")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
