import { Decimal } from "decimal.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { MastersRepository } from "../server/masters/repository.js";
import { calculate } from "../server/boq/engine.js";
import {
  surveySchema,
  recommendSiteCode,
  type Survey,
} from "../server/boq/schema.js";
let db: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>,
  cookie: string,
  csrf: string,
  masters: any,
  survey: Survey;
const origin = "http://localhost:3000";
before(async () => {
  db = await testDatabase();
  app = createApp(
    db.pool,
    readConfig({
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      DATABASE_URL: db.url,
      ADMIN_SETUP_TOKEN: "boq-isolated-test-setup-token-12345678",
    }),
  );
  await request(app)
    .post("/api/auth/setup")
    .set("Origin", origin)
    .send({
      email: "boq@example.test",
      displayName: "BOQ Admin",
      password: "boq-test-passphrase-123",
      setupToken: "boq-isolated-test-setup-token-12345678",
    })
    .expect(201);
  const l = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "boq@example.test", password: "boq-test-passphrase-123" })
    .expect(200);
  cookie = l.headers["set-cookie"][0].split(";")[0];
  csrf = l.body.csrfToken;
  masters = await new MastersRepository(db.pool).list();
  // Golden historical fixture runs the legacy profile; new owner-approved profiles have a dedicated integration suite.
  masters.engineeringProfiles = [];
  masters.rules.find((r:any)=>r.key==="engineering-20").value=2;
  const brand = (cat: string, name: string) =>
    masters.brands.find((b: any) => b.category === cat && b.name === name).id;
  survey = surveySchema.parse({
    customerId: 3,
    siteName: "Reference new site 05850",
    siteCode: "05850",
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
    preparedBy: "Abu Bakar",
  });
});
after(async () => {
  await db?.close();
});
function post(path: string, body: object) {
  return request(app)
    .post("/api/boqs" + path)
    .set("Origin", origin)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", csrf)
    .send(body);
}
test("BAFL-5850 reference reconciles every costing category and EPC breakdown", () => {
  const s = calculate(survey, masters);
  assert.equal(s.total, "6456786");
  assert.deepEqual(
    s.summary.map((x) => x.cost),
    ["1509300", "774000", "2933716", "1239770"],
  );
  assert.deepEqual(
    s.epc.map((x) => x.cost),
    ["193500", "90000", "116100", "840170"],
  );
  assert.equal(s.engineering.solutionId, "38.7-30-40");
  assert.equal(s.engineering.batteryModules, "8");
  assert.equal(s.engineering.bms, "2");
  assert.equal(s.engineering.strings, 5);
  assert.equal(s.lines.find((l) => l.key === "6mm² DC Cable Red")?.qty, "180");
  assert.equal(s.lines.find((l) => l.key === "16mm² 4C AC Cable")?.qty, "15");
  assert.equal(s.lines.find((l) => l.key === "25mm² 4C AC Cable")?.qty, "20");
  assert(s.warnings.length > 0);
  assert.equal(s.selectedBrands.solar.alternatives.length, 6);
});
test("string boundaries, all configurations, battery limits, fractional quantities and brand validation", () => {
  for (const [qty, expected] of [
    [1, 1],
    [14, 1],
    [15, 2],
    [29, 2],
    [30, 3],
    [44, 3],
    [45, 4],
  ])
    assert.equal(
      calculate({ ...survey, panelQty: qty }, masters).engineering.strings,
      expected,
    );
  for (const i of masters.inverters.filter((i: any) => i.configuration !== "6 kW SP")) {
    const dual = i.quantity === 2;
    const result = calculate(
      { ...survey, inverter: i.configuration, batteryKwh: dual ? 120 : 60 },
      masters,
    );
    assert.equal(
      result.lines.find((l) => l.key === i.sku)?.qty,
      String(i.quantity),
    );
    assert.equal(result.engineering.bms, dual ? "6" : "3");
    assert.equal(
      result.lines.find((l) => l.key === "16mm² 4C AC Cable")?.qty,
      "15",
    );
    assert.equal(
      result.lines.find((l) => l.key === "100A 4P MCCB")?.qty,
      dual ? "2" : undefined,
    );
  }
  assert.throws(
    () => calculate({ ...survey, inverter: "10 kW", batteryKwh: 65 }, masters),
    /Battery/,
  );
  assert.throws(
    () => calculate({ ...survey, batteryKwh: 7 }, masters),
    /Battery/,
  );
  assert.throws(
    () =>
      calculate(
        { ...survey, brands: { ...survey.brands, cable: survey.brands.solar } },
        masters,
      ),
    /brand/,
  );
  const decimal = calculate({ ...survey, dcMetres: "1.0001" }, masters);
  assert.equal(
    decimal.lines.find((l) => l.key === "6mm² DC Cable Red")?.qty,
    "0.50005",
  );
  assert.equal(recommendSiteCode("Branch 0128 Main"), "0128");
  assert.equal(recommendSiteCode("Office Lahore"), "OFFICE");
  assert.equal(recommendSiteCode("1234567"), "123456");
});
test("survey authentication, validation, persisted drafts and concurrent save issue one immutable R0", async () => {
  await request(app).get("/api/boqs").expect(401);
  await request(app)
    .post("/api/boqs/preview")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send(survey)
    .expect(403);
  await post("/preview", { ...survey, panelQty: -1 }).expect(400);
  const draft = (
    await post("/drafts", { version: 0, inputs: survey }).expect(200)
  ).body;
  const preview = (await post("/preview", survey).expect(200)).body;
  const submitted = (
    await post("/reviews", {
      draftId: draft.id,
      version: 1,
      fingerprint: preview.fingerprint,
    }).expect(201)
  ).body;
  const approvals = await Promise.all([
    post(`/reviews/${submitted.id}/decision`, {
      outcome: "Approved",
      comments: "",
    }),
    post(`/reviews/${submitted.id}/decision`, {
      outcome: "Approved",
      comments: "",
    }),
  ]);
  const responses = approvals.map((r) => ({
    status: r.status,
    body: r.body.saved,
  }));
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.equal(responses[0].body.id, responses[1].body.id);
  assert.match(responses[0].body.number, /^CPZ-BOQ-\d{2}-001-0003-003 \(BAFL-05850\)$/);
  assert.equal(
    (
      await db.pool.query("SELECT code FROM sites WHERE id=$1", [
        (await db.pool.query("SELECT site_id FROM boqs")).rows[0].site_id,
      ])
    ).rows[0].code,
    "05850",
  );
  assert.equal(
    (await db.pool.query("SELECT count(*) FROM boqs")).rows[0].count,
    "1",
  );
  await assert.rejects(
    db.pool.query("UPDATE boq_revisions SET snapshot='{}'"),
    /immutable/,
  );
  await assert.rejects(db.pool.query("DELETE FROM boqs"), /immutable/);
});
test("master changes cannot rewrite snapshots and stale previews are rejected", async () => {
  const s = { ...survey, siteCode: "NEW002", siteName: "New site 002" };
  const d = (await post("/drafts", { version: 0, inputs: s })).body,
    p = (await post("/preview", s)).body;
  await db.pool.query(
    "INSERT INTO rate_versions(key,version,rate,status) VALUES('Solar PV Modules',2,40,'Active')",
  );
  await post("/reviews", {
    draftId: d.id,
    version: 1,
    fingerprint: p.fingerprint,
  }).expect(409);
  const saved = (await request(app).get("/api/boqs").set("Cookie", cookie)).body
    .boqs[0];
  const r = await request(app)
    .get(`/api/boqs/${saved.id}`)
    .set("Cookie", cookie)
    .expect(200);
  assert.equal(r.body.snapshot.total, "6406786");
  assert.equal(
    r.body.snapshot.lines.find((l: any) => l.key === "Solar PV Modules").rate,
    "39",
  );
  const recalculated = (await post("/preview", s)).body;
  assert.equal(recalculated.snapshot.total, "6445486");
  const submitted = (
    await post("/reviews", {
      draftId: d.id,
      version: 1,
      fingerprint: recalculated.fingerprint,
    }).expect(201)
  ).body;
  await post(`/reviews/${submitted.id}/decision`, {
    outcome: "Approved",
    comments: "",
  }).expect(200);
});
test("uploaded sources are type checked, require authentication, and require review before saving", async () => {
  const upload = (data: object) =>
    request(app)
      .post("/api/survey-uploads")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send(data);
  await upload({
    filename: "fake.png",
    mime: "image/png",
    base64: Buffer.from("not an image").toString("base64"),
  }).expect(400);
  const u = (
    await upload({
      filename: "survey.txt",
      mime: "text/plain",
      base64: Buffer.from("Panel quantity: 60\nPanel wattage: 645").toString(
        "base64",
      ),
    }).expect(201)
  ).body;
  await request(app).get(`/api/boqs/uploads/${u.id}`).expect(401);
  const s = {
    ...survey,
    siteCode: "DOC003",
    siteName: "Document site",
    uploadIds: [u.id],
    ocrText: "Panel quantity: 60",
    ocrReviewed: false,
  };
  const d = (await post("/drafts", { version: 0, inputs: s })).body,
    p = (await post("/preview", s)).body;
  await post("/reviews", {
    draftId: d.id,
    version: 1,
    fingerprint: p.fingerprint,
  }).expect(400);
  const reviewed = { ...s, ocrReviewed: true };
  const updated = (
      await post("/drafts", { id: d.id, version: 1, inputs: reviewed })
    ).body,
    pr = (await post("/preview", reviewed)).body;
  const submitted = (
    await post("/reviews", {
      draftId: d.id,
      version: updated.version,
      fingerprint: pr.fingerprint,
    }).expect(201)
  ).body;
  const saved = (
    await post(`/reviews/${submitted.id}/decision`, {
      outcome: "Approved",
      comments: "",
    }).expect(200)
  ).body.saved;
  assert.equal(saved.snapshot.survey.uploadIds[0], u.id);
  await request(app)
    .get(`/api/boqs/uploads/${u.id}`)
    .set("Cookie", cookie)
    .expect("Content-Type", /octet-stream/)
    .expect(200);
});

