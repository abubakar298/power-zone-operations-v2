import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { strFromU8, unzipSync } from "fflate";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { ProcurementRepository } from "../server/procurement/repository.js";
import { buildComparisonPdf, buildComparisonXlsx, buildRfqPdf, buildRfqXlsx, buildRfqZip, RfqRepository } from "../server/procurement/rfq.js";
import { hashPassword } from "../server/auth/crypto.js";

const sheetXml = (buf: Buffer) => strFromU8(unzipSync(new Uint8Array(buf))["xl/worksheets/sheet1.xml"]);
const xmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

test("Requests for quotation: one RFQ to many vendors, quotations entered in bulk, and the comparative statement", async () => {
  const db = await testDatabase();
  try {
    const password = "rfq-test-password-2026";
    const hash = await hashPassword(password);
    const u = { owner: randomUUID(), admin: randomUUID(), buyer: randomUUID(), approver: randomUUID(), store: randomUUID() };
    const people: [string, string, string][] = [[u.owner, "Coordinator", "Coordinator"], [u.admin, "Admin", "Admin"], [u.buyer, "Operations", "Hamza Mir"], [u.approver, "Management", "Abu Bakar"], [u.store, "Inventory", "Shaigan"]];
    for (const [id, role, name] of people)
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, name, hash, role]);
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','test'),($2,'approver','test')", [u.buyer, u.approver]);
    const records = await createDashboardSamples(db.pool, u.owner, u.admin);
    const ops = new OperationsRepository(db.pool);
    for (const r of records.filter((x: any) => x.ipoId).slice(0, 1)) await ops.issue(u.owner, { ipoId: r.ipoId, notes: "test", requestKey: randomUUID() });
    const procurement = new ProcurementRepository(db.pool);
    const rfqs = new RfqRepository(db.pool, procurement);

    let pr = await procurement.createFromToBuy(u.buyer);
    pr = await procurement.updateRequest(u.buyer, pr.id, { paymentTerms: "30 days" });
    const customers = (await db.pool.query("SELECT name FROM customers")).rows.map((r) => r.name as string);

    // One RFQ to three vendors; the items and terms are frozen.
    const list = await rfqs.list(u.buyer, pr.id);
    assert.equal(list.can.create, true);
    assert.ok(list.defaults.terms.some((t) => /Payment terms: 30 days/.test(t)));
    await assert.rejects(rfqs.create(u.approver, pr.id, { vendors: [{ name: "A", contact: "" }], dueOn: list.defaults.dueOn, terms: [] }), /Only the Procurement buyer/);
    await assert.rejects(rfqs.create(u.buyer, pr.id, { vendors: [{ name: "Powerline", contact: "" }, { name: " powerline ", contact: "" }], dueOn: list.defaults.dueOn, terms: [] }), /listed twice/);
    await assert.rejects(rfqs.create(u.buyer, pr.id, { vendors: [{ name: "A", contact: "" }], dueOn: "2020-01-01", terms: [] }), /due date has passed/);
    const made = await rfqs.create(u.buyer, pr.id, {
      vendors: [{ name: "Powerline", contact: "Ali 0300" }, { name: "Pak Cables", contact: "" }, { name: "Switchmart", contact: "" }], dueOn: list.defaults.dueOn, terms: list.defaults.terms,
    });
    const f = made.rfq;
    assert.match(f.number, /^RFQ-\d{2}-\d{3}$/);
    assert.equal(f.vendors.length, 3);
    assert.equal(f.items.length, pr.lines.length);
    assert.equal(f.contact.name, "Hamza Mir");
    await assert.rejects(db.pool.query("UPDATE purchase_rfqs SET due_on=now() WHERE id=$1", [f.id]), /immutable/);
    await assert.rejects(rfqs.list(u.store, pr.id), /belong to Procurement/);

    // The documents carry the items and terms, never rates or customer names.
    const powerline = f.vendors.find((v) => v.vendor === "Powerline")!;
    const pdf = buildRfqPdf(f, powerline);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    const xml = sheetXml(buildRfqXlsx(f, powerline));
    assert.ok(xml.includes("Item ID") && xml.includes("Unit rate (PKR)") && xml.includes("Powerline") && f.items.every((i) => xml.includes(xmlText(i.itemKey))));
    assert.ok(customers.every((c) => !xml.includes(xmlText(c))), "no customer names go to vendors");
    assert.equal(Object.keys(unzipSync(new Uint8Array(buildRfqZip(f)))).length, 6, "a PDF and an Excel per vendor");

    // Each vendor's quotation for all items at once; a later rate from the same vendor replaces the earlier one.
    const lines = pr.lines.slice(0, 2);
    await assert.rejects(procurement.importQuotes(u.store, pr.id, { vendor: "Powerline", lines: [{ lineId: lines[0].id, rate: "1", note: "" }] }), /Only the Procurement buyer/);
    pr = await procurement.importQuotes(u.buyer, pr.id, { vendor: "Powerline", lines: lines.map((l) => ({ lineId: l.id, rate: "120", note: "Brand: X" })) });
    pr = await procurement.importQuotes(u.buyer, pr.id, { vendor: "Pak Cables", lines: lines.map((l) => ({ lineId: l.id, rate: "110", note: "" })) });
    assert.equal(pr.lines[0].chosen!.vendor, "Pak Cables", "the lowest is chosen");
    pr = await procurement.chooseQuote(u.buyer, pr.id, lines[0].id, pr.lines[0].quotes.find((q) => q.vendor === "Powerline")!.id);
    pr = await procurement.importQuotes(u.buyer, pr.id, { vendor: "Local Trader", lines: [{ lineId: lines[0].id, rate: "90", note: "" }] });
    assert.equal(pr.lines[0].chosen!.vendor, "Powerline", "a lower rate later does not override the buyer's pick");
    pr = await procurement.importQuotes(u.buyer, pr.id, { vendor: "powerline", lines: [{ lineId: lines[0].id, rate: "105", note: "revised" }] });
    const first = pr.lines.find((l) => l.id === lines[0].id)!;
    assert.equal(first.quotes.filter((q) => q.vendor.toLowerCase() === "powerline").length, 1, "replaced, not added");
    assert.equal(first.chosen!.rate, "105", "the buyer's pick stays chosen with its new rate");
    await assert.rejects(procurement.importQuotes(u.buyer, pr.id, { vendor: "X", lines: [{ lineId: randomUUID(), rate: "1", note: "" }] }), /not on this request/);
    const after = (await rfqs.list(u.buyer, pr.id)).rfqs[0];
    assert.deepEqual(after.vendors.map((v) => [v.vendor, Boolean(v.repliedAt)]), [["Pak Cables", true], ["Powerline", true], ["Switchmart", false]]);

    // The comparative statement sets the vendors side by side.
    const cmp = sheetXml(buildComparisonXlsx(pr));
    assert.ok(cmp.includes("Pak Cables") && cmp.includes("Powerline") && cmp.includes("Total of items quoted"));
    assert.equal(buildComparisonPdf(pr).subarray(0, 4).toString(), "%PDF");

    // HTTP downloads: the buyer and approver get them; Store does not.
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "rfq-test-setup-token-1234567890123456" }));
    const login = async (id: string) => (await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: `${id}@example.test`, password })).headers["set-cookie"] as unknown as string[];
    const buyer = await login(u.buyer), approver = await login(u.approver), store = await login(u.store);
    const pdfRes = await request(app).get(`/api/procurement/rfqs/${f.id}/vendors/${powerline.id}/pdf`).set("Cookie", buyer);
    assert.equal(pdfRes.status, 200);
    assert.match(String(pdfRes.headers["content-type"]), /application\/pdf/);
    assert.match(String(pdfRes.headers["content-disposition"]), /Powerline - Procurement - Request for Quotation - .+\.pdf/);
    assert.equal((await request(app).get(`/api/procurement/rfqs/${f.id}/all.zip`).set("Cookie", buyer)).status, 200);
    assert.equal((await request(app).get(`/api/procurement/requests/${pr.id}/comparison.xlsx`).set("Cookie", approver)).status, 200);
    assert.equal((await request(app).get(`/api/procurement/rfqs/${f.id}/vendors/${f.vendors[0].id}/pdf`).set("Cookie", store)).status, 403);
    assert.equal((await request(app).get(`/api/procurement/requests/${pr.id}/comparison.pdf`).set("Cookie", store)).status, 403);
  } finally {
    await db.close();
  }
});
