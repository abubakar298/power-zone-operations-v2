import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { apiRateLimit, defaultApiRequestsPerMinute } from "../server/http/api-rate-limit.js";
import { readConfig } from "../server/config.js";

const cookieName = "pz_session";
const sessionA = `${cookieName}=${"a".repeat(43)}`;
const sessionB = `${cookieName}=${"b".repeat(43)}`;

function harness(limit: number) {
  let time = 1_000_000;
  const logged: unknown[] = [];
  const app = express();
  app.use("/api", apiRateLimit({ limit, cookieName, now: () => time, log: (entry) => logged.push(entry) }));
  app.get("/api/health", (_req, res) => { res.json({ status: "ok" }); });
  app.post("/api/email-webhooks/resend", (_req, res) => { res.json({ ok: true }); });
  app.get("/api/{*path}", (_req, res) => { res.json({ ok: true }); });
  return { app, logged, advance: (ms: number) => { time += ms; } };
}

test("a session gets the limit per minute, then 429 with Retry-After, then a fresh minute", async () => {
  const { app, logged, advance } = harness(3);
  for (let i = 0; i < 3; i++)
    assert.equal((await request(app).get("/api/orders/123?x=secret").set("Cookie", sessionA)).status, 200);
  const refused = await request(app).get("/api/orders/123?x=secret").set("Cookie", sessionA);
  assert.equal(refused.status, 429);
  assert.equal(refused.headers["retry-after"], "60");
  assert.match(refused.body.message, /Too many requests/);
  await request(app).get("/api/orders/123").set("Cookie", sessionA);
  // One log line per minute, with the area only: no ids, query values or session.
  assert.deepEqual(logged, [{ event: "request.rate_limited", requestId: undefined, method: "GET", area: "/api/orders", by: "session", limit: 3 }]);
  advance(30_000);
  assert.equal((await request(app).get("/api/orders").set("Cookie", sessionA)).headers["retry-after"], "30");
  advance(30_000);
  assert.equal((await request(app).get("/api/orders").set("Cookie", sessionA)).status, 200);
});

test("colleagues on the same office address are counted separately by session", async () => {
  const { app } = harness(2);
  for (let i = 0; i < 2; i++) await request(app).get("/api/dashboard").set("Cookie", sessionA);
  assert.equal((await request(app).get("/api/dashboard").set("Cookie", sessionA)).status, 429);
  assert.equal((await request(app).get("/api/dashboard").set("Cookie", sessionB)).status, 200);
  // Requests without a session are counted per computer, separately from sessions.
  assert.equal((await request(app).get("/api/auth/status")).status, 200);
  assert.equal((await request(app).get("/api/auth/status").set("Cookie", `${cookieName}=not-a-token`)).status, 200);
  assert.equal((await request(app).get("/api/auth/status")).status, 429);
});

test("the health check and email delivery reports are never limited; 0 switches the limit off", async () => {
  const limited = harness(1);
  for (let i = 0; i < 3; i++) {
    assert.equal((await request(limited.app).get("/api/health")).status, 200);
    assert.equal((await request(limited.app).post("/api/email-webhooks/resend")).status, 200);
  }
  const off = harness(0);
  for (let i = 0; i < 5; i++)
    assert.equal((await request(off.app).get("/api/orders").set("Cookie", sessionA)).status, 200);
});

test("the setting defaults to 600 a minute, is off in tests, and can be set or switched off", () => {
  const base = { APP_ORIGIN: "https://portal.example.test", DATABASE_URL: "postgresql://localhost/x", ADMIN_SETUP_TOKEN: "x".repeat(32) };
  assert.equal(defaultApiRequestsPerMinute, 600);
  assert.equal(readConfig({ ...base, NODE_ENV: "production" }).apiRateLimitPerMinute, 600);
  assert.equal(readConfig({ ...base, NODE_ENV: "development" }).apiRateLimitPerMinute, 600);
  assert.equal(readConfig({ ...base, NODE_ENV: "test" }).apiRateLimitPerMinute, 0);
  assert.equal(readConfig({ ...base, NODE_ENV: "production", API_RATE_LIMIT_PER_MINUTE: "0" }).apiRateLimitPerMinute, 0);
  assert.equal(readConfig({ ...base, NODE_ENV: "production", API_RATE_LIMIT_PER_MINUTE: "900" }).apiRateLimitPerMinute, 900);
  assert.throws(() => readConfig({ ...base, NODE_ENV: "production", API_RATE_LIMIT_PER_MINUTE: "-1" }), /API_RATE_LIMIT_PER_MINUTE/);
});
