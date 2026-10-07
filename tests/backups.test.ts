import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { hashPassword } from "../server/auth/crypto.js";
import { decodeBackup, restoreBackup } from "../server/backups/archive.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
test("Admin encrypted backup restores all business records and upload bytes to an empty database, blocks other roles and tampering", async () => {
  const db = await testDatabase(),
    directory = await mkdtemp(join(tmpdir(), "pz-restore-test-"));
  let restored: pg.Pool | undefined;
  try {
    const admin = randomUUID(),
      coord = randomUUID(),
      password = "backup-test-admin-pass-298",
      phrase = "separate-backup-passphrase-298",
      origin = "http://localhost:3000";
    for (const [id, role] of [
      [admin, "Admin"],
      [coord, "Coordinator"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          role.toLowerCase() + "@example.test",
          role,
          role,
          await hashPassword(password),
        ],
      );
    await db.pool.query("UPDATE admin_bootstrap SET completed_at=now()");
    await createDashboardSamples(db.pool, coord, admin);
    const upload = randomUUID(),
      bytes = Buffer.from("%PDF-1.4\nprivate survey source");
    await db.pool.query(
      "INSERT INTO survey_uploads(id,owner_id,filename,mime,size,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        upload,
        coord,
        "survey.pdf",
        "application/pdf",
        bytes.length,
        "fixture-hash",
        bytes,
      ],
    );
    const config = readConfig({
        NODE_ENV: "test",
        APP_ORIGIN: origin,
        DATABASE_URL: db.url,
        ADMIN_SETUP_TOKEN: "isolated-backup-setup-key-123456789",
      }),
      app = createApp(db.pool, config);
    async function login(email: string) {
      const r = await request(app)
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email, password })
        .expect(200);
      return {
        cookie: r.headers["set-cookie"][0].split(";")[0],
        csrf: r.body.csrfToken,
      };
    }
    const a = await login("admin@example.test"),
      c = await login("coordinator@example.test");
    const body = {
      password,
      passphrase: phrase,
      passphraseConfirmation: phrase,
    };
    await request(app)
      .post("/api/backups/download")
      .set("Origin", origin)
      .send(body)
      .expect(401);
    await request(app)
      .post("/api/backups/download")
      .set("Origin", origin)
      .set("Cookie", c.cookie)
      .set("X-CSRF-Token", c.csrf)
      .send(body)
      .expect(403);
    await request(app)
      .post("/api/backups/download")
      .set("Origin", origin)
      .set("Cookie", a.cookie)
      .send(body)
      .expect(403);
    await request(app)
      .post("/api/backups/download")
      .set("Origin", origin)
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ ...body, password: "wrong" })
      .expect(403);
    const before = await db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const counts: Record<string, string> = {};
    for (const { tablename } of before.rows)
      counts[tablename] = (
        await db.pool.query(
          `SELECT count(*)::text AS count FROM "${tablename}"`,
        )
      ).rows[0].count;
    const response = await request(app)
      .post("/api/backups/download")
      .set("Origin", origin)
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send(body)
      .expect(200);
    assert.match(response.headers["content-disposition"], /\.pzb/);
    assert.ok(Buffer.isBuffer(response.body));
    assert.ok(!response.body.includes(Buffer.from("private survey source")));
    const path = join(directory, "database.pzb");
    await writeFile(path, response.body);
    await assert.rejects(decodeBackup(path, "wrong-backup-passphrase"));
    const corrupted = Buffer.from(response.body);
    corrupted[50] ^= 1;
    const damaged = join(directory, "damaged.pzb");
    await writeFile(damaged, corrupted);
    await assert.rejects(decodeBackup(damaged, phrase));
    await assert.rejects(
      restoreBackup(db.pool, path, phrase),
      /separate empty database/,
    );
    await db.pool.query("CREATE DATABASE backup_recovery_test");
    const url = new URL(db.url);
    url.pathname = "/backup_recovery_test";
    restored = new pg.Pool({ connectionString: url.toString(), max: 3 });
    const result = await restoreBackup(restored, path, phrase);
    assert.equal(result.tables, before.rowCount);
    for (const { tablename } of before.rows) {
      if (
        [
          "auth_sessions",
          "auth_rate_limits",
          "account_tokens",
          "email_outbox",
        ].includes(tablename)
      ) {
        assert.equal(
          (await restored.query(`SELECT count(*) FROM "${tablename}"`)).rows[0]
            .count,
          "0",
        );
        continue;
      }
      assert.equal(
        (await restored.query(`SELECT count(*) FROM "${tablename}"`)).rows[0]
          .count,
        counts[tablename],
        tablename,
      );
    }
    assert.deepEqual(
      (
        await restored.query("SELECT content FROM survey_uploads WHERE id=$1", [
          upload,
        ])
      ).rows[0].content,
      bytes,
    );
    const original = (
      await db.pool.query(
        "SELECT id,snapshot FROM internal_purchase_orders ORDER BY id",
      )
    ).rows;
    assert.deepEqual(
      (
        await restored.query(
          "SELECT id,snapshot FROM internal_purchase_orders ORDER BY id",
        )
      ).rows,
      original,
    );
    const recoveredApp = createApp(restored, {
      ...config,
      databaseUrl: url.toString(),
    });
    const recoveredLogin = await request(recoveredApp)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "admin@example.test", password })
      .expect(200);
    assert.equal(recoveredLogin.body.user.role, "Admin");
    await request(recoveredApp)
      .get("/api/auth/session")
      .set("Cookie", a.cookie)
      .expect(401);
    const next = (
      await restored.query(
        "INSERT INTO audit_log(action) VALUES('restore.test') RETURNING id",
      )
    ).rows[0].id;
    assert.ok(BigInt(next) > 0n);
    assert.equal(
      (
        await request(app)
          .get("/api/backups")
          .set("Cookie", a.cookie)
          .expect(200)
      ).body.downloads.length,
      1,
    );
  } finally {
    await restored?.end();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
