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
import { buildIpoPdf } from "../server/orders/report.js";
import { fingerprint } from "../server/boq/repository.js";
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
async function commercialRevision(sourceId: string) {
  return (
    await post("/revision-requests", {
      sourceQuotationId: sourceId,
      origin: "Internal management",
      costingChange: false,
      reason: "Update commercial details",
      requestedBy: "Abu Bakar",
      requestKey: randomUUID(),
    }).expect(201)
  ).body.id as string;
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
  assert.equal(
    discounted.netTotal,
    p.total,
    "Legacy pricing discount must not affect pricing",
  );
  const quotationInput = {
    pricingId: randomUUID(),
    quotedDate: "2026-10-06",
    validity: "7 Days",
    proposedBy: "Abu Bakar",
    discount: "324826.93",
  };
  const q = quote(p, boq.snapshot, quotationInput);
  assert.equal(q.footer.at(-1)!.amount, "8500000.00");
  assert.throws(
    () => quote(p, boq.snapshot, { ...quotationInput, discount: "999999999" }),
    /discount/,
  );
});
test("all presentations reconcile without duplicated BESS/EPC amounts or internal quotation leaks", async () => {
  for (const presentation of [
    "No Breakup",
    "Basic Breakup",
    "Full Breakup",
  ] as const)
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
      } else if (presentation === "Full Breakup") {
        assert.equal(q.lines.length, 16);
        assert(q.lines.every((l) => l.amount !== undefined && l.span === 1));
        assert.equal(
          q.lines.reduce((a, l) => a.add(l.amount!), new Decimal(0)).toFixed(2),
          taxMode === "Tax Included" ? p.total : p.subtotal,
        );
        assert.equal(
          q.lines.filter((l) => l.description.startsWith("DC Protection"))
            .length,
          1,
        );
        assert.equal(
          q.lines.filter((l) => l.description.startsWith("AC Protection"))
            .length,
          1,
        );
      } else assert(q.lines.every((l) => !l.amount));
      assert(
        q.lines.some((l) =>
          l.description.includes(
            "IP65 Battery Control and Safety Unit for High Voltage Batteries",
          ),
        ),
      );
      const pdf = buildQuotationPdf(q);
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      assert(
        pdf.length < 2_000_000,
        "Branded PDFs must remain practical to preview and share",
      );
      assert.equal(
        (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length,
        1,
        "Reference quotation should fit on one A4 page",
      );
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
  await post("/quotations/preview", input).expect(409);
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
  copy.revisionRequestId = await commercialRevision(issued.id);
  await post("/quotations/preview", {
    ...copy,
    descriptions: copy.descriptions.map((d: string, i: number) =>
      i === 0 ? "Altered technical specification" : d,
    ),
  }).expect(409);
  copy.validity = "14 Days";
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
    issued.snapshot.lines[0].description,
  );
  assert.equal(
    q2.snapshot.lines[0].description,
    issued.snapshot.lines[0].description,
  );
  await assert.rejects(
    db.pool.query("DELETE FROM quotation_versions"),
    /immutable/,
  );
});

