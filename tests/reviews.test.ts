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
  employee = await account("Coordinator");
  other = await account("Coordinator");
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
    acInverter16: "15",
    acInverter25: "0",
    acPanel16: "0",
    acPanel25: "20",
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
test("first approved BOQ reuses an active master site without changing it; duplicates and inactive sites are rejected", async () => {
  const siteId = 50001;
  await db.pool.query(
    "INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,3,'Pre-existing site','READY-SITE','Lahore','Active')",
    [siteId],
  );
  const before = (
    await db.pool.query("SELECT * FROM sites WHERE id=$1", [siteId])
  ).rows[0];
  const inputs = {
    ...survey,
    siteName: before.name,
    siteCode: before.code,
    location: before.location,
  };
  const first = await submit(inputs);
  const saved = (
    await post(manager, `/reviews/${first.s.id}/decision`, {
      outcome: "Approved",
      comments: "Existing site first costing",
    }).expect(200)
  ).body.saved;
  assert.equal(
    (
      await db.pool.query("SELECT site_id FROM boqs WHERE id=$1", [
        saved.boq_id,
      ])
    ).rows[0].site_id,
    siteId,
  );
  assert.deepEqual(
    (await db.pool.query("SELECT * FROM sites WHERE id=$1", [siteId])).rows[0],
    before,
  );
  const duplicate = await submit({ ...inputs, siteCode: "ready-site" });
  await post(manager, `/reviews/${duplicate.s.id}/decision`, {
    outcome: "Approved",
    comments: "",
  }).expect(409);
  assert.equal(
    (
      await db.pool.query("SELECT count(*) FROM boqs WHERE site_id=$1", [
        siteId,
      ])
    ).rows[0].count,
    "1",
  );
  await db.pool.query(
    "INSERT INTO sites(id,customer_id,name,code,location,status) VALUES(50002,3,'Inactive site','INACTIVE-SITE','Lahore','Inactive')",
  );
  const inactive = await submit({
    ...survey,
    siteName: "Inactive site",
    siteCode: "INACTIVE-SITE",
  });
  await post(manager, `/reviews/${inactive.s.id}/decision`, {
    outcome: "Approved",
    comments: "",
  }).expect(409);
  assert.equal(
    (await db.pool.query("SELECT count(*) FROM boqs WHERE site_id=50002"))
      .rows[0].count,
    "0",
  );
});
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
  assert.equal((await get(manager, `/reviews/${s.id}`)).body.revision_id, null);
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
  assert.match(r1.number, /^CPZ-BOQ-\d{2}-\d{3}-0003-\d{3}-R1 \(BAFL-REV001\)$/);
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
  assert.equal(r2.number, r1.number.replace("-R1 ","-R2 "));
  const history = (await get(employee, `/${r2.id}/history`).expect(200)).body
    .revisions;
  assert.deepEqual(
    history.map((x: any) => x.revision),
    [2, 1, 0],
  );
  assert.equal(
    (await get(manager, `/${r0.id}`)).body.snapshot.total,
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

test("external approval preserves evidence, recorder identity and instructions; Director reporting excludes quotation versions", async () => {
  await db.pool.query("UPDATE users SET role='Coordinator' WHERE id=$1", [
    employee.id,
  ]);
  const inputs = {
    ...survey,
    sourceMode: "General quotation",
    siteCode: "CHAT001",
    siteName: "Chat-approved general proposal",
  };
  const { s, p } = await submit(inputs);
  const instructions = {
    presentation: "Basic Breakup",
    taxMode: "Show Sales Tax Separately",
    markups: {
      solar: "10",
      structure: "20",
      bess: "33",
      earthing: "25",
      balance: "25",
      rest: "25",
    },
    notes: "Director-approved quotation settings",
  };
  await post(employee, `/reviews/${s.id}/decision`, {
    outcome: "Approved",
    instructions,
  }).expect(403);
  await post(employee, `/reviews/${s.id}/external-approval`, {
    instructions,
    approver: "Director Operations",
    evidenceIds: [],
    confirmed: true,
  }).expect(400);
  const upload = await request(app)
    .post("/api/survey-uploads")
    .set("Origin", origin)
    .set("Cookie", employee.cookie)
    .set("X-CSRF-Token", employee.csrf)
    .send({
      filename: "director-approval.png",
      mime: "image/png",
      base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString(
        "base64",
      ),
    })
    .expect(201);
  const body = {
    instructions,
    approver: "Director Operations",
    evidenceIds: [upload.body.id],
    confirmed: true,
  };
  await post(other, `/reviews/${s.id}/external-approval`, body).expect(404);
  await post(employee, `/reviews/${s.id}/external-approval`, {
    ...body,
    confirmed: false,
  }).expect(400);
  const saved = (
    await post(employee, `/reviews/${s.id}/external-approval`, body).expect(200)
  ).body.saved;
  assert.deepEqual(saved.snapshot, p.snapshot);
  const replay = (
    await post(employee, `/reviews/${s.id}/external-approval`, body).expect(200)
  ).body.saved;
  assert.equal(replay.id, saved.id);
  await post(employee, `/reviews/${s.id}/external-approval`, {
    ...body,
    instructions: { ...instructions, notes: "Different instructions" },
  }).expect(409);
  const review = (await get(manager, `/reviews/${s.id}`).expect(200)).body;
  assert.equal(review.approval.channel, "External chat");
  assert.equal(review.approval.recorded_by, employee.id);
  assert.equal(review.reviewed_by_name, "Coordinator"); // Stored recorder; UI labels the external channel explicitly.
  assert.equal(review.approval.claimed_approver, "Director Operations");
  assert.equal(review.approval.evidence[0].id, upload.body.id);
  await get(manager, `/uploads/${upload.body.id}`).expect(200);
  await get(other, `/uploads/${upload.body.id}`).expect(404);
  assert.deepEqual(
    (await get(employee, `/${saved.id}/instructions`).expect(200)).body
      .instructions,
    { ...instructions, markups: Object.fromEntries(Object.entries(instructions.markups).filter(([key]) => key !== "bess")) },
  );
  await assert.rejects(
    db.pool.query(
      "UPDATE costing_approval_instructions SET claimed_approver='Fake' WHERE submission_id=$1",
      [s.id],
    ),
    /immutable/,
  );
  await assert.rejects(
    db.pool.query(
      "DELETE FROM costing_approval_evidence WHERE submission_id=$1",
      [s.id],
    ),
    /immutable/,
  );
  const { CommercialRepository } =
    await import("../server/commercial/repository.js");
  const { pricingSchema, quotationSchema } =
    await import("../server/commercial/schema.js");
  const commercial = new CommercialRepository(db.pool);
  const pricing = pricingSchema.parse({
    ...instructions,
    boqRevisionId: saved.id,
    preparedBy: "Coordinator",
  });
  const price = await commercial.pricingPreview(employee.id, pricing);
  const ps = await commercial.pricingSave(
    employee.id,
    pricing,
    price.fingerprint,
    randomUUID(),
  );
  const qi = quotationSchema.parse({
    pricingId: ps.id,
    quotedDate: "2026-10-07",
    validity: "7 Days",
    proposedBy: "Coordinator",
    discount: "100",
  });
  const qp = await commercial.quotationPreview(employee.id, qi);
  const q = await commercial.quotationSave(
    employee.id,
    qi,
    qp.fingerprint,
    randomUUID(),
  );
  const revision = await commercial.revisionStart(
    employee.id,
    q.id,
    "Internal management",
    false,
    "Discount adjusted",
    "Director Operations",
    randomUUID(),
  );
  const qi2 = { ...qi, discount: "200", revisionRequestId: revision.id };
  const qp2 = await commercial.quotationPreview(employee.id, qi2);
  const q2 = await commercial.quotationSave(
    employee.id,
    qi2,
    qp2.fingerprint,
    randomUUID(),
  );
  await request(app).get("/api/director/portfolio").expect(401);
  await request(app)
    .get("/api/director/portfolio")
    .set("Cookie", employee.cookie)
    .expect(403);
  const portfolio = (
    await request(app)
      .get("/api/director/portfolio?customerId=3")
      .set("Cookie", manager.cookie)
      .expect(200)
  ).body;
  const row = portfolio.proposals.find((r: any) => r.id === saved.boq_id);
  assert.equal(row.quotationId, q2.id);
  assert.equal(row.quotationVersions.length, 2);
  assert.deepEqual(
    row.quotationVersions.map((v: any) => v.id),
    [q2.id, q.id],
  );
  assert.equal(row.quotedDate, "2026-10-07");
  assert.equal(row.quotationVersions[1].quotedDate, "2026-10-07");
  assert.equal(
    row.quotationVersions[1].customerPayable,
    qp.snapshot.footer.find((f: any) => f.label === "Net Total")!.amount,
  );
  assert.equal(row.quotationVersions[0].budgetedCost, row.budgetedCost);
  assert.equal(
    row.quotationVersions[0].budgetedMarginPercent,
    row.budgetedMarginPercent,
  );
  assert.equal(
    portfolio.proposals.every((p: any) => p.customerId === 3),
    true,
  );

  assert.notEqual(row.quotationId, q.id);
  assert.equal(
    portfolio.proposals.filter((r: any) => r.id === saved.boq_id).length,
    1,
  );
  assert.equal(row.phases.length, 6);
  assert(
    row.phases.every(
      (p: any) => p.actualCost === null && p.marginVariance === null,
    ),
  );
  assert.equal(
    row.phases.reduce((sum: number, p: any) => sum + Number(p.budgetedCost), 0),
    Number(
      new (await import("decimal.js")).Decimal((await get(manager, `/${saved.id}`)).body.snapshot.total)
        .toDecimalPlaces(2)
        .toString(),
    ),
  );
  assert.equal(row.basis, "Selling values excluding tax");
  assert.equal(
    row.customerPayable,
    qp2.snapshot.footer.find((f: any) => f.label === "Net Total")!.amount,
  );
  assert.equal(portfolio.actualCostsConnected, false);
  assert.deepEqual(portfolio.closingRequests, []);
  await request(app)
    .get("/api/director/portfolio?customerId=invalid")
    .set("Cookie", manager.cookie)
    .expect(400);
});

test("in-app approval attaches immutable Director quotation settings to its exact BOQ", async () => {
  const { s } = await submit({
    ...survey,
    siteCode: "APP001",
    siteName: "In-app approved proposal",
  });
  const instructions = {
    presentation: "Full Breakup",
    taxMode: "Tax Included",
    markups: {
      solar: "10",
      structure: "20",
      bess: "30",
      earthing: "20",
      balance: "20",
      rest: "20",
    },
    notes: "Use these margins",
  };
  const saved = (
    await post(manager, `/reviews/${s.id}/decision`, {
      outcome: "Approved",
      comments: "Costing checked",
      instructions,
    }).expect(200)
  ).body.saved;
  const approval = (
    await get(employee, `/${saved.id}/instructions`).expect(200)
  ).body;
  assert.equal(approval.channel, "In app");
  assert.equal(approval.recorded_by, manager.id);
  assert.deepEqual(approval.instructions, { ...instructions, markups: Object.fromEntries(Object.entries(instructions.markups).filter(([key]) => key !== "bess")) });
  await post(manager, `/reviews/${s.id}/decision`, {
    outcome: "Approved",
    instructions: { ...instructions, presentation: "No Breakup" },
  }).expect(409);
});

test("Director phase cost rounding conserves cents without inventing negative costs", async () => {
  const { phaseBudgets } = await import("../server/director/repository.js");
  const rows = phaseBudgets({
    inverterConfig: { sku: "INV" },
    lines: [
      { key: "PV", phase: "Solar Panels", total: "0.005" },
      { key: "Structure", phase: "Structure", total: "0.005" },
      { key: "INV", phase: "BESS", total: "0.005" },
      { key: "BAT", phase: "BESS", total: "0.005" },
      { key: "CH-BMS-HV", phase: "BESS", total: "0.005" },
    ],
  } as any);
  assert.equal(
    rows.reduce((sum, p) => sum + Number(p.budgetedCost), 0),
    0.03,
  );
  assert(rows.every((p) => Number(p.budgetedCost) >= 0));
  assert.equal(rows[5].budgetedCost, "0.00");
});