test("incomplete drafts can be saved but never become a BOQ until complete", async () => {
  const d = (
    await post("/drafts", {
      version: 0,
      inputs: { siteName: "Incomplete survey" },
    }).expect(200)
  ).body;
  await post("/reviews", {
    draftId: d.id,
    version: 1,
    fingerprint: "0".repeat(64),
  }).expect(400);
  const list = await request(app)
    .get("/api/boqs/drafts")
    .set("Cookie", cookie)
    .expect(200);
  assert(list.body.drafts.some((row: { id: string }) => row.id === d.id));
});

test("costing PDF exports require authentication, owned drafts and an unchanged reviewed preview", async () => {
  const inputs = { ...survey, siteName: "PDF sample", siteCode: "PDF001" };
  const d = (await post("/drafts", { version: 0, inputs }).expect(200)).body;
  const preview = (await post("/preview", inputs).expect(200)).body;
  const url = `/api/boqs/drafts/${d.id}/costing.pdf?fingerprint=${preview.fingerprint}`;
  await request(app).get(url).expect(401);
  const pdf = await request(app)
    .get(url)
    .set("Cookie", cookie)
    .expect(200)
    .expect("Content-Type", /application\/pdf/);
  assert.match(
    pdf.headers["content-disposition"],
    /PREVIEW-PDF001-costing.pdf/,
  );
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  assert.equal(pdf.headers["cache-control"], "private, no-store");
  await request(app)
    .get(url.replace(d.id, "00000000-0000-4000-8000-000000000001"))
    .set("Cookie", cookie)
    .expect(404);
  await post("/drafts", {
    id: d.id,
    version: d.version,
    inputs: { ...inputs, panelQty: inputs.panelQty + 1 },
  }).expect(200);
  await request(app).get(url).set("Cookie", cookie).expect(409);
  const record = (await request(app).get("/api/boqs").set("Cookie", cookie))
    .body.boqs[0];
  await request(app).get(`/api/boqs/${record.id}/costing.pdf`).expect(401);
  const saved = await request(app)
    .get(`/api/boqs/${record.id}/costing.pdf`)
    .set("Cookie", cookie)
    .expect(200);
  assert.equal(saved.body.subarray(0, 5).toString(), "%PDF-");
  assert(saved.headers["content-disposition"].includes(record.number.replace(/[^A-Za-z0-9._-]/g,"-")));
});