test("quotation discount overrides pricing without changing the saved pricing or earlier quote", async () => {
  const input = {
    pricingId: pricing.id,
    revisionRequestId: await commercialRevision(issued.id),
    quotedDate: "2026-10-06",
    validity: "7 Days",
    proposedBy: "Abu Bakar",
    discount: "1000.50",
  };
  await db.pool.query(
    "UPDATE customers SET contact_person='Test Contact',phone='042-0000000' WHERE id=$1",
    [pricing.snapshot.customer.id],
  );
  const preview = (await post("/quotations/preview", input).expect(200)).body;
  assert.equal(preview.snapshot.customer.contactPerson, "Test Contact");
  assert.equal(preview.snapshot.customer.phone, "042-0000000");
  assert.equal(
    preview.snapshot.footer.find((r: any) => r.label === "Special Discount")
      .amount,
    "1000.50",
  );
  assert.equal(
    preview.snapshot.footer.at(-1).amount,
    new Decimal(pricing.snapshot.total).minus("1000.50").toFixed(2),
  );
  const saved = (
    await post("/quotations", {
      ...input,
      fingerprint: preview.fingerprint,
      requestKey: randomUUID(),
    }).expect(201)
  ).body;
  assert.equal(saved.snapshot.input.discount, "1000.50");
  const copy = (await get(`/quotations/${saved.id}/copy`).expect(200)).body;
  assert.equal(copy.discount, "1000.50");
  assert.equal(
    (await get(`/pricing/${pricing.id}`).expect(200)).body.snapshot.discount,
    pricing.snapshot.discount,
  );
  assert.equal(
    (
      await get(`/quotations/${issued.id}`).expect(200)
    ).body.snapshot.footer.find((r: any) => r.label === "Special Discount")
      .amount,
    issued.snapshot.footer.find((r: any) => r.label === "Special Discount")
      .amount,
  );
  await post("/quotations/preview", {
    ...input,
    discount: "999999999999",
  }).expect(400);
  await post("/quotations/preview", { ...input, discount: "-1" }).expect(400);
  await post("/quotations", {
    ...input,
    discount: "2000",
    fingerprint: preview.fingerprint,
    requestKey: randomUUID(),
  }).expect(409);
});

test("BMS wording is persisted as an approved master revision and quotation default", async () => {
  const master = (
    await db.pool.query(
      "SELECT specification,status FROM item_spec_versions WHERE key='CH-BMS-HV' ORDER BY version DESC LIMIT 1",
    )
  ).rows[0];
  assert.equal(
    master.specification,
    "IP65 Battery Control and Safety Unit for High Voltage Batteries",
  );
  assert.equal(master.status, "Approved");
  assert.equal(
    (
      await db.pool.query(
        "SELECT description FROM quotation_description_defaults WHERE key='bms'",
      )
    ).rows[0].description,
    master.specification,
  );
});

