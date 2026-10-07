import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { testDatabase } from "./database.js";
import { hashPassword } from "../server/auth/crypto.js";
import { migrate } from "../server/db/migrate.js";
const origin = "http://localhost:3000",
  password = "masters-test-passphrase-298",
  setupToken = "masters-test-setup-key-isolated-only";
let db: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>,
  cookie: string,
  csrf: string;
before(async () => {
  db = await testDatabase();
  app = createApp(
    db.pool,
    readConfig({
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      DATABASE_URL: db.url,
      ADMIN_SETUP_TOKEN: setupToken,
    }),
  );
  await request(app)
    .post("/api/auth/setup")
    .set("Origin", origin)
    .send({
      displayName: "Master Admin",
      email: "masters@example.test",
      password,
      setupToken,
    })
    .expect(201);
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "masters@example.test", password })
    .expect(200);
  cookie = login.headers["set-cookie"][0].split(";")[0];
  csrf = login.body.csrfToken;
});
after(async () => {
  await db?.close();
});
function save(kind: string, id: string, version: number, values: unknown) {
  return request(app)
    .post(`/api/masters/${kind}`)
    .set("Origin", origin)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", csrf)
    .send({ id, version, values });
}
test("reviewed import preserves all IDs, names, codes, site zeros, rates, statuses and rules", async () => {
  const source = JSON.parse(
    await readFile("data/reference-masters.json", "utf8"),
  );
  const { body } = await request(app)
    .get("/api/masters")
    .set("Cookie", cookie)
    .expect(200);
  assert.equal(body.customers.length, 286);
  assert.equal(body.sites.length, 4);
  assert.equal(body.brands.length, 25);
  assert.equal(body.rates.length, 33);
  assert.equal(body.rules.length, 21);
  assert.equal(body.inverters.length, 6);
  for (const c of source.customers) {
    const imported = body.customers.find((r: { id: number }) => r.id === c.id);
    assert.equal(imported.name, c.name);
    assert.equal(imported.short_code, c.shortCode);
  }
  assert.equal(body.sites[0].code, "0128");
  for (const r of source.rates) {
    const imported = body.rates.find((v: { key: string }) => v.key === r.key);
    assert.equal(imported.status, r.status);
    assert.equal(imported.unit, r.unit);
    assert.equal(
      imported.rate === null ? null : Number(imported.rate),
      r.rate === null ? null : Number(r.rate),
    );
  }
  for (const r of source.rules)
    assert.equal(
      Number(body.rules.find((v: { key: string }) => v.key === r.key).value),
      Number(r.value),
    );
  assert.equal(body.items.length, 57);
  assert.equal(
    body.items.find((r: { key: string }) => r.key === "DC SPD")
      .approved_specification,
    "DC SPD Type II, 750V, 2P",
  );
  assert.equal(
    body.items.find(
      (r: { key: string }) => r.key === "100A Rotary Changeover with Box",
    ).status,
    "Needs review",
  );
  assert.equal(
    body.items.find((r: { key: string }) => r.key === "Solar PV Modules")
      .status,
    "Need to enter",
  );
  assert.equal(body.imports[0].source_sha256, source.sourceSha256);
});
test("anonymous reads are denied; employee writes and missing CSRF are denied", async () => {
  await request(app).get("/api/masters").expect(401);
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      "employee@example.test",
      "Employee",
      "Employee",
      await hashPassword(password),
    ],
  );
  const e = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "employee@example.test", password })
    .expect(200);
  await request(app)
    .get("/api/masters")
    .set("Cookie", e.headers["set-cookie"][0].split(";")[0])
    .expect(200);
  await request(app)
    .post("/api/masters/rates")
    .set("Origin", origin)
    .set("Cookie", e.headers["set-cookie"][0].split(";")[0])
    .set("X-CSRF-Token", e.body.csrfToken)
    .send({
      id: "Solar PV Modules",
      version: 1,
      values: { rate: "40", status: "Active", notes: "" },
    })
    .expect(403);
  await request(app)
    .post("/api/masters/rates")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({})
    .expect(403);
});
test("customer IDs are stable, duplicate short codes and stale edits are rejected", async () => {
  const row = (await request(app).get("/api/masters").set("Cookie", cookie))
    .body.customers[2];
  const values = {
    name: row.name,
    short_code: row.short_code,
    contact_person: "Test contact",
    phone: "",
    email: "",
    address: "",
    status: "Active",
    notes: "Reviewed",
  };
  await save("customers", "2", 1, values).expect(200);
  await save("customers", "2", 1, {
    ...values,
    name: "stale overwrite",
  }).expect(409);
  await save("customers", "3", 1, { ...values, short_code: "mbl" }).expect(409);
  await save("customers", "new", 0, {
    ...values,
    name: "New customer",
    short_code: "UNIQUE-TEST",
  }).expect(200, { id: "286" });
  assert.equal(
    (await db.pool.query("SELECT name,short_code FROM customers WHERE id=2"))
      .rows[0].name,
    row.name,
  );
});
test("rate/rule revisions append; invalid values, stale concurrent writes and history mutation fail", async () => {
  const rate = { rate: "40.125", status: "Needs Rate", notes: "Reviewed rate" };
  const concurrent = await Promise.all([
    save("rates", "Solar PV Modules", 1, rate),
    save("rates", "Solar PV Modules", 1, { ...rate, rate: "41" }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  const history = await request(app)
    .get("/api/masters/rates/history")
    .query({ key: "Solar PV Modules" })
    .set("Cookie", cookie)
    .expect(200);
  assert.equal(history.body.versions.length, 2);
  assert.equal(Number(history.body.versions[1].rate), 39);
  assert.equal(history.body.versions[1].status, "Active");
  await assert.rejects(
    db.pool.query(
      "UPDATE rate_versions SET rate=1 WHERE key='Solar PV Modules' AND version=1",
    ),
    /immutable/,
  );
  await assert.rejects(
    db.pool.query(
      "DELETE FROM rule_versions WHERE key='engineering-4' AND version=1",
    ),
    /immutable/,
  );
  await save("rates", "Solar PV Modules", 2, { ...rate, rate: "-1" }).expect(
    400,
  );
  await save("rules", "engineering-4", 1, { value: "0", notes: "" }).expect(
    400,
  );
  await save("rules", "engineering-7", 1, { value: "4.5", notes: "" }).expect(
    400,
  );
  await save("rules", "engineering-11", 1, {
    value: "8.25",
    notes: "Reviewed",
  }).expect(200);
  assert.equal(
    Number(
      (
        await db.pool.query(
          "SELECT value FROM rule_versions WHERE key='engineering-11' AND version=1",
        )
      ).rows[0].value,
    ),
    7.5,
  );
});
test("repeat migrations never overwrite edited masters or authentication", async () => {
  await Promise.all([migrate(db.pool), migrate(db.pool)]);
  assert.equal(
    (await db.pool.query("SELECT contact_person FROM customers WHERE id=2"))
      .rows[0].contact_person,
    "Test contact",
  );
  assert.equal(
    (await db.pool.query("SELECT count(*) FROM customers")).rows[0].count,
    "287",
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*) FROM rate_versions WHERE key='Solar PV Modules'",
      )
    ).rows[0].count,
    "2",
  );
  await request(app).get("/api/dashboard").set("Cookie", cookie).expect(200);
});

