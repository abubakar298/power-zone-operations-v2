import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { hashPassword } from "../server/auth/crypto.js";

const ORIGIN = "http://127.0.0.1:3000";

test("no sign-out for inactivity: an idle session stays signed in until sign-out or its 12-hour limit", async () => {
  const db = await testDatabase();
  try {
    const id = randomUUID(), password = "idle-test-password-2026";
    await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)", [id, `${id}@example.test`, "Accounts", await hashPassword(password), "Accounts"]);
    const config = readConfig({ NODE_ENV: "test", APP_ORIGIN: ORIGIN, DATABASE_URL: db.url, ADMIN_SETUP_TOKEN: "idle-test-setup-token-123456789012345", PZ_IDLE_MINUTES: "30" });
    assert.equal("idleMinutes" in config, false, "an old PZ_IDLE_MINUTES setting is ignored");
    const app = createApp(db.pool, config);
    const login = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: `${id}@example.test`, password });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"] as unknown as string[];
    const idleFor = (minutes: number) => db.pool.query("UPDATE auth_sessions SET last_activity_at=now() - make_interval(mins => $2) WHERE user_id=$1", [id, minutes]);
    await idleFor(31);
    assert.equal((await request(app).get("/api/auth/session").set("Cookie", cookie)).status, 200, "31 minutes idle: still signed in");
    await idleFor(11 * 60);
    assert.equal((await request(app).get("/api/auth/session").set("Cookie", cookie)).status, 200, "11 hours idle: still signed in");
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM security_events WHERE kind='sign-out.idle'")).rows[0].n, 0);
    await db.pool.query("UPDATE auth_sessions SET expires_at=now() - interval '1 second' WHERE user_id=$1", [id]);
    assert.equal((await request(app).get("/api/auth/session").set("Cookie", cookie)).status, 401, "the 12-hour limit still applies");
  } finally {
    await db.close();
  }
});
