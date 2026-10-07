import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { hashPassword, digest } from "../server/auth/crypto.js";

test("backup device credentials are hashed, scoped, expiring and revocable", async () => {
  const db = await testDatabase();
  try {
    const origin = "http://localhost:3000",
      password = "backup-device-admin-298",
      id = randomUUID();
    await db.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,'admin@example.test','Admin',$2,'Admin')",
      [id, await hashPassword(password)],
    );
    const app = createApp(
      db.pool,
      readConfig({
        NODE_ENV: "test",
        APP_ORIGIN: origin,
        DATABASE_URL: db.url,
        ADMIN_SETUP_TOKEN: "isolated-device-setup-token-123456789",
      }),
    );
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "admin@example.test", password })
      .expect(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0],
      csrf = login.body.csrfToken;
    const enroll = (body: Record<string, string>) =>
      request(app)
        .post("/api/backups/devices")
        .set("Origin", origin)
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrf)
        .send(body);
    await request(app)
      .post("/api/backups/devices")
      .set("Origin", origin)
      .send({ password, label: "Mac" })
      .expect(401);
    await enroll({ password: "wrong", label: "Mac" }).expect(403);
    const device = (await enroll({ password, label: "Mac" }).expect(201)).body;
    assert.equal(
      (
        await db.pool.query(
          "SELECT token_hash FROM backup_devices WHERE id=$1",
          [device.id],
        )
      ).rows[0].token_hash,
      digest(device.token),
    );
    await request(app)
      .get("/api/dashboard")
      .set("Authorization", "Bearer " + device.token)
      .expect(401);
    const download = () =>
      request(app)
        .post("/api/backups/device/download")
        .set("Origin", origin)
        .set("Authorization", "Bearer " + device.token)
        .send({ passphrase: "device-backup-passphrase-298" });
    await download()
      .expect(200)
      .expect("Content-Type", /octet-stream/);
    await db.pool.query(
      "UPDATE backup_devices SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [device.id],
    );
    await download().expect(401);
    await db.pool.query(
      "UPDATE backup_devices SET expires_at=now()+interval '1 year' WHERE id=$1",
      [device.id],
    );
    await request(app)
      .post(`/api/backups/devices/${device.id}/revoke`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({})
      .expect(200);
    await download().expect(401);
    await db.pool.query(
      "UPDATE backup_devices SET revoked_at=NULL WHERE id=$1",
      [device.id],
    );
    await db.pool.query("UPDATE users SET role='Management' WHERE id=$1", [id]);
    await download().expect(401);
  } finally {
    await db.close();
  }
});