test("specification editing preserves history and requires text before approval", async () => {
  await save("items", "Solar PV Modules", 1, {
    approved_specification: "",
    status: "Approved",
    notes: "",
  }).expect(400);
  await save("items", "Solar PV Modules", 1, {
    approved_specification: "Owner-approved specification",
    status: "Approved",
    notes: "Reviewed",
  }).expect(200);
  const r = await request(app)
    .get("/api/masters/items/history")
    .query({ key: "Solar PV Modules" })
    .set("Cookie", cookie)
    .expect(200);
  assert.equal(r.body.versions.length, 2);
  assert.equal(r.body.versions[1].specification, null);
  await assert.rejects(
    db.pool.query(
      "UPDATE item_spec_versions SET specification='tampered' WHERE key='Solar PV Modules' AND version=1",
    ),
    /immutable/,
  );
});

test("Coordinator can add customers and edit sites, rates and specifications, while rules and unrelated masters remain restricted", async () => {
  const actor = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
    [
      actor,
      "coordinator-masters@example.test",
      "Coordinator",
      "Coordinator",
      await hashPassword(password),
    ],
  );
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "coordinator-masters@example.test", password })
    .expect(200);
  const sessionCookie = login.headers["set-cookie"][0].split(";")[0];
  const write = (kind: string, id: string, version: number, values: unknown) =>
    request(app)
      .post(`/api/masters/${kind}`)
      .set("Origin", origin)
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", login.body.csrfToken)
      .send({ id, version, values });
  const data = (
    await request(app)
      .get("/api/masters")
      .set("Cookie", sessionCookie)
      .expect(200)
  ).body;
  const customer = {
    name: "Coordinator customer",
    short_code: "COORD-NEW",
    contact_person: "Contact",
    phone: "",
    email: "",
    address: "",
    status: "Active",
    notes: "",
  };
  const created = await write("customers", "new", 0, customer).expect(200);
  await write("customers", "new", 0, customer).expect(409);
  await write("customers", created.body.id, 1, {
    ...customer,
    name: "Not authorised",
  }).expect(403);
  const site = data.sites[0];
  const siteValues = {
    name: "Updated site",
    code: site.code,
    location: "Updated location",
    status: "Active",
  };
  await write("sites", String(site.id), site.version, siteValues).expect(200);
  assert.equal(
    (await db.pool.query("SELECT code FROM sites WHERE id=$1", [site.id]))
      .rows[0].code,
    site.code,
  );
  await write("sites", String(site.id), site.version, siteValues).expect(409);
  const rate = data.rates.find((r: any) => r.key === "Solar PV Modules");
  await write("rates", rate.key, rate.version, {
    rate: "42.5",
    status: "Active",
    notes: "Coordinator reviewed",
  }).expect(200);
  const item = data.items.find((r: any) => r.key === "Solar PV Modules");
  await write("items", item.key, item.version, {
    approved_specification: "Coordinator reviewed specification",
    status: "Approved",
    notes: "",
  }).expect(200);
  await write("rules", "engineering-11", 2, { value: "9", notes: "" }).expect(
    403,
  );
  await write("brands", "1", 1, { status: "Inactive", notes: "" }).expect(403);
  await request(app)
    .post("/api/masters/rates")
    .set("Origin", origin)
    .set("Cookie", sessionCookie)
    .send({
      id: rate.key,
      version: rate.version + 1,
      values: { rate: "43", status: "Active", notes: "" },
    })
    .expect(403);
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*) FROM audit_log WHERE user_id=$1 AND action LIKE 'master.%'",
        [actor],
      )
    ).rows[0].count,
    "4",
  );
  await db.pool.query("UPDATE users SET role='Employee' WHERE id=$1", [actor]);
  await write("rates", rate.key, rate.version + 1, {
    rate: "43",
    status: "Active",
    notes: "",
  }).expect(403);
  const { MastersRepository } = await import("../server/masters/repository.js");
  await assert.rejects(
    new MastersRepository(db.pool).save(
      actor,
      "items",
      item.key,
      item.version + 1,
      { approved_specification: "Denied", status: "Approved", notes: "" },
    ),
    /permission/,
  );
  // Earlier rate and specification versions remain immutable despite Coordinator access.
  await assert.rejects(
    db.pool.query(
      "DELETE FROM rate_versions WHERE key='Solar PV Modules' AND version=1",
    ),
    /immutable/,
  );
});