test("general quotations derive exact cable allowances server-side without changing surveyed BOQs", () => {
  const before = calculate(survey, masters);
  const quick = calculate(
    {
      ...survey,
      sourceMode: "General quotation",
      dcMetres: "1",
      earth25: "1",
      earth6: "1",
      earth10: "1",
    },
    masters,
  );
  const qty = (s: any, key: string) =>
    s.lines.find((l: any) => l.key === key)?.qty ?? "0";
  assert.equal(qty(quick, "6mm² DC Cable Red"), "174.15");
  assert.equal(qty(quick, "6mm² DC Cable Black"), "174.15");
  assert.equal(qty(quick, "2.5mm² Earthing Cable"), "29.025");
  assert.equal(qty(quick, "6mm² Earthing Cable"), "116.1");
  assert.equal(qty(quick, "10mm² Earthing Cable"), "116.1");
  assert.equal(qty(quick, "16mm² 4C AC Cable"), "15");
  assert.equal(qty(quick, "25mm² 4C AC Cable"), "20");
  assert.equal(quick.generalAllowances?.version, "general-cables-2026-10-v1");
  const single = calculate(
    {
      ...survey,
      inverter: "15 kW",
      batteryKwh: 20,
      sourceMode: "General quotation",
    },
    masters,
  );
  assert.equal(qty(single, "16mm² 4C AC Cable"), "30");
  assert.equal(qty(single, "25mm² 4C AC Cable"), "0");
  assert.deepEqual(calculate(survey, masters), before);
  assert.equal(before.generalAllowances, undefined);
});

