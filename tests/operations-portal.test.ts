import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { hashPassword } from "../server/auth/crypto.js";
import { fingerprint } from "../server/boq/repository.js";

test("Operations portal records demand once, separates delivery planning, freezes Store issuance, and enforces department permissions", async () => {
  const db = await testDatabase();
  try {
    const owner = randomUUID(),
      admin = randomUUID(),
      operations = randomUUID(),
      password = "operations-portal-test-password-298";
    const hash = await hashPassword(password);
    for (const [id, role] of [
      [owner, "Coordinator"],
      [admin, "Admin"],
      [operations, "Operations"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, `${id}@example.test`, role, hash, role],
      );
    const records = await createDashboardSamples(db.pool, owner, admin),
      source = records.find((r: any) => r.ipoId)!;
    const repo = new OperationsRepository(db.pool);
    const before = (
      await db.pool.query(
        "SELECT id,snapshot FROM internal_purchase_orders ORDER BY id",
      )
    ).rows;
    const key = randomUUID(),
      input = { ipoId: source.ipoId, notes: "For Operations", requestKey: key };
    const issuance = await repo.issue(owner, input);
    assert.equal((await repo.issue(owner, input)).id, issuance.id);
    const demand = (
      await db.pool.query(
        "SELECT * FROM operations_stock_demand WHERE issuance_id=$1 ORDER BY line_number",
        [issuance.id],
      )
    ).rows;
    assert.equal(demand.length, issuance.snapshot.items.length);
    assert.equal(
      demand[0].quantity,
      String(Number(issuance.snapshot.items[0].qty).toFixed(6)),
    );
    const portal = await repo.portal();
    assert.equal(portal.issuances.length, 1);
    assert.equal(portal.ipos.length, 2);
    assert.ok(
      portal.demand.every((d: any) => Number(d.sent_to_store_quantity) === 0),
    );
    await assert.rejects(
      repo.planDelivery(owner, issuance.id, {
        version: 0,
        requestKey: randomUUID(),
        details: {
          deliveryAddress: "Site",
          siteContact: "Site lead",
          sitePhone: "0300",
          deliveryDate: "2026-10-09",
          deliveryTime: "10:30",
          instructions: "",
        },
      }),
      /Operations access/,
    );
    await assert.rejects(
      repo.sendToStore(operations, issuance.id, randomUUID(), randomUUID()),
      /latest delivery details/,
    );
    const plan = await repo.planDelivery(operations, issuance.id, {
      version: 0,
      requestKey: randomUUID(),
      details: {
        deliveryAddress: "Site",
        siteContact: "Site lead",
        sitePhone: "0300",
        deliveryDate: "2026-10-09",
        deliveryTime: "10:30",
        instructions: "Call first",
      },
    });
    await assert.rejects(
      repo.sendToStore(owner, issuance.id, plan.id, randomUUID()),
      /Operations access/,
    );
    const storeKey = randomUUID();
    const [one, two] = await Promise.all([
      repo.sendToStore(operations, issuance.id, plan.id, storeKey),
      repo.sendToStore(operations, issuance.id, plan.id, storeKey),
    ]);
    assert.equal(one.id, two.id);
    assert.equal(one.snapshot.deliveryAddress, "Site");
    assert.equal(one.snapshot.destination, "Store");
    assert.equal(
      fingerprint(one.snapshot.items),
      fingerprint(issuance.snapshot.items),
    );
    await assert.rejects(
      repo.sendToStore(operations, issuance.id, plan.id, randomUUID()),
      /already been sent/,
    );
    await assert.rejects(
      repo.planDelivery(operations, issuance.id, {
        version: 1,
        requestKey: randomUUID(),
        details: plan.details,
      }),
      /frozen/,
    );
    const after = await repo.portal();
    assert.ok(
      after.demand.every((d: any) => Number(d.awaiting_store_quantity) === 0),
    );
    assert.ok(
      after.demand.every(
        (d: any) =>
          Number(d.required_quantity) === Number(d.sent_to_store_quantity),
      ),
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT id,snapshot FROM internal_purchase_orders ORDER BY id",
        )
      ).rows,
      before,
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE operations_stock_demand SET quantity=1 WHERE issuance_id=$1",
        [issuance.id],
      ),
      /immutable/i,
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE store_boq_issuances SET snapshot='{}' WHERE id=$1",
        [one.id],
      ),
      /immutable/i,
    );
    const origin = "http://localhost:3000",
      app = createApp(
        db.pool,
        readConfig({
          NODE_ENV: "test",
          APP_ORIGIN: origin,
          DATABASE_URL: db.url,
          ADMIN_SETUP_TOKEN: "operations-test-secret-not-production-298",
        }),
      );
    await request(app).get("/api/operations/portal").expect(401);
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: `${operations}@example.test`, password })
      .expect(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0],
      csrf = login.body.csrfToken;
    await request(app)
      .get("/api/operations/portal")
      .set("Cookie", cookie)
      .expect(200);
    for (const path of [
      "/api/boqs/preview",
      "/api/commercial/pricing/preview",
      "/api/orders/preview",
    ])
      await request(app)
        .post(path)
        .set("Origin", origin)
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send({})
        .expect(403);
    await request(app)
      .post(`/api/operations/${issuance.id}/send-to-store`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ deliveryPlanId: plan.id, requestKey: randomUUID() })
      .expect(403);
    const report = await request(app)
      .get(`/api/operations/store/${one.id}/report.pdf`)
      .set("Cookie", cookie)
      .expect(200);
    assert.match(report.headers["content-type"], /application\/pdf/);
  } finally {
    await db.close();
  }
});
