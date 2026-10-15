import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import request from "supertest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { testDatabase } from "./database.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { hashPassword } from "../server/auth/crypto.js";
import { OrdersRepository } from "../server/orders/repository.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { DepartmentRepository } from "../server/departments/repository.js";
import { buildIpoPdf } from "../server/orders/report.js";
import { peachtreeDivision } from "../server/orders/peachtree.js";
import { quotationTypeLabel } from "../server/orders/sale-type.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";

async function pdfText(bytes: Buffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++)
    pages.push(
      (await (await pdf.getPage(n)).getTextContent()).items
        .map((i: any) => i.str ?? "")
        .join(" "),
    );
  await loadingTask.destroy();
  return pages;
}
test("Combined IPO packs retain accepted amounts, show sale type across all six variants and follow immutable links through Operations and departments", async () => {
  const db = await testDatabase();
  try {
    const admin = randomUUID(),
      coord = randomUUID(),
      password = "ipo-pack-test-password-298";
    for (const [id, role] of [
      [admin, "Admin"],
      [coord, "Coordinator"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
        [id, `${id}@example.test`, role, role, await hashPassword(password)],
      );
    const samples = await createDashboardSamples(db.pool, coord, admin);
    const source = samples.find((s: any) => s.ipoId)!;
    const repo = new OrdersRepository(db.pool),
      ops = new OperationsRepository(db.pool),
      departments = new DepartmentRepository(db.pool);
    const { row, division } = await repo.peachtree(source.ipoId);
    const frozen = JSON.stringify(row.snapshot);
    assert.equal(
      quotationTypeLabel(row.quotationType),
      quotationTypeLabel(division),
    );
    const { peachtree, ...legacy } = row.snapshot;
    assert.deepEqual(await repo.divisionForSnapshot(legacy), division);
    for (const presentation of ["No Breakup", "Basic Breakup", "Full Breakup"])
      for (const taxMode of ["Tax Included", "Show Sales Tax Separately"]) {
        const d = peachtreeDivision(
          row.snapshot.allocation,
          { survey: { family: "solar-hybrid" }, lines: [] } as any,
          { input: { presentation, taxMode } } as any,
        );
        const pdf = buildIpoPdf(row.snapshot, row.number, d),
          pages = await pdfText(pdf);
        assert.ok(pages.length >= 2);
        assert.match(pages[0], /INTERNAL PURCHASE ORDER/);
        assert.ok(pages[0].includes(presentation));
        assert.ok(pages[0].includes(taxMode));
        assert.match(pages.at(-1)!, /PEACHTREE DIVISION/);
        assert.ok(pages.at(-1)!.includes(row.number));
        assert.ok(pages.at(-1)!.includes(presentation));
        assert.ok(pages.at(-1)!.includes(taxMode));
        const payable = Number(row.snapshot.allocation.total).toLocaleString(
          "en-PK",
          { minimumFractionDigits: 2, maximumFractionDigits: 2 },
        );
        assert.ok(pages[0].includes(payable));
        assert.ok(pages.at(-1)!.includes(payable));
        if (taxMode === "Tax Included")
          assert.ok(
            !pages.at(-1)!.includes("IPO tax (separate reconciliation)"),
          );
      }
    const issued = await ops.issue(coord, {
      ipoId: row.id,
      notes: "Pack verification",
      requestKey: randomUUID(),
    });
    const operations = await ops.portal();
    assert.deepEqual(
      operations.issuances.find((r: any) => r.id === issued.id).quotationType,
      row.quotationType,
    );
    assert.deepEqual(
      (await ops.get(issued.id)).quotationType,
      row.quotationType,
    );
    const plan = await ops.planDelivery(admin, issued.id, {
      version: 0,
      requestKey: randomUUID(),
      details: {
        deliveryAddress: "Test address",
        siteContact: "Test contact",
        sitePhone: "0300",
        deliveryDate: "2026-10-10",
        deliveryTime: "10:00",
        instructions: "Call before delivery",
      },
    });
    const store = await ops.sendToStore(
      admin,
      issued.id,
      plan.id,
      randomUUID(),
    );
    assert.deepEqual(
      (await ops.storeIssuance(store.id)).quotationType,
      row.quotationType,
    );
    assert.deepEqual(
      (await departments.portal(admin, "Inventory")).records[0].quotationType,
      row.quotationType,
    );
    await repo.sendToAccounts(admin, row.id);
    assert.deepEqual(
      (await departments.portal(admin, "Accounts")).records.find(
        (r: any) => r.id === row.id,
      ).quotationType,
      row.quotationType,
    );
    const origin = "http://localhost:3000",
      app = createApp(
        db.pool,
        readConfig({
          NODE_ENV: "test",
          APP_ORIGIN: origin,
          DATABASE_URL: db.url,
          ADMIN_SETUP_TOKEN: "ipo-pack-setup-key-isolated-only",
        }),
      );
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: `${admin}@example.test`, password })
      .expect(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    await request(app)
      .post(`/api/orders/${row.id}/accounts-handoff`)
      .set("Cookie", cookie)
      .set("Origin", origin)
      .send({})
      .expect(403);
    await request(app)
      .post(`/api/orders/${row.id}/accounts-handoff`)
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", login.body.csrfToken)
      .send({})
      .expect(201);
    const response = await request(app)
      .get(`/api/orders/${row.id}/ipo.pdf`)
      .set("Cookie", cookie)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);
    assert.ok(
      response.headers["content-disposition"].includes(" - IPO and PT - "),
    );
    assert.match((await pdfText(response.body)).at(-1)!, /PEACHTREE DIVISION/);
    await request(app).get(`/api/orders/${row.id}/ipo.pdf`).expect(401);
    assert.equal(JSON.stringify((await repo.get(row.id)).snapshot), frozen);
    await mkdir(".local/verification", { recursive: true });
    await writeFile(
      ".local/verification/IPO-Combined-Reference.pdf",
      response.body,
    );
  } finally {
    await db.close();
  }
});