test("quick quotation scope uses calculated cable quantities and includes the additional-quantity note", async () => {
  const { price, quote } = await import("../server/commercial/engine.js");
  const { pricingSchema, quotationSchema } =
    await import("../server/commercial/schema.js");
  const { randomUUID } = await import("node:crypto");
  const b = calculate(
    {
      ...survey,
      sourceMode: "General quotation",
      dcMetres: "0",
      earth25: "0",
      earth6: "0",
      earth10: "0",
    },
    masters,
  );
  const p = price(
    b,
    "GENERAL-R0",
    pricingSchema.parse({
      boqRevisionId: randomUUID(),
      presentation: "Full Breakup",
      taxMode: "Show Sales Tax Separately",
      markups: {
        solar: "10",
        structure: "20",
        bess: "30",
        earthing: "20",
        balance: "20",
        rest: "20",
      },
      preparedBy: "Test",
    }),
  );
  const q = quote(
    p,
    b,
    quotationSchema.parse({
      pricingId: randomUUID(),
      quotedDate: "2026-10-07",
      validity: "7 Days",
      proposedBy: "Test",
    }),
  );
  assert.equal(
    q.lines.find((l) => l.description.startsWith("6mm² DC Cable Red and Black"))
      ?.qty,
    "348.3",
  );
  assert.equal(
    q.lines.find((l) => l.description.startsWith("2.5mm² Earthing Cable"))?.qty,
    "29.025",
  );
  assert(
    q.notes.some(
      (n) =>
        n.includes("rates per running meter") && n.includes("including GST"),
    ),
  );
  const cable = b.lines.find((l) => l.key === "6mm² DC Cable Red")!;
  assert(
    q.notes[0].includes(
      `6mm² DC Cable Red: PKR ${new Decimal(cable.rate).mul("1.20").mul("1.18").toFixed(2)}`,
    ),
  );
  assert(q.notes.some((n) => n.includes("without a site survey")));
});

test("surveyed AC termination lengths drive costing while quick BOQs retain fixed allowances", () => {
  const measured = {
    ...survey,
    acInverter16: "12.5",
    acPanel16: "7.5",
    acInverter25: "3",
    acPanel25: "27",
  };
  const result = calculate(measured, masters);
  for (const [key, qty] of [
    ["16mm² 4C AC Cable", "20"],
    ["25mm² 4C AC Cable", "30"],
  ]) {
    const line = result.lines.find((l) => l.key === key)!;
    assert.equal(line.qty, qty);
    assert.equal(line.total, new Decimal(line.rate).mul(qty).toString());
  }
  const zero = calculate(
    {
      ...measured,
      acInverter16: "0",
      acPanel16: "0",
      acInverter25: "0",
      acPanel25: "0",
    },
    masters,
  );
  assert.ok(
    zero.lines
      .filter((l) => l.key.includes("4C AC Cable"))
      .every((l) => l.qty === "0"),
  );
  const quick = calculate(
    { ...measured, sourceMode: "General quotation" },
    masters,
  );
  assert.equal(
    quick.lines.find((l) => l.key === "16mm² 4C AC Cable")?.qty,
    "15",
  );
  assert.equal(
    quick.lines.find((l) => l.key === "25mm² 4C AC Cable")?.qty,
    "20",
  );
  assert.equal(
    surveySchema.safeParse({ ...measured, acPanel16: "-1" }).success,
    false,
  );
});

