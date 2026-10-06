import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { DepartmentRepository } from "../server/departments/repository.js";
import { hashPassword } from "../server/auth/crypto.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";

test("Department queues enforce roles, ordered Inventory progress, concurrency, retry safety and immutable source documents", async () => {
  const db = await testDatabase();
  try {
    const admin = randomUUID(),
      coord = randomUUID(),
      inventory = randomUUID(),
      accounts = randomUUID(),
      password = "department-test-password-298",
      hash = await hashPassword(password);
    for (const [id, role] of [
      [admin, "Admin"],
      [coord, "Coordinator"],
      [inventory, "Inventory"],
      [accounts, "Accounts"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, `${id}@example.test`, role, hash, role],
      );
    const samples = await createDashboardSamples(db.pool, coord, admin),
      source = samples.find((r: any) => r.ipoId)!;
    const before = (
      await db.pool.query(
        "SELECT id,snapshot FROM internal_purchase_orders ORDER BY id",
      )
    ).rows;
    const ops = new OperationsRepository(db.pool),
      repo = new DepartmentRepository(db.pool);
    const issued = await ops.issue(coord, {
      ipoId: source.ipoId,
      notes: "Store test",
      requestKey: randomUUID(),
    });
    assert.equal((await repo.portal(inventory, "Inventory")).records.length, 0);
    const plan = await ops.planDelivery(admin, issued.id, {
      version: 0,
      requestKey: randomUUID(),
      details: {
        deliveryAddress: "Test site",
        siteContact: "Site lead",
        sitePhone: "0300",
        deliveryDate: "2026-10-10",
        deliveryTime: "10:00",
        instructions: "Call before dispatch",
      },
    });
    const store = await ops.sendToStore(
      admin,
      issued.id,
      plan.id,
      randomUUID(),
    );
    const portal = await repo.portal(inventory, "Inventory");
    assert.equal(portal.records.length, 1);
    assert.equal(portal.records[0].stage, "Received BOQs");
    assert.deepEqual(portal.records[0].snapshot.items, store.snapshot.items);
    const accountsPortal = await repo.portal(accounts, "Accounts");
    assert.equal(accountsPortal.records.length, 2);
    assert.equal(accountsPortal.records[0].division.phases.length, 6);
    await assert.rejects(repo.portal(coord, "Inventory"), /Inventory access/);
    await assert.rejects(repo.portal(inventory, "Accounts"), /Accounts access/);
    const input = {
      id: store.id,
      version: 0,
      stage: "Preparing stock" as const,
      notes: "Preparation started",
      requestKey: randomUUID(),
    };
    await assert.rejects(
      repo.checkpoint(accounts, "Inventory", input),
      /Inventory access/,
    );
    await assert.rejects(
      repo.checkpoint(inventory, "Inventory", {
        ...input,
        stage: "Dispatched",
      }),
      /preceding/,
    );
    const [a, b] = await Promise.all([
      repo.checkpoint(inventory, "Inventory", input),
      repo.checkpoint(inventory, "Inventory", input),
    ]);
    assert.equal(a.id, b.id);
    await assert.rejects(
      repo.checkpoint(inventory, "Inventory", {
        ...input,
        notes: "Changed retry",
      }),
      /Request key/,
    );
    await assert.rejects(
      repo.checkpoint(inventory, "Inventory", {
        ...input,
        requestKey: randomUUID(),
      }),
      /changed/,
    );
    await repo.checkpoint(inventory, "Inventory", {
      ...input,
      version: 1,
      stage: "Ready for dispatch",
      requestKey: randomUUID(),
    });
    await repo.checkpoint(inventory, "Inventory", {
      ...input,
      version: 2,
      stage: "Dispatched",
      notes: "Delivery order TEST-DO-001",
      requestKey: randomUUID(),
    });
    await assert.rejects(
      repo.checkpoint(inventory, "Inventory", {
        ...input,
        version: 3,
        requestKey: randomUUID(),
      }),
      /preceding/,
    );
    assert.equal(
      (await repo.history(inventory, "Inventory", store.id)).length,
      3,
    );
    await repo.checkpoint(accounts, "Accounts", {
      ...input,
      id: source.ipoId,
      stage: "Awaiting documents",
      notes: "Signed DO and installation report pending",
      requestKey: randomUUID(),
    });
    assert.equal(
      (await repo.portal(accounts, "Accounts")).records.find(
        (r: any) => r.id === source.ipoId,
      ).stage,
      "Awaiting documents",
    );
    await assert.rejects(
      db.pool.query("UPDATE department_checkpoints SET notes=$1 WHERE id=$2", [
        "tampered",
        a.id,
      ]),
      /immutable/i,
    );
    await assert.rejects(
      db.pool.query("DELETE FROM department_checkpoints WHERE id=$1", [a.id]),
      /immutable/i,
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT id,snapshot FROM internal_purchase_orders ORDER BY id",
        )
      ).rows,
      before,
    );
    assert.deepEqual(
      (await ops.storeIssuance(store.id)).snapshot,
      store.snapshot,
    );
    const config = readConfig({
      NODE_ENV: "test",
      DATABASE_URL: db.url,
      APP_ORIGIN: "http://localhost:3000",
      SESSION_SECRET: "department-test-session-secret-long-enough",
      ADMIN_SETUP_TOKEN: "department-test-setup-key-long-enough",
    });
    const app = createApp(db.pool, config),
      agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .set("Origin", config.origin)
      .send({ email: `${inventory}@example.test`, password });
    assert.equal(login.status, 200);
    assert.equal((await agent.get("/api/departments/Inventory")).status, 200);
    assert.equal((await agent.get("/api/departments/Accounts")).status, 403);
    assert.equal(
      (
        await agent
          .post("/api/departments/Inventory/checkpoints")
          .set("Origin", config.origin)
          .send(input)
      ).status,
      403,
    );
    for (const route of [
      "/api/boqs",
      "/api/commercial",
      "/api/orders",
      "/api/coordinator/events",
    ])
      assert.equal(
        (await agent.post(route).set("Origin", config.origin).send({})).status,
        403,
      );
  } finally {
    await db.close();
  }
});
