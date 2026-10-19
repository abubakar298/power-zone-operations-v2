import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { hashPassword } from "../server/auth/crypto.js";
import { describeOperationsAccess } from "../server/http/operations-access.js";

test("Operations login reaches only its own workspace APIs; other roles are unaffected", async () => {
  const db = await testDatabase();
  try {
    const password = "operations-access-test-password-77";
    const hash = await hashPassword(password);
    const users = { operations: randomUUID(), accounts: randomUUID(), admin: randomUUID() };
    for (const [role, id] of [["Operations", users.operations], ["Accounts", users.accounts], ["Admin", users.admin]])
      await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, role, hash, role]);
    const app = createApp(db.pool, readConfig({ NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "operations-access-setup-token-123456" }));
    const login = async (id: string) => {
      const r = await request(app).post("/api/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: `${id}@example.test`, password });
      assert.equal(r.status, 200, r.text);
      return r.headers["set-cookie"] as unknown as string[];
    };
    const ops = await login(users.operations), acc = await login(users.accounts), adm = await login(users.admin);
    const get = (cookie: string[], path: string) => request(app).get(path).set("Cookie", cookie);

    // Allowed for Operations.
    for (const path of ["/api/site-execution", "/api/site-execution/stock", "/api/site-execution/vendors", "/api/project-workflow/advance-inbox", "/api/notifications", "/api/dashboard", "/api/auth/session"])
      assert.equal((await get(ops, path)).status, 200, `Operations should reach ${path}`);
    // Denied for Operations, even where other code would have let it through.
    for (const path of ["/api/operations/portal", "/api/operations", "/api/director/ups-alerts", "/api/masters", "/api/ubl-workflow", "/api/project-checkpoints", "/api/inventory-reconciliation", "/api/orders", "/api/boqs", "/api/departments/Inventory", "/api/accounts", "/api/accounts-workspace"]) {
      const r = await get(ops, path);
      assert.equal(r.status, 403, `Operations should be refused ${path} (got ${r.status})`);
    }
    // Other roles keep their existing access.
    assert.equal((await get(acc, "/api/accounts-workspace")).status, 200);
    assert.equal((await get(acc, "/api/director/ups-alerts")).status, 200);
    assert.equal((await get(adm, "/api/operations/portal")).status, 200);
    assert.equal((await get(adm, "/api/masters")).status, 200);
    assert.ok(describeOperationsAccess().length >= 5);
  } finally {
    await db.close();
  }
});
