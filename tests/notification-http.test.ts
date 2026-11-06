import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID, createHmac } from "node:crypto";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { AuthRepository } from "../server/auth/repository.js";
import { digest } from "../server/auth/crypto.js";
let db: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>;
const id = randomUUID(),
  token = "n".repeat(43),
  csrf = "isolated-csrf-token",
  origin = "http://localhost:3000",
  secret = "whsec_" + Buffer.alloc(32, 4).toString("base64");
before(async () => {
  db = await testDatabase();
  app = createApp(
    db.pool,
    readConfig({
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      DATABASE_URL: db.url,
      ADMIN_SETUP_TOKEN: "notification-isolated-bootstrap-token",
      RESEND_WEBHOOK_SECRET: secret,
    }),
  );
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,'test@example.test','Test','isolated','Coordinator')",
    [id],
  );
  await new AuthRepository(db.pool).createSession(id, digest(token), csrf, 1);
});
after(async () => await db.close());
const auth = (r: request.Test) => r.set("Cookie", `pz_session=${token}`);
test("notification routes require session, CSRF, current role and ownership", async () => {
  await request(app).get("/api/notifications").expect(401);
  await auth(request(app).get("/api/notifications")).expect(200);
  await auth(request(app).post("/api/notifications/read"))
    .set("Origin", origin)
    .send({})
    .expect(403);
  await auth(request(app).post("/api/notifications/read"))
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send({})
    .expect(200);
  await auth(request(app).get("/api/notifications/settings")).expect(403);
  await auth(request(app).post("/api/notifications/settings"))
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send({ email_enabled: true, reminders_enabled: false, reminder_hours: 48 })
    .expect(403);
  await auth(
    request(app).get("/api/notifications/item/" + randomUUID()),
  ).expect(404);
});
test("raw signed webhook accepts once, rejects tampering, and never requires a browser origin", async () => {
  const body = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "provider-fixture" },
    }),
    timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.alloc(32, 4))
    .update(`test-id.${timestamp}.${body}`)
    .digest("base64");
  for (let i = 0; i < 2; i++)
    await request(app)
      .post("/api/email-webhooks/resend")
      .set("Content-Type", "application/json")
      .set("svix-id", "test-id")
      .set("svix-timestamp", timestamp)
      .set("svix-signature", "v1," + signature)
      .send(body)
      .expect(200);
  assert.equal(
    (await db.pool.query("SELECT * FROM notification_webhook_receipts"))
      .rowCount,
    1,
  );
  await request(app)
    .post("/api/email-webhooks/resend")
    .set("Content-Type", "application/json")
    .set("svix-id", "test-id")
    .set("svix-timestamp", timestamp)
    .set("svix-signature", "v1," + signature)
    .send(body + " ")
    .expect(400);
});