test("HV BESS IDs derive inverter quantities and BMS per inverter", async () => {
  const { bessConfigurations } = await import("../server/boq/bess.js");
  assert.equal(bessConfigurations.length, 42);
  for (const b of bessConfigurations) {
    const result = calculate(
      {
        ...survey,
        bessId: b.id,
        inverter: b.inverter,
        batteryKwh: b.batteryKwh,
      },
      masters,
    );
    assert.equal(
      result.engineering.batteryModules,
      String(b.batteryModules),
      b.id,
    );
    assert.equal(result.engineering.bms, String(b.bmsQty), b.id);
    assert.equal(
      result.lines.find((l) => l.key.startsWith("HYB-"))?.qty,
      String(b.inverterQty),
      b.id,
    );
  }
  for (const [capacity, bms] of [
    [60, 4],
    [80, 4],
    [120, 6],
  ]) {
    const result = calculate(
      {
        ...survey,
        inverter: "2×12 kW",
        batteryKwh: capacity,
        bessId: `BESS-24-${capacity}`,
      },
      masters,
    );
    assert.equal(result.engineering.bms, String(bms));
  }
  assert.throws(
    () => calculate({ ...survey, bessId: "BESS-6-20" }, masters),
    /supported HV/,
  );
  assert.throws(
    () => calculate({ ...survey, bessId: "BESS-24-30" }, masters),
    /does not match/,
  );
  const dual = calculate(
    {
      ...survey,
      inverter: "2×12 kW",
      batteryKwh: 30,
      bessId: "BESS-24-30",
      sourceMode: "General quotation",
    },
    masters,
  );
  for (const [key, qty] of [
    ["63A 4P MCB", "4"],
    ["100A 4P MCCB", "2"],
    ["16mm² 4C AC Cable", "15"],
    ["25mm² 4C AC Cable", "20"],
  ])
    assert.equal(dual.lines.find((l) => l.key === key)?.qty, qty);
});

test("SP engine prices all twelve LV configurations without HV equipment or four-core AC cable", () => {
  const keys = ["HYB-SP-006", "BAT-LV-05 KW WO BMS", "CH-BMS-LV", "10mm² 1C AC Cable",
    "500V 2P DC Breaker", "63A 2P MCB", "32A 2P MCB", "32A 2P Breaker Changeover", "63A 1P AC VPD", "SP AC Conduit Accessories and Box", "SP DC Enclosures", "DC SPD", "DC Fuse with Holder"];
  const isolated = structuredClone(masters);
  isolated.rates = isolated.rates.filter((r: any) => !keys.includes(r.key));
  for (const key of keys) isolated.rates.push({ key, unit: "Each", rate: "100", version: 1, status: "Active", notes: "isolated fixture" });
  for (let capacity = 5; capacity <= 60; capacity += 5) {
    const input = surveySchema.parse({ ...survey, panelQty: 20, bessId: `6-${capacity}`, inverter: "6 kW SP",
      batteryKwh: capacity, spLoadPanelRunMetres: "12.5" });
    const result = calculate(input, isolated);
    const line = (key: string) => result.lines.find(l => l.key === key);
    assert.equal(line("BAT-LV-05 KW WO BMS")!.qty, String(capacity / 5));
    assert.equal(line("CH-BMS-LV")!.qty, String(Math.ceil(capacity / 20)));
    assert.equal(line("10mm² 1C AC Cable")!.qty, "45");
    assert.equal(line("500V 2P DC Breaker")!.qty, "4");
    for (const forbidden of ["BAT-HV-05 KW WO BMS", "CH-BMS-HV", "AC SPD", "16mm² 4C AC Cable", "25mm² 4C AC Cable", "AC & DC Boxes"])
      assert.equal(line(forbidden), undefined);
    assert.equal(result.engineering.releaseReady, false);
  }
  assert.throws(() => calculate({ ...survey, bessId: "6-20", inverter: "6 kW SP", batteryKwh: 20, panelQty: 21, spLoadPanelRunMetres: "10" }, isolated), /two MPPT/);
  assert.throws(() => calculate({ ...survey, bessId: "6-20", inverter: "6 kW SP", batteryKwh: 25 }, isolated), /does not match/);
  const badMaster = structuredClone(isolated);
  badMaster.inverters.find((i: any) => i.configuration === "6 kW SP").quantity = 2;
  assert.throws(() => calculate({ ...survey, bessId: "6-20", inverter: "6 kW SP", batteryKwh: 20 }, badMaster), /master configuration is inconsistent/);
});

