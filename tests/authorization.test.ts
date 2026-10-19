import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { digest } from "../server/auth/crypto.js";

// Real session middleware and database, without spending a password derivation
// per matrix cell. No authentication or authorization middleware is mocked.
test("department boundary rejects vertical access, including document and PDF routes", async () => {
  const db = await testDatabase();
  try {
    const origin = "http://localhost:3000";
    const app = createApp(
      db.pool,
      readConfig({
        NODE_ENV: "test",
        APP_ORIGIN: origin,
        DATABASE_URL: db.url,
        ADMIN_SETUP_TOKEN: "authorization-test-setup-token-long",
      }),
    );
    const id = randomUUID();
    const paths = [
      "/api/boqs",
      "/api/boqs/drafts",
      "/api/boqs/reviews",
      `/api/boqs/${id}`,
      `/api/boqs/${id}/history`,
      `/api/boqs/${id}/costing.pdf`,
      `/api/boqs/uploads/${id}`,
      `/api/boqs/reviews/${id}/costing.pdf`,
      "/api/commercial/pricing",
      `/api/commercial/pricing/${id}`,
      "/api/commercial/quotations",
      `/api/commercial/quotations/${id}`,
      `/api/commercial/quotations/${id}/copy`,
      `/api/commercial/quotations/${id}/quotation.pdf`,
      `/api/commercial/quotations/${id}/comparison.pdf`,
      "/api/orders",
      "/api/orders/submissions",
      `/api/orders/${id}`,
      `/api/orders/${id}/ipo.pdf`,
      `/api/orders/${id}/peachtree.pdf`,
      `/api/orders/documents/${id}`,
      `/api/orders/quotation-defaults/${id}`,
      "/api/coordinator",
      "/api/director",
      "/api/director/portfolio",
      "/api/masters",
    ];
    for (const role of [
      "Operations",
      "Inventory",
      "Accounts",
      "Design",
      "Employee",
    ]) {
      const user = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        csrf = randomUUID();
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'unused',$3)",
        [user, `${user}@example.test`, role],
      );
      await db.pool.query(
        "INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [digest(token), user, csrf],
      );
      for (const path of paths) {
        const response = await request(app)
          .get(path)
          .set("Cookie", `pz_session=${token}`);
        assert.equal(
          response.status,
          403,
          `${role} GET ${path}: ${response.status}`,
        );
        assert.equal(response.body.snapshot, undefined);
      }
      for (const path of [
        "/api/boqs/preview",
        "/api/boqs/drafts",
        "/api/boqs/save",
        "/api/boqs/reviews",
        `/api/boqs/reviews/${id}/decision`,
        `/api/boqs/reviews/${id}/external-approval`,
        "/api/commercial/pricing/preview",
        "/api/commercial/pricing",
        "/api/commercial/quotations/preview",
        "/api/commercial/quotations",
        "/api/commercial/quotations/preview.pdf",
        "/api/commercial/revision-requests",
        `/api/commercial/quotations/${id}/discount-review`,
        "/api/orders/preview",
        "/api/orders/preview.pdf",
        "/api/orders",
        "/api/orders/submissions",
        `/api/orders/submissions/${id}/approve`,
        `/api/orders/submissions/${id}/external-approval`,
        `/api/orders/${id}/accounts-handoff`,
        "/api/orders/documents",
        "/api/coordinator/events",
        `/api/coordinator/quotations/${id}/external-approval`,
        "/api/masters/customers",
      ]) {
        await request(app)
          .post(path)
          .set("Cookie", `pz_session=${token}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", csrf)
          .send({})
          .expect(403);
      }
    }
  } finally {
    await db.close();
  }
});

test("owned documents remain usable; other coordinators and unhanded departments cannot guess IDs", async () => {
  const db = await testDatabase();
  try {
    const { createDashboardSamples } =
      await import("../server/coordinator/samples.js");
    const { OrdersRepository } = await import("../server/orders/repository.js");
    const { OperationsRepository } =
      await import("../server/operations/repository.js");
    const origin = "http://localhost:3000";
    const app = createApp(
      db.pool,
      readConfig({
        NODE_ENV: "test",
        APP_ORIGIN: origin,
        DATABASE_URL: db.url,
        ADMIN_SETUP_TOKEN: "authorization-test-setup-token-long",
      }),
    );
    async function account(role: string) {
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        csrf = randomUUID();
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'unused',$3)",
        [id, `${id}@example.test`, role],
      );
      await db.pool.query(
        "INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [digest(token), id, csrf],
      );
      return { id, cookie: `pz_session=${token}`, csrf };
    }
    const admin = await account("Admin"),
      management = await account("Management"),
      owner = await account("Coordinator"),
      stranger = await account("Coordinator"),
      operations = await account("Operations"),
      inventory = await account("Inventory"),
      accounts = await account("Accounts");
    const records = await createDashboardSamples(db.pool, owner.id, admin.id);
    const sample = records.find((r: any) => r.ipoId);
    assert.ok(sample);
    const ipo = (
      await db.pool.query(
        "SELECT * FROM internal_purchase_orders WHERE id=$1",
        [sample.ipoId],
      )
    ).rows[0];
    const quotation = (
      await db.pool.query("SELECT * FROM quotation_versions WHERE id=$1", [
        sample.quotationId,
      ])
    ).rows[0];
    const boqId = sample.boqRevisionId;
    const readPaths = [
      `/api/boqs/${boqId}`,
      `/api/boqs/${boqId}/history`,
      `/api/boqs/${boqId}/costing.pdf`,
      `/api/boqs/${boqId}/instructions`,
      `/api/commercial/pricing/${quotation.pricing_id}`,
      `/api/commercial/quotations/${quotation.id}`,
      `/api/commercial/quotations/${quotation.id}/copy`,
      `/api/commercial/quotations/${quotation.id}/quotation.pdf`,
      `/api/commercial/quotations/${quotation.id}/comparison.pdf`,
      `/api/orders/${ipo.id}`,
      `/api/orders/${ipo.id}/ipo.pdf`,
      `/api/orders/${ipo.id}/peachtree.pdf`,
      `/api/orders/quotation-defaults/${quotation.id}`,
    ];
    for (const path of readPaths) {
      for (const actor of [admin, management, owner])
        await request(app).get(path).set("Cookie", actor.cookie).expect(200);
      await request(app).get(path).set("Cookie", stranger.cookie).expect(404);
      await request(app).get(path).expect(401);
    }
    const { BoqRepository } = await import("../server/boq/repository.js");
    const upload = await new BoqRepository(db.pool).upload(
      owner.id,
      "private-survey.txt",
      "text/plain",
      Buffer.from("private owner survey"),
    );
    await db.pool.query(
      "INSERT INTO boq_uploads(revision_id,upload_id) VALUES($1,$2)",
      [boqId, upload.id],
    );
    for (const actor of [owner, admin, management])
      await request(app)
        .get(`/api/boqs/uploads/${upload.id}`)
        .set("Cookie", actor.cookie)
        .expect(200);
    await request(app)
      .get(`/api/boqs/uploads/${upload.id}`)
      .set("Cookie", stranger.cookie)
      .expect(404);
    for (const actor of [operations, inventory, accounts])
      await request(app)
        .get(`/api/boqs/uploads/${upload.id}`)
        .set("Cookie", actor.cookie)
        .expect(403);
    const ordersRepo = new OrdersRepository(db.pool);
    const doc = await ordersRepo.upload(
      owner.id,
      "private-po.pdf",
      "application/pdf",
      Buffer.from("%PDF-test"),
    );
    await request(app)
      .get(`/api/orders/documents/${doc.id}`)
      .set("Cookie", owner.cookie)
      .expect(200);
    await request(app)
      .get(`/api/orders/documents/${doc.id}`)
      .set("Cookie", stranger.cookie)
      .expect(404);
    for (const [path, key] of [
      ["/api/boqs", "boqs"],
      ["/api/commercial/pricing", "pricing"],
      ["/api/commercial/quotations", "quotations"],
      ["/api/orders", "orders"],
    ]) {
      const own = await request(app)
        .get(path)
        .set("Cookie", owner.cookie)
        .expect(200);
      assert.ok(own.body[key].length > 0, `owner list ${path}`);
      const foreign = await request(app)
        .get(path)
        .set("Cookie", stranger.cookie)
        .expect(200);
      assert.deepEqual(foreign.body[key], [], `other owner list ${path}`);
    }
    for (const path of [
      `/api/orders/${ipo.id}`,
      `/api/orders/${ipo.id}/ipo.pdf`,
      `/api/orders/${ipo.id}/peachtree.pdf`,
    ])
      await request(app).get(path).set("Cookie", accounts.cookie).expect(403);
    await new OrdersRepository(db.pool).sendToAccounts(owner.id, ipo.id);
    for (const path of [
      `/api/orders/${ipo.id}`,
      `/api/orders/${ipo.id}/ipo.pdf`,
      `/api/orders/${ipo.id}/peachtree.pdf`,
    ])
      await request(app).get(path).set("Cookie", accounts.cookie).expect(200);
    const ops = new OperationsRepository(db.pool);
    const received = await ops.issue(owner.id, {
      ipoId: ipo.id,
      notes: "Authorization test",
      requestKey: randomUUID(),
    });
    for (const path of [
      `/api/operations/${received.id}`,
      `/api/operations/${received.id}/report.pdf`,
      `/api/operations/${received.id}/delivery-plan`,
    ]) {
      // The Operations login no longer uses the delivery portal (Moaz, 19 Oct 2026): its workspace is /api/site-workflow.
      await request(app).get(path).set("Cookie", operations.cookie).expect(403);
      await request(app).get(path).set("Cookie", stranger.cookie).expect(404);
      await request(app).get(path).set("Cookie", inventory.cookie).expect(403);
    }
    await request(app)
      .get(`/api/operations/sources/${ipo.id}`)
      .set("Cookie", operations.cookie)
      .expect(403);
    await request(app)
      .get("/api/operations/portal")
      .set("Cookie", operations.cookie)
      .expect(403);
    await request(app)
      .get("/api/operations/portal")
      .set("Cookie", owner.cookie)
      .expect(200);
    const plan = await ops.planDelivery(operations.id, received.id, {
      version: 0,
      requestKey: randomUUID(),
      details: {
        deliveryAddress: "Test address",
        siteContact: "Test contact",
        sitePhone: "03000000000",
        deliveryDate: "2026-10-10",
        deliveryTime: "10:00",
        instructions: "Test",
      },
    });
    const store = await ops.sendToStore(
      operations.id,
      received.id,
      plan.id,
      randomUUID(),
    );
    await request(app)
      .get(`/api/operations/store/${store.id}/report.pdf`)
      .set("Cookie", inventory.cookie)
      .expect(200);
    await request(app)
      .get(`/api/operations/store/${store.id}/report.pdf`)
      .set("Cookie", stranger.cookie)
      .expect(404);
    await request(app)
      .get("/api/departments/Inventory")
      .set("Cookie", inventory.cookie)
      .expect(200);
    await request(app)
      .get("/api/departments/Accounts")
      .set("Cookie", accounts.cookie)
      .expect(200);
    await request(app)
      .get("/api/departments/Accounts")
      .set("Cookie", inventory.cookie)
      .expect(403);
    await request(app)
      .get("/api/departments/Inventory")
      .set("Cookie", accounts.cookie)
      .expect(403);
    // POST body references require ownership as well as route-level permission.
    for (const [path, body] of [
      ["/api/commercial/pricing/preview", { boqRevisionId: boqId }],
      [
        "/api/commercial/quotations/preview",
        { pricingId: quotation.pricing_id },
      ],
      ["/api/orders/preview", { quotationId: quotation.id }],
      ["/api/operations", { ipoId: ipo.id }],
      ["/api/coordinator/events", { quotationId: quotation.id }],
    ])
      await request(app)
        .post(path as string)
        .set("Cookie", stranger.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", stranger.csrf)
        .send(body)
        .expect(404);
  } finally {
    await db.close();
  }
});
