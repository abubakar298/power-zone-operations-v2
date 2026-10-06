import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { hashPassword } from "../server/auth/crypto.js";
import { MastersRepository } from "../server/masters/repository.js";
let db: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>,
  survey: any;
type Actor = { id: string; cookie: string; csrf: string };
let employee: Actor, other: Actor, manager: Actor;
const origin = "http://localhost:3000";
const password = "review-test-passphrase-123";
before(async () => {
  db = await testDatabase();
  app = createApp(
    db.pool,
    readConfig({
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      DATABASE_URL: db.url,
      ADMIN_SETUP_TOKEN: "reviews-isolated-setup-token-12345678",
    }),
  );
  const hash = await hashPassword(password);
  async function account(role: string): Promise<Actor> {
    const id = randomUUID(),
      email = `${id}@example.test`;
    await db.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
      [id, email, role, hash, role],
    );
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email, password })
      .expect(200);
    return {
      id,
      cookie: login.headers["set-cookie"][0].split(";")[0],
      csrf: login.body.csrfToken,
    };
  }
  employee = await account("Employee");
  other = await account("Employee");
  manager = await account("Management");
  const masters = await new MastersRepository(db.pool).list();
  const brand = (category: string, name: string) =>
    masters.brands.find((b: any) => b.category === category && b.name === name)!
      .id;
  survey = {
    customerId: 3,
    siteName: "Review sample",
    siteCode: "REV001",
    location: "Lahore",
    panelQty: 60,
    panelWattage: "645",
    structure: "Elevated",
    dcMetres: "360",
    earth25: "20",
    earth6: "90",
    earth10: "90",
    inverter: "2×15 kW",
    batteryKwh: 40,
    smartMeter: true,
    genset: true,
    brands: {
      solar: brand("Solar Panel", "Any of the Above"),
      inverter: brand("Inverter", "Chint Power"),
      battery: brand("Battery & BMS", "Chint Power"),
      cable: brand("Cable", "Newage Cables"),
      switchgear: brand("Switchgear", "CHINT"),
    },
    preparedBy: "Employee",
  };
});
after(async () => {
  await db?.close();
});
function post(actor: Actor, path: string, body: object) {
  return request(app)
    .post(`/api/boqs${path}`)
    .set("Origin", origin)
    .set("Cookie", actor.cookie)
    .set("X-CSRF-Token", actor.csrf)
    .send(body);
}
function get(actor: Actor, path: string) {
  return request(app).get(`/api/boqs${path}`).set("Cookie", actor.cookie);
}
async function submit(
  inputs: any,
  baseRevisionId?: string,
  revisionReason = "",
) {
  const d = (
    await post(employee, "/drafts", {
      version: 0,
      inputs,
      baseRevisionId,
      revisionReason,
    }).expect(200)
  ).body;
  const p = (await post(employee, "/preview", inputs).expect(200)).body;
  const s = (
    await post(employee, "/reviews", {
      draftId: d.id,
      version: d.version,
      fingerprint: p.fingerprint,
    }).expect(201)
  ).body;
  return { d, p, s };
}
let r0: any;
test("only reviewers can decide; submitted drafts lock; source access and change requests are enforced", async () => {
  const u = (
    await request(app)
      .post("/api/survey-uploads")
      .set("Origin", origin)
      .set("Cookie", employee.cookie)
      .set("X-CSRF-Token", employee.csrf)
      .send({
        filename: "survey.txt",
        mime: "text/plain",
        base64: Buffer.from("Panel quantity: 60").toString("base64"),
      })
      .expect(201)
  ).body;
  const inputs = { ...survey, uploadIds: [u.id], ocrReviewed: true };
  const { d, p, s } = await submit(inputs);
  await post(employee, "/save", {
    draftId: d.id,
    version: d.version,
    fingerprint: p.fingerprint,
  }).expect(409);
  await post(employee, "/drafts", {
    id: d.id,
    version: d.version,
    inputs,
  }).expect(409);
  await post(employee, `/reviews/${s.id}/decision`, {
    outcome: "Approved",
    comments: "",
  }).expect(403);
  await get(other, `/reviews/${s.id}`).expect(404);
  await get(other, `/reviews/${s.id}/costing.pdf`).expect(404);
  await get(manager, `/reviews/${s.id}/costing.pdf`)
    .expect(200)
    .expect("Content-Type", /application\/pdf/);
  await get(manager, `/uploads/${u.id}`).expect(200);
  await get(other, `/uploads/${u.id}`).expect(404);
  await post(manager, `/reviews/${s.id}/decision`, {
    outcome: "Changes requested",
    comments: "",
  }).expect(400);
  await post(manager, `/reviews/${s.id}/decision`, {
    outcome: "Changes requested",
    comments: "Confirm preparation details",
  }).expect(200);
  await post(employee, "/reviews", {
    draftId: d.id,
    version: d.version,
    fingerprint: p.fingerprint,
  }).expect(409);
  const updated = { ...inputs, preparedBy: "Reviewed employee" };
  const draft = (
    await post(employee, "/drafts", {
      id: d.id,
      version: d.version,
      inputs: updated,
    }).expect(200)
  ).body;
  const preview = (await post(employee, "/preview", updated).expect(200)).body;
  const resubmitted = (
    await post(employee, "/reviews", {
      draftId: d.id,
      version: draft.version,
      fingerprint: preview.fingerprint,
    }).expect(201)
  ).body;
  assert.equal(
    (await get(manager, `/reviews/${s.id}`)).body.snapshot.survey.preparedBy,
    "Employee",
  );
  await db.pool.query(
    "INSERT INTO rate_versions(key,version,rate,status) VALUES('Solar PV Modules',2,40,'Active')",
  );
  await db.pool.query("UPDATE users SET role='Employee' WHERE id=$1", [
    manager.id,
  ]);
  await post(manager, `/reviews/${resubmitted.id}/decision`, {
    outcome: "Approved",
    comments: "",
  }).expect(403);
  await db.pool.query("UPDATE users SET role='Management' WHERE id=$1", [
    manager.id,
  ]);
  const approvals = await Promise.all([
    post(manager, `/reviews/${resubmitted.id}/decision`, {
      outcome: "Approved",
      comments: "Approved",
    }),
    post(manager, `/reviews/${resubmitted.id}/decision`, {
      outcome: "Approved",
      comments: "Approved",
    }),
  ]);
  assert.deepEqual(
    approvals.map((x) => x.status),
    [200, 200],
  );
  r0 = approvals[0].body.saved;
  assert.equal(r0.id, approvals[1].body.saved.id);
  assert.equal(r0.snapshot.total, "6456786");
  await post(employee, "/drafts", {
    id: d.id,
    version: draft.version,
    inputs: updated,
  }).expect(409);
  await assert.rejects(
    db.pool.query(
      "UPDATE boq_review_submissions SET revision_reason='rewrite'",
    ),
    /immutable/,
  );
  await assert.rejects(
    db.pool.query("DELETE FROM boq_review_decisions"),
    /immutable/,
  );
});
test("revision reasons, identities and latest-base checks preserve immutable R0/R1/R2 history", async () => {
  const inputs = { ...r0.snapshot.survey, dcMetres: "362" };
  await post(employee, "/drafts", {
    version: 0,
    baseRevisionId: r0.id,
    revisionReason: "Invalid",
    inputs: { ...inputs, siteCode: "OTHER" },
  }).expect(400);
  const incomplete = (
    await post(employee, "/drafts", {
      version: 0,
      baseRevisionId: r0.id,
      inputs,
    }).expect(200)
  ).body;
  const preview = (await post(employee, "/preview", inputs).expect(200)).body;
  await post(employee, "/reviews", {
    draftId: incomplete.id,
    version: incomplete.version,
    fingerprint: preview.fingerprint,
  }).expect(400);
  const a = await submit(inputs, r0.id, "Updated DC routing"),
    b = await submit(inputs, r0.id, "Alternative route");
  const r1 = (
    await post(manager, `/reviews/${a.s.id}/decision`, {
      outcome: "Approved",
      comments: "",
    }).expect(200)
  ).body.saved;
  assert.equal(r1.boq_id, r0.boq_id);
  assert.equal(r1.number, "BAFL-REV001-001-R1");
  assert.equal(r1.revision_reason, "Updated DC routing");
  await post(manager, `/reviews/${b.s.id}/decision`, {
    outcome: "Approved",
    comments: "",
  }).expect(409);
  assert.equal(
    (await get(manager, `/reviews/${b.s.id}`)).body.status,
    "Awaiting review",
  );
  await post(manager, `/reviews/${b.s.id}/decision`, {
    outcome: "Changes requested",
    comments: "Use latest approved revision",
  }).expect(200);
  const c = await submit(
    { ...inputs, dcMetres: "364" },
    r1.id,
    "Final routing",
  );
  const r2 = (
    await post(manager, `/reviews/${c.s.id}/decision`, {
      outcome: "Approved",
      comments: "",
    }).expect(200)
  ).body.saved;
  assert.equal(r2.number, "BAFL-REV001-001-R2");
  const history = (await get(employee, `/${r2.id}/history`).expect(200)).body
    .revisions;
  assert.deepEqual(
    history.map((x: any) => x.revision),
    [2, 1, 0],
  );
  assert.equal(
    (await get(employee, `/${r0.id}`)).body.snapshot.total,
    "6456786",
  );
  await assert.rejects(
    db.pool.query(
      "UPDATE boq_revisions SET revision_reason='rewritten' WHERE id=$1",
      [r0.id],
    ),
    /immutable/,
  );
});