test("SP drafts retain pending electrical status while owner-authorized commercial review remains available", async () => {
  const keys = ["HYB-SP-006", "BAT-LV-05 KW WO BMS", "CH-BMS-LV", "10mm² 1C AC Cable",
    "500V 2P DC Breaker", "63A 2P MCB", "32A 2P MCB", "32A 2P Breaker Changeover", "63A 1P AC VPD", "SP AC Conduit Accessories and Box", "SP DC Enclosures", "DC SPD", "DC Fuse with Holder"];
  for (const key of keys) {
    await db.pool.query("INSERT INTO item_master(key,unit,display_name) VALUES($1,'Each',$1) ON CONFLICT(key) DO NOTHING", [key]);
    await db.pool.query("INSERT INTO rate_versions(key,version,rate,status,notes) SELECT $1,COALESCE(max(version),0)+1,100,'Active','isolated test fixture' FROM rate_versions WHERE key=$1", [key]);
  }
  await db.pool.query("INSERT INTO inverter_configurations(configuration,total_kw,sku,quantity) VALUES('6 kW SP',6,'HYB-SP-006',1) ON CONFLICT(configuration) DO NOTHING");
  const inputs = { ...survey, bessId: "6-20", inverter: "6 kW SP", batteryKwh: 20, panelQty: 20, spLoadPanelRunMetres: "10" };
  const draft = (await post("/drafts", { version: 0, inputs }).expect(200)).body;
  const preview = (await post("/preview", inputs).expect(200)).body;
  assert.equal(preview.snapshot.engineering.releaseReady, false);
  await post("/reviews", { draftId: draft.id, version: 1, fingerprint: preview.fingerprint }).expect(201);
  const row = (await db.pool.query("SELECT inputs FROM survey_drafts WHERE id=$1", [draft.id])).rows[0];
  assert.equal(row.inputs.bessId, "6-20");
  assert.equal(row.inputs.spLoadPanelRunMetres, "10");
  assert.equal(Number((await db.pool.query("SELECT count(*) FROM boq_review_submissions WHERE draft_id=$1", [draft.id])).rows[0].count), 1);
});

test("SP additive masters preserve manual rates/specs and expose owner provisional costs", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile("migrations/028_single_phase_costing.sql", "utf8");
  const old = await db.pool.query("SELECT * FROM rate_versions WHERE key='HYB-SP-006' ORDER BY version");
  const spec = await db.pool.query("SELECT * FROM item_spec_versions WHERE key='HYB-SP-006' ORDER BY version");
  await db.pool.query(sql);
  assert.deepEqual((await db.pool.query("SELECT * FROM rate_versions WHERE key='HYB-SP-006' ORDER BY version")).rows, old.rows);
  assert.deepEqual((await db.pool.query("SELECT * FROM item_spec_versions WHERE key='HYB-SP-006' ORDER BY version")).rows, spec.rows);
  for (const [key,rate] of [["500V 2P DC Breaker","4950.0000"],["SP DC Enclosures","5000.0000"],["10mm² 1C AC Cable","720.0000"]])
    assert.equal((await db.pool.query("SELECT rate FROM rate_versions WHERE key=$1 AND version=1",[key])).rows[0].rate,rate);
});

test("new survey entry fixes inverter termination and preserves measured panel quantities and legacy snapshots", () => {
  for (const [inverter, batteryKwh, fixed16, fixed25] of [["10 kW",20,"30","0"],["2×12 kW",40,"15","20"]] as const) {
    const inputs = {...survey, inverter, batteryKwh, bessId: undefined, acTerminationMode: "Fixed" as const, acInverter16:"999", acInverter25:"999", acPanel16:"7.5", acPanel25:"12"};
    const result = calculate(inputs, masters);
    for (const [key, expected] of [["16mm² 4C AC Cable",new Decimal(fixed16).plus("7.5").toString()],["25mm² 4C AC Cable",new Decimal(fixed25).plus("12").toString()]])
      assert.equal(result.lines.find(l=>l.key===key)?.qty,expected);
    assert.equal(result.survey.acTerminationMode,"Fixed");
    const legacy = calculate({...inputs, acTerminationMode:undefined, acInverter16:"1", acInverter25:"2"}, masters);
    assert.equal(legacy.lines.find(l=>l.key==="16mm² 4C AC Cable")?.qty,"8.5");
    assert.equal(legacy.lines.find(l=>l.key==="25mm² 4C AC Cable")?.qty,"14");
  }
});
