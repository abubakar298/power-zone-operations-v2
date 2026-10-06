import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { MastersRepository } from "../server/masters/repository.js";
import { calculate } from "../server/boq/engine.js";
import { surveySchema } from "../server/boq/schema.js";
import { price, quote, NOTES, TERMS } from "../server/commercial/engine.js";
import { pricingSchema, quotationSchema } from "../server/commercial/schema.js";
import { buildQuotationPdf } from "../server/commercial/report.js";
import { hashPassword } from "../server/auth/crypto.js";
import { Decimal } from "decimal.js";
let db: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>,
  cookie: string,
  csrf: string,
  adminId: string,
  employeeCookie: string,
  employeeCsrf: string,
  boq: any,
  pricing: any,
  issued: any;
const origin = "http://localhost:3000";
const inputs = () =>
  pricingSchema.parse({
    boqRevisionId: boq.id,
    presentation: "No Breakup",
    taxMode: "Show Sales Tax Separately",
    markups: {
      solar: "5",
      structure: "7",
      bess: "15",
      earthing: "5",
      balance: "25",
      rest: "20",
    },
    discount: "0",
    preparedBy: "Abu Bakar",
  });
function post(path: string, body: object, employee = false) {
  return request(app)
    .post("/api/commercial" + path)
    .set("Origin", origin)
    .set("Cookie", employee ? employeeCookie : cookie)
    .set("X-CSRF-Token", employee ? employeeCsrf : csrf)
    .send(body);
}
function get(path: string, employee = false) {
  return request(app)
    .get("/api/commercial" + path)
    .set("Cookie", employee ? employeeCookie : cookie);
}
before(async () => {
  db = await testDatabase();
  app = createApp(
    db.pool,
    readConfig({
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      DATABASE_URL: db.url,
      ADMIN_SETUP_TOKEN: "commercial-isolated-setup-token-12345678",
    }),
  );
  await request(app)
    .post("/api/auth/setup")
    .set("Origin", origin)
    .send({
      email: "commercial@example.test",
      displayName: "Commercial Admin",
      password: "commercial-test-passphrase-123",
      setupToken: "commercial-isolated-setup-token-12345678",
    })
    .expect(201);
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({
      email: "commercial@example.test",
      password: "commercial-test-passphrase-123",
    })
    .expect(200);
  cookie = login.headers["set-cookie"][0].split(";")[0];
  csrf = login.body.csrfToken;
  adminId = login.body.user.id;
  const employeeId = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
    [
      employeeId,
      "commercial-employee@example.test",
      "Employee",
      await hashPassword("employee-test-passphrase-123"),
      "Employee",
    ],
  );
  const el = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({
      email: "commercial-employee@example.test",
      password: "employee-test-passphrase-123",
    })
    .expect(200);
  employeeCookie = el.headers["set-cookie"][0].split(";")[0];
  employeeCsrf = el.body.csrfToken;
  const m = await new MastersRepository(db.pool).list(),
    brand = (category: string, name: string) =>
      m.brands.find((b) => b.category === category && b.name === name)!.id;
  const s = surveySchema.parse({
    customerId: 3,
    siteName: "Commercial reference 5850",
    siteCode: "05850",
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
    preparedBy: "Abu Bakar",
  });
  const bp = (path: string, body: object) =>
    request(app)
      .post("/api/boqs" + path)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send(body);
  const d = (await bp("/drafts", { version: 0, inputs: s })).body,
    p = (await bp("/preview", s)).body,
    r = (
      await bp("/reviews", {
        draftId: d.id,
        version: d.version,
        fingerprint: p.fingerprint,
      })
    ).body;
  boq = (
    await bp(`/reviews/${r.id}/decision`, {
      outcome: "Approved",
      comments: "",
    }).expect(200)
  ).body.saved;
});
after(async () => {
  await db?.close();
});
test("locked commercial case reconciles, markup is on cost, and discount follows tax", () => {
  const p = price(boq.snapshot, boq.number, inputs());
  assert.equal(p.rows[0].beforeTax, "1811160");
  assert.equal(p.solarTax, "181116.00");
  assert.equal(p.subtotal, "7601457.40");
  assert.equal(p.otherTax, "1042253.53");
  assert.equal(p.netTotal, "8824826.93");
  const discounted = price(boq.snapshot, boq.number, {
    ...inputs(),
    discount: "324826.93",
  });
  assert.equal(discounted.netTotal, "8500000.00");
  assert.throws(
    () =>
      price(boq.snapshot, boq.number, { ...inputs(), discount: "999999999" }),
    /discount/,
  );
});
test("all presentations reconcile without duplicated BESS/EPC amounts or internal quotation leaks", async () => {
  for (const presentation of ["No Breakup", "Basic Breakup"] as const)
    for (const taxMode of [
      "Tax Included",
      "Show Sales Tax Separately",
    ] as const) {
      const input = {
        ...inputs(),
        presentation,
        taxMode,
        markups: {
          ...inputs().markups,
          bess: presentation === "Basic Breakup" ? "33" : "15",
        },
      };
      const p = price(boq.snapshot, boq.number, input),
        q = quote(
          p,
          boq.snapshot,
          quotationSchema.parse({
            pricingId: randomUUID(),
            quotedDate: "2026-10-06",
            validity: "7 Days",
            proposedBy: "Abu Bakar",
          }),
        );
      assert.deepEqual(q.notes, NOTES);
      assert.deepEqual(q.terms, TERMS);
      assert(!JSON.stringify(q).includes("approved_specification"));
      assert(!JSON.stringify(q).includes("rateVersion"));
      assert(!JSON.stringify(q).includes("markup"));
      if (taxMode === "Tax Included") {
        assert.deepEqual(
          q.footer.map((r) => r.label),
          ["Total", "Special Discount", "Net Total"],
        );
        assert(!/GST|sales tax|tax included/i.test(JSON.stringify(q)));
      } else
        assert.deepEqual(
          q.footer.map((r) => r.label),
          [
            "Subtotal Before Tax",
            "SOLAR PANEL SALES TAX @10%",
            "SALES TAX ON OTHER ITEMS @18%",
            "Special Discount",
            "Net Total",
          ],
        );
      if (presentation === "Basic Breakup") {
        const amounts = q.lines.filter((l) => l.amount);
        assert.equal(amounts.length, 5);
        assert.equal(q.lines.find((l) => l.group === "bess")!.span, 3);
        assert.equal(
          amounts.reduce((a, l) => a.add(l.amount!), new Decimal(0)).toFixed(2),
          taxMode === "Tax Included" ? p.total : p.subtotal,
        );
      } else assert(q.lines.every((l) => !l.amount));
      const pdf = buildQuotationPdf(q);
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      await mkdir(".local/quotation-qa", { recursive: true });
      await writeFile(
        `.local/quotation-qa/${presentation.replaceAll(" ", "-")}-${taxMode === "Tax Included" ? "included" : "separate"}.pdf`,
        pdf,
      );
    }
});
test("authentication, fresh role checks, stale previews and duplicate-save protection", async () => {
  await request(app).get("/api/commercial/pricing").expect(401);
  await post("/pricing/preview", inputs(), true).expect(403);
  await get("/pricing", true).expect(403);
  await request(app)
    .post("/api/commercial/pricing/preview")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send(inputs())
    .expect(403);
  const p = (await post("/pricing/preview", inputs()).expect(200)).body;
  await post("/pricing", {
    ...inputs(),
    discount: "10",
    fingerprint: p.fingerprint,
    requestKey: randomUUID(),
  }).expect(409);
  const requestKey = randomUUID();
  const saved = await Promise.all([
    post("/pricing", { ...inputs(), fingerprint: p.fingerprint, requestKey }),
    post("/pricing", { ...inputs(), fingerprint: p.fingerprint, requestKey }),
  ]);
  assert.deepEqual(
    saved.map((r) => r.status),
    [201, 201],
  );
  pricing = saved[0].body;
  assert.equal(pricing.id, saved[1].body.id);
  assert.equal(pricing.number, "CP-BAFL-05850-001-R0-V1");
  await db.pool.query("UPDATE users SET role='Employee' WHERE id=$1", [
    adminId,
  ]);
  await post("/pricing/preview", inputs()).expect(403);
  await db.pool.query("UPDATE users SET role='Admin' WHERE id=$1", [adminId]);
  await assert.rejects(
    db.pool.query("UPDATE commercial_pricing_versions SET snapshot='{}'"),
    /immutable/,
  );
});
test("saved quotation versions retain pricing, customer descriptions and PDF after masters/new pricing change", async () => {
  const input = {
    pricingId: pricing.id,
    quotedDate: "2026-10-06",
    validity: "7 Days",
    proposedBy: "Abu Bakar",
  };
  const p = (await post("/quotations/preview", input).expect(200)).body;
  const requestKey = randomUUID();
  const saved = await Promise.all([
    post("/quotations", { ...input, fingerprint: p.fingerprint, requestKey }),
    post("/quotations", { ...input, fingerprint: p.fingerprint, requestKey }),
  ]);
  assert.deepEqual(
    saved.map((r) => r.status),
    [201, 201],
  );
  issued = saved[0].body;
  assert.equal(issued.id, saved[1].body.id);
  assert.equal(issued.number, "Q-BAFL-05850-001-R0-V1");
  await get(`/quotations/${issued.id}/quotation.pdf`, true)
    .expect(200)
    .expect("Content-Type", /application\/pdf/);
  await get(`/quotations/${issued.id}/copy`, true).expect(403);
  await post(
    "/quotations",
    { ...input, fingerprint: p.fingerprint, requestKey: randomUUID() },
    true,
  ).expect(403);
  await db.pool.query(
    "INSERT INTO rate_versions(key,version,rate,status) VALUES('Solar PV Modules',2,100,'Active')",
  );
  const changed = { ...inputs(), markups: { ...inputs().markups, rest: "25" } };
  const p2 = (await post("/pricing/preview", changed)).body,
    pr2 = (
      await post("/pricing", {
        ...changed,
        fingerprint: p2.fingerprint,
        requestKey: randomUUID(),
      }).expect(201)
    ).body;
  assert.equal(pr2.version, 2);
  assert.equal(pr2.snapshot.cost, "6456786");
  const old = (await get(`/quotations/${issued.id}`)).body;
  assert.deepEqual(old.snapshot, issued.snapshot);
  const copy = (await get(`/quotations/${issued.id}/copy`)).body;
  copy.descriptions[0] = "Reviewed customer solar description";
  const qp = (await post("/quotations/preview", copy)).body;
  const q2 = (
    await post("/quotations", {
      ...copy,
      fingerprint: qp.fingerprint,
      requestKey: randomUUID(),
    }).expect(201)
  ).body;
  assert.equal(q2.version, 2);
  assert.equal(
    q2.snapshot.lines[0].description,
    "Reviewed customer solar description",
  );
  assert.notEqual(
    q2.snapshot.lines[0].description,
    issued.snapshot.lines[0].description,
  );
  await assert.rejects(
    db.pool.query("DELETE FROM quotation_versions"),
    /immutable/,
  );
});