test("Full Breakup additional cost, markup and tax reconcile and stay internal across versions", async () => {
  const independentBoq = randomUUID();
  await db.pool.query(
    "INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by,revision_reason) VALUES($1,$2,1,$3,$4,$5,'Test fixture')",
    [
      independentBoq,
      boq.boq_id,
      boq.number.replace(/-R0$/, "-R1"),
      boq.snapshot,
      adminId,
    ],
  );
  const pricingInput = {
    ...inputs(),
    boqRevisionId: independentBoq,
    presentation: "Full Breakup" as const,
  };
  const pp = (await post("/pricing/preview", pricingInput).expect(200)).body;
  const saved = (
    await post("/pricing", {
      ...pricingInput,
      fingerprint: pp.fingerprint,
      requestKey: randomUUID(),
    }).expect(201)
  ).body;
  for (const taxMode of [
    "Tax Included",
    "Show Sales Tax Separately",
  ] as const) {
    const p = price(boq.snapshot, boq.number, { ...pricingInput, taxMode });
    for (const taxRate of ["0", "10", "18"] as const) {
      const input = quotationSchema.parse({
        pricingId: saved.id,
        quotedDate: "2026-10-06",
        validity: "7 Days",
        proposedBy: "Abu Bakar",
        additionalItem: {
          description: "Additional equipment",
          cost: "100.00",
          markup: "25",
          taxRate,
        },
      });
      const q = quote(p, boq.snapshot, input);
      assert.equal(q.lines.length, 17);
      const extraTax = new Decimal("125").mul(taxRate).div(100);
      assert.equal(
        q.lines[16].amount,
        taxMode === "Tax Included"
          ? new Decimal("125").add(extraTax).toFixed(2)
          : "125.00",
      );
      assert.equal(
        q.footer.at(-1)!.amount,
        new Decimal(p.total).add("125").add(extraTax).toFixed(2),
      );
      assert.equal(
        q.lines.reduce((a, l) => a.add(l.amount!), new Decimal(0)).toFixed(2),
        taxMode === "Tax Included" ? q.footer[0].amount : q.footer[0].amount,
      );
      assert(!JSON.stringify(q).includes('"cost"'));
      assert(!JSON.stringify(q).includes('"markup"'));
      const pdf = buildQuotationPdf(q);
      assert.equal(
        (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length,
        1,
      );
      await writeFile(
        `.local/quotation-qa/Full-Breakup-extra-${taxMode === "Tax Included" ? "included" : "separate"}-${taxRate}.pdf`,
        pdf,
      );
    }
  }
  const input = quotationSchema.parse({
    pricingId: saved.id,
    quotedDate: "2026-10-06",
    validity: "7 Days",
    proposedBy: "Abu Bakar",
    additionalItem: {
      description: "Additional equipment",
      cost: "100.00",
      markup: "25",
      taxRate: "18",
    },
  });
  const qp = (await post("/quotations/preview", input).expect(200)).body;
  await post("/quotations", {
    ...input,
    additionalItem: { ...input.additionalItem!, cost: "125", markup: "0" },
    fingerprint: qp.fingerprint,
    requestKey: randomUUID(),
  }).expect(409);
  const savedQ = (
    await post("/quotations", {
      ...input,
      fingerprint: qp.fingerprint,
      requestKey: randomUUID(),
    }).expect(201)
  ).body;
  const copy = (await get(`/quotations/${savedQ.id}/copy`).expect(200)).body;
  assert.deepEqual(copy.additionalItem, input.additionalItem);
  assert.equal(copy.descriptions.length, 16);
  copy.revisionRequestId = await commercialRevision(savedQ.id);
  await post("/quotations/preview", {
    ...copy,
    additionalItem: { ...copy.additionalItem, cost: "101" },
  }).expect(409);
  await post("/quotations/preview", {
    ...copy,
    additionalItem: { ...copy.additionalItem, markup: "35", taxRate: "10" },
  }).expect(200);
  assert.deepEqual(
    (await post("/quotations/preview", copy).expect(200)).body.snapshot.lines,
    qp.snapshot.lines,
  );
  assert(
    !JSON.stringify(
      (await get(`/quotations/${savedQ.id}`, true).expect(200)).body,
    ).includes('"markup"'),
  );
  await get(`/quotations/${savedQ.id}/copy`, true).expect(403);
  await assert.rejects(
    db.pool.query(
      "UPDATE quotation_additional_inputs SET input='{}' WHERE quotation_id=$1",
      [savedQ.id],
    ),
    /immutable/i,
  );
});

test("customer PO and IPO preserve accepted selling amounts, discount allocation and immutable records", async () => {
  const input = {
    quotationId: issued.id,
    poNumber: "TEST-PO-001",
    orderDate: "2026-10-06",
    invoiceCompany: "PZES (Pvt) Ltd.",
    salesPerson: "Abu Bakar",
    customerAccepted: true,
    evidenceType: "Customer PO",
    evidenceNotes: "Customer PO received and checked against accepted quote.",
  };
  const op = (path: string, body: object, employee = false) =>
    request(app)
      .post("/api/orders" + path)
      .set("Origin", origin)
      .set("Cookie", employee ? employeeCookie : cookie)
      .set("X-CSRF-Token", employee ? employeeCsrf : csrf)
      .send(body);
  await request(app).get("/api/orders").expect(401);
  await request(app)
    .post("/api/orders/preview")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send(input)
    .expect(403);
  await op("/preview", { ...input, customerAccepted: false }).expect(400);
  const file = await op("/documents", {
    filename: "customer-po.pdf",
    mime: "application/pdf",
    base64: Buffer.from("%PDF-1.4\nIsolated test document").toString("base64"),
  }).expect(201);
  await op("/documents", {
    filename: "bad.pdf",
    mime: "application/pdf",
    base64: Buffer.from("invalid").toString("base64"),
  }).expect(400);
  await op("/preview", { ...input, documentId: file.body.id }, true).expect(
    403,
  );
  const body = { ...input, documentId: file.body.id };
  const p = (await op("/preview", body).expect(200)).body;
  const discounted = (
    await db.pool.query(
      "SELECT * FROM quotation_versions WHERE (snapshot->'input'->>'discount')::numeric>0 ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  assert.ok(discounted);
  const dp = (
    await op("/preview", { ...body, quotationId: discounted.id }).expect(200)
  ).body;
  assert.equal(
    dp.snapshot.allocation.total,
    discounted.snapshot.footer.at(-1).amount,
  );
  assert.ok(new Decimal(dp.snapshot.allocation.originalDiscount).gt(0));
  assert.equal(dp.snapshot.allocation.lines[0].allocatedDiscount, "0.00");
  assert.equal(
    dp.snapshot.allocation.lines
      .reduce(
        (v: Decimal, l: any) => v.add(l.allocatedDiscount),
        new Decimal(0),
      )
      .toFixed(2),
    discounted.snapshot.input.discount,
  );
  assert.equal(
    p.snapshot.allocation.total,
    issued.snapshot.footer.at(-1).amount,
  );
  assert.equal(p.snapshot.allocation.lines[0].allocatedDiscount, "0.00");
  await op(
    "",
    { input: body, fingerprint: p.fingerprint, requestKey: randomUUID() },
    true,
  ).expect(403);
  await op("", {
    input: body,
    fingerprint: "a".repeat(64),
    requestKey: randomUUID(),
  }).expect(409);
  const key = randomUUID();
  const saved = (
    await op("", {
      input: body,
      fingerprint: p.fingerprint,
      requestKey: key,
    }).expect(201)
  ).body;
  assert.equal(
    (
      await op("", {
        input: body,
        fingerprint: p.fingerprint,
        requestKey: key,
      }).expect(201)
    ).body.id,
    saved.id,
  );
  await op("", {
    input: body,
    fingerprint: p.fingerprint,
    requestKey: randomUUID(),
  }).expect(409);
  const changed = (
    await op("/preview", { ...body, paymentMode: "Bank" }).expect(200)
  ).body;
  await op("", {
    input: { ...body, paymentMode: "Bank" },
    fingerprint: changed.fingerprint,
    requestKey: key,
  }).expect(409);
  assert.equal(saved.snapshot.checkedBy, "Commercial Admin");
  assert.equal(
    saved.snapshot.peachtree.phaseTotal,
    saved.snapshot.allocation.subtotal,
  );
  const peach = await request(app)
    .get(`/api/orders/${saved.id}/peachtree.pdf`)
    .set("Cookie", employeeCookie)
    .expect(200);
  assert.equal(peach.headers["content-type"], "application/pdf");
  await request(app).get(`/api/orders/${saved.id}/peachtree.pdf`).expect(401);
  await assert.rejects(
    db.pool.query(
      "UPDATE internal_purchase_orders SET number='bad' WHERE id=$1",
      [saved.id],
    ),
    /immutable/i,
  );
  await assert.rejects(
    db.pool.query("DELETE FROM customer_purchase_orders WHERE id=$1", [
      saved.customer_po_id,
    ]),
    /immutable/i,
  );
  const loaded = await request(app)
    .get(`/api/orders/${saved.id}`)
    .set("Cookie", employeeCookie)
    .expect(200);
  assert.deepEqual(loaded.body.snapshot, saved.snapshot);
  await request(app)
    .get(`/api/orders/documents/${file.body.id}`)
    .set("Cookie", employeeCookie)
    .expect(200);
  const pdf = buildIpoPdf(saved.snapshot, saved.number);
  assert.ok(pdf.length > 5000);
  await mkdir(".local/verification", { recursive: true });
  await writeFile(".local/verification/ipo-reference.pdf", pdf);
  assert.deepEqual(
    (await get(`/quotations/${issued.id}`)).body.snapshot,
    issued.snapshot,
  );
  const evidence = {
    ...input,
    poNumber: "",
    evidenceType: "WhatsApp approval",
    evidenceNotes:
      "Customer confirmed the exact quote by WhatsApp on 6 October.",
  };
  const ep = (await op("/preview", evidence, true).expect(200)).body;
  const submissionKey = randomUUID();
  const submitted = (
    await op(
      "/submissions",
      {
        input: evidence,
        fingerprint: ep.fingerprint,
        requestKey: submissionKey,
      },
      true,
    ).expect(201)
  ).body;
  assert.equal(
    (
      await op(
        "/submissions",
        {
          input: evidence,
          fingerprint: ep.fingerprint,
          requestKey: submissionKey,
        },
        true,
      ).expect(201)
    ).body.id,
    submitted.id,
  );
  await op(
    `/submissions/${submitted.id}/approve`,
    { requestKey: randomUUID() },
    true,
  ).expect(403);
  const approvalKey = randomUUID();
  const approved = (
    await op(`/submissions/${submitted.id}/approve`, {
      requestKey: approvalKey,
    }).expect(201)
  ).body;
  assert.equal(approved.submission_id, submitted.id);
  assert.equal(approved.snapshot.preparedBy, "Employee");
  const legacySnapshot = { ...ep.snapshot };
  delete legacySnapshot.peachtree;
  const legacyId = randomUUID(),
    legacyKey = randomUUID();
  const legacyOwner = (
    await db.pool.query(
      "SELECT id FROM users WHERE email='commercial-employee@example.test'",
    )
  ).rows[0].id;
  await db.pool.query(
    "INSERT INTO ipo_submissions(id,input,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [
      legacyId,
      submitted.input,
      legacySnapshot,
      fingerprint(legacySnapshot),
      legacyKey,
      legacyOwner,
    ],
  );
  const legacyApproved = (
    await op(`/submissions/${legacyId}/approve`, {
      requestKey: randomUUID(),
    }).expect(201)
  ).body;
  assert.equal(
    legacyApproved.snapshot.peachtree.phaseTotal,
    legacyApproved.snapshot.allocation.subtotal,
  );
  assert.equal(
    (
      await op(`/submissions/${submitted.id}/approve`, {
        requestKey: approvalKey,
      }).expect(201)
    ).body.id,
    approved.id,
  );
  await op(`/submissions/${submitted.id}/approve`, {
    requestKey: randomUUID(),
  }).expect(409);
  await assert.rejects(
    db.pool.query("UPDATE ipo_submissions SET input='{}' WHERE id=$1", [
      submitted.id,
    ]),
    /immutable/i,
  );
  await op("/preview", {
    ...evidence,
    quotationId: undefined,
    directItems: [],
  }).expect(400);
});
test("revision routing requires approved separate costing and preserves origin, scope and historical links", async () => {
  const base = {
    sourceQuotationId: issued.id,
    origin: "Customer",
    costingChange: true,
    reason: "Customer requested equipment and technical changes",
    requestedBy: "Customer contact",
    requestKey: randomUUID(),
  };
  await post(
    "/revision-requests",
    { ...base, costingChange: false },
    true,
  ).expect(403);
  const started = (await post("/revision-requests", base, true).expect(201))
    .body;
  assert(
    (await get("/revision-requests", true).expect(200)).body.requests.some(
      (r: any) => r.id === started.id,
    ),
  );
  assert.equal(
    (await post("/revision-requests", base, true).expect(201)).body.draft_id,
    started.draft_id,
  );
  await post(
    "/revision-requests",
    { ...base, reason: "Changed reason" },
    true,
  ).expect(409);
  const oldSource = (await get(`/quotations/${issued.id}`)).body;
  await post("/quotations/preview", {
    pricingId: pricing.id,
    revisionRequestId: started.id,
    quotedDate: "2026-10-06",
    validity: "7 Days",
    proposedBy: "Abu Bakar",
  }).expect(409);
  const bp = (path: string, body: object, employee = false) =>
    request(app)
      .post("/api/boqs" + path)
      .set("Origin", origin)
      .set("Cookie", employee ? employeeCookie : cookie)
      .set("X-CSRF-Token", employee ? employeeCsrf : csrf)
      .send(body);
  const drafts = (
    await request(app)
      .get("/api/boqs/drafts")
      .set("Cookie", employeeCookie)
      .expect(200)
  ).body.drafts;
  const d = drafts.find((x: any) => x.id === started.draft_id);
  assert.equal(d.revision_origin, "Customer");
  const survey = {
    ...d.inputs,
    additionalItem: {
      description: "Additional reviewed equipment",
      specification: "Approved model and technical rating",
      qty: "2",
      unit: "No.",
      unitCost: "1234.56",
      taxRate: "10",
    },
    specifications: {
      "CH-BMS-HV": "Revised high voltage safety control specification",
    },
  };
  const savedDraft = (
    await bp(
      "/drafts",
      {
        id: d.id,
        version: d.version,
        inputs: survey,
        baseRevisionId: d.base_revision_id,
        revisionReason: base.reason,
        revisionOrigin: "Customer",
      },
      true,
    ).expect(200)
  ).body;
  const preview = (await bp("/preview", survey, true).expect(200)).body;
  assert.equal(
    preview.snapshot.lines.find((l: any) => l.key === "Additional Item").total,
    "2469.12",
  );
  assert.equal(
    preview.snapshot.lines.find((l: any) => l.key === "CH-BMS-HV")
      .specification,
    survey.specifications["CH-BMS-HV"],
  );
  const review = (
    await bp(
      "/reviews",
      {
        draftId: d.id,
        version: savedDraft.version,
        fingerprint: preview.fingerprint,
      },
      true,
    ).expect(201)
  ).body;
  await bp(
    `/reviews/${review.id}/decision`,
    { outcome: "Approved", comments: "Reviewed" },
    true,
  ).expect(403);
  const approved = (
    await bp(`/reviews/${review.id}/decision`, {
      outcome: "Approved",
      comments: "Reviewed costing and scope",
    }).expect(200)
  ).body.saved;
  assert.notEqual(approved.id, issued.boq_revision_id);
  assert.equal(approved.revision_origin, "Customer");
  const pi = {
    ...inputs(),
    boqRevisionId: approved.id,
    revisionRequestId: started.id,
    presentation: "Full Breakup",
    additionalMarkup: "20",
  };
  await post("/pricing/preview", {
    ...pi,
    revisionRequestId: undefined,
  }).expect(409);
  const pp = (await post("/pricing/preview", pi).expect(200)).body;
  const priced = (
    await post("/pricing", {
      ...pi,
      fingerprint: pp.fingerprint,
      requestKey: randomUUID(),
    }).expect(201)
  ).body;
  const qi = {
    pricingId: priced.id,
    revisionRequestId: started.id,
    quotedDate: "2026-10-06",
    validity: "7 Days",
    proposedBy: "Abu Bakar",
  };
  const qp = (await post("/quotations/preview", qi).expect(200)).body;
  assert.equal(qp.snapshot.lines.length, 17);
  assert.equal(qp.snapshot.lines[16].qty, "2");
  assert.equal(qp.snapshot.lines[16].amount, "2962.94");
  assert.equal(qp.snapshot.revision.origin, "Customer");
  assert.equal(qp.snapshot.revision.sourceQuotation, issued.number);
  const key = randomUUID();
  const revised = (
    await post("/quotations", {
      ...qi,
      fingerprint: qp.fingerprint,
      requestKey: key,
    }).expect(201)
  ).body;
  assert.equal(revised.boq_revision_id, approved.id);
  assert.equal(
    (
      await post("/quotations", {
        ...qi,
        fingerprint: qp.fingerprint,
        requestKey: key,
      }).expect(201)
    ).body.id,
    revised.id,
  );
  await post("/quotations", {
    ...qi,
    fingerprint: qp.fingerprint,
    requestKey: randomUUID(),
  }).expect(409);
  assert.deepEqual(
    (await get(`/quotations/${issued.id}`)).body.snapshot,
    oldSource.snapshot,
  );
  await assert.rejects(
    db.pool.query(
      "UPDATE quotation_revision_requests SET reason='Changed' WHERE id=$1",
      [started.id],
    ),
    /immutable/i,
  );
  await assert.rejects(
    db.pool.query(
      "DELETE FROM quotation_revision_links WHERE quotation_id=$1",
      [revised.id],
    ),
    /immutable/i,
  );
});
