import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { AccountsRepository } from "../server/onboarding/repository.js";
import type { Message } from "../server/email/delivery.js";
const origin = "http://localhost:3000",
  password = "accounts-test-passphrase",
  setupToken = "accounts-isolated-setup-key-123456789";
let db: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>,
  cookie: string,
  csrf: string,
  id: string;
const sent: Message[] = [];
const delivery = {
  configured: true,
  async send(m: Message) {
    sent.push(m);
    return "fake-provider";
  },
};
const key = randomBytes(32).toString("hex");
before(async () => {
  db = await testDatabase();
  app = createApp(
    db.pool,
    readConfig({
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      DATABASE_URL: db.url,
      ADMIN_SETUP_TOKEN: setupToken,
      EMAIL_TOKEN_ENCRYPTION_KEY: key,
    }),
    undefined,
    delivery,
  );
  await request(app)
    .post("/api/auth/setup")
    .set("Origin", origin)
    .send({
      email: "admin@example.test",
      displayName: "Admin",
      password,
      setupToken,
    })
    .expect(201);
  const login = await post("/auth/login", {
    email: "admin@example.test",
    password,
  }).expect(200);
  cookie = login.headers["set-cookie"][0].split(";")[0];
  csrf = login.body.csrfToken;
  id = login.body.user.id;
});
after(async () => {
  await db?.close();
});
function post(path: string, body: object) {
  return request(app)
    .post("/api" + path)
    .set("Origin", origin)
    .send(body);
}
function admin(path: string, body: object) {
  return post(path, body).set("Cookie", cookie).set("X-CSRF-Token", csrf);
}
function token(m: Message) {
  const match = m.text.match(/#(invite|reset|verify)\/([A-Za-z0-9_-]{43})/)!;
  return { purpose: match[1], token: match[2] };
}
async function deliver() {
  await new AccountsRepository(db.pool).deliverOne(delivery, key);
  return token(sent.at(-1)!);
}
test("invitation requires admin, CSRF and current password; encrypted outbox and single-use acceptance", async () => {
  await post("/accounts/invite", {
    email: "employee@example.test",
    role: "Employee",
    password,
  }).expect(401);
  await admin("/accounts/invite", {
    email: "employee@example.test",
    role: "Employee",
    password: "wrong",
  }).expect(403);
  await admin("/accounts/invite", {
    email: "employee@example.test",
    role: "Employee",
    password,
  }).expect(201);
  const row = (await db.pool.query("SELECT * FROM email_outbox")).rows[0];
  assert(!row.encrypted_message.includes("employee@example.test"));
  const t = await deliver();
  await post("/accounts/consume", {
    ...t,
    displayName: "Employee",
    password,
  }).expect(200);
  await post("/accounts/consume", {
    ...t,
    displayName: "Employee",
    password,
  }).expect(400);
  const login = await post("/auth/login", {
    email: "employee@example.test",
    password,
  }).expect(200);
  assert.equal(login.body.user.role, "Employee");
  assert(
    (
      await db.pool.query(
        "SELECT email_verified_at FROM users WHERE email='employee@example.test'",
      )
    ).rows[0].email_verified_at,
  );
  await request(app)
    .get("/api/accounts")
    .set("Cookie", login.headers["set-cookie"][0].split(";")[0])
    .expect(403);
});
test("expired/revoked links cannot create an account and last administrator is protected", async () => {
  await admin("/accounts/invite", {
    email: "expired@example.test",
    role: "Employee",
    password,
  }).expect(201);
  const t = await deliver();
  await db.pool.query(
    "UPDATE account_tokens SET expires_at=now()-interval '1 minute' WHERE email='expired@example.test'",
  );
  await post("/accounts/consume", {
    ...t,
    password,
    displayName: "Expired",
  }).expect(400);
  await admin(`/accounts/users/${id}`, { active: false, password }).expect(409);
  await admin(`/accounts/users/${id}`, { role: "Employee", password }).expect(
    409,
  );
});
test("password reset is single-use, has uniform responses and ends existing sessions; disable ends access", async () => {
  const employee = await post("/auth/login", {
    email: "employee@example.test",
    password,
  }).expect(200);
  const ec = employee.headers["set-cookie"][0].split(";")[0];
  const exists = await post("/accounts/recover", {
    email: "employee@example.test",
  }).expect(200);
  const absent = await post("/accounts/recover", {
    email: "unknown@example.test",
  }).expect(200);
  assert.deepEqual(exists.body, absent.body);
  const t = await deliver();
  const next = "new-isolated-passphrase-123";
  await post("/accounts/consume", { ...t, password: next }).expect(200);
  await request(app).get("/api/dashboard").set("Cookie", ec).expect(401);
  await post("/accounts/consume", { ...t, password: next }).expect(400);
  await post("/auth/login", {
    email: "employee@example.test",
    password,
  }).expect(401);
  const login = await post("/auth/login", {
    email: "employee@example.test",
    password: next,
  }).expect(200);
  await admin(`/accounts/users/${login.body.user.id}`, {
    active: false,
    password,
  }).expect(200);
  await request(app)
    .get("/api/dashboard")
    .set("Cookie", login.headers["set-cookie"][0].split(";")[0])
    .expect(401);
  await post("/auth/login", {
    email: "employee@example.test",
    password: next,
  }).expect(401);
});
test("email not configured blocks sending without exposing tokens or creating accounts", async () => {
  const disabled = createApp(
    db.pool,
    readConfig({
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      DATABASE_URL: db.url,
      ADMIN_SETUP_TOKEN: setupToken,
    }),
  );
  await request(disabled)
    .post("/api/accounts/invite")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", csrf)
    .send({ email: "blocked@example.test", role: "Employee", password })
    .expect(503);
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*) FROM users WHERE email='blocked@example.test'",
      )
    ).rows[0].count,
    "0",
  );
});
