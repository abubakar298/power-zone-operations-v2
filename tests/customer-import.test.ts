import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import {
  customerImportPlan,
  importCustomers,
} from "../server/masters/customer-import.js";
import { exportBackup } from "../server/backups/archive.js";
test("customer import preserves IDs, links, text phones, blank values and Mr. Arshad; ambiguous names are held and a fresh backup is mandatory", async () => {
  const db = await testDatabase();
  try {
    const actor = randomUUID();
    await db.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,'import-admin@example.test','Import Admin','isolated','Admin')",
      [actor],
    );
    const arshad = (
      await db.pool.query(
        "SELECT * FROM customers WHERE name='Mr. Arshad' LIMIT 1",
      )
    ).rows[0];
    if (!arshad)
      await db.pool.query(
        "INSERT INTO customers(id,name,short_code,contact_person,phone,address,status) VALUES(9000,'Mr. Arshad','PRESERVE-ARSHAD','Protected Person','03000000000','Keep address','Active')",
      );
    await db.pool.query(
      "INSERT INTO customers(id,name,short_code,contact_person,phone,email,address,city,province,status) VALUES(9001,'Import Match','IMPORT-MATCH','Existing Contact','03001112222','keep@example.test','Keep address','Old City','Old Province','Active'),(9002,'Potential Match Ltd.','POTENTIAL','','','','','','','Active')",
    );
    await db.pool.query(
      "INSERT INTO sites(id,customer_id,name,code,location,status) VALUES(9001,9001,'Keep linked site','KEEP-LINKED','Keep location','Active')",
    );
    const beforeArshad = (
      await db.pool.query(
        "SELECT * FROM customers WHERE name='Mr. Arshad' ORDER BY id",
      )
    ).rows;
    const blank = {
      contact_person: "",
      phone: "",
      address: "",
      city: "",
      province: "",
    };
    const input = {
      source: "Isolated customer import fixture",
      rows: [
        {
          name: "Import Match",
          ...blank,
          phone: "03009998888",
          city: "New City",
          province: "New Province",
        },
        { name: "New Unique Customer XYZ", ...blank, phone: "00123456789" },
        { name: "Potential Match Ltd", ...blank },
        { name: "Mr. Arshad", ...blank, phone: "OVERWRITE-MUST-NOT-HAPPEN" },
        { name: "Duplicate Source Name", ...blank },
        { name: "Duplicate Source Name", ...blank },
      ],
    };
    const plan = await importCustomers(db.pool, actor, input);
    assert.deepEqual(plan.counts, {
      added: 1,
      updated: 1,
      unchanged: 1,
      needsReview: 3,
    });
    await assert.rejects(
      importCustomers(db.pool, actor, input, plan.fingerprint, true),
      /backup/i,
    );
    assert.equal(
      (await db.pool.query("SELECT phone FROM customers WHERE id=9001")).rows[0]
        .phone,
      "03001112222",
    );
    const archive = await exportBackup(
      db.pool,
      "isolated-customer-backup-passphrase",
    );
    await archive.cleanup();
    await db.pool.query(
      "INSERT INTO audit_log(user_id,action) VALUES($1,'backup.download.prepared')",
      [actor],
    );
    await assert.rejects(
      importCustomers(db.pool, actor, input, "0".repeat(64), true),
      /changed/i,
    );
    const saved: any = await importCustomers(
      db.pool,
      actor,
      input,
      plan.fingerprint,
      true,
    );
    assert.ok(saved.batchId);
    const match = (await db.pool.query("SELECT * FROM customers WHERE id=9001"))
      .rows[0];
    assert.equal(match.phone, "03009998888");
    assert.equal(match.city, "New City");
    assert.equal(match.province, "New Province");
    assert.equal(match.address, "Keep address");
    assert.equal(match.contact_person, "Existing Contact");
    assert.equal(match.email, "keep@example.test");
    assert.equal(
      (await db.pool.query("SELECT customer_id FROM sites WHERE id=9001"))
        .rows[0].customer_id,
      9001,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT phone FROM customers WHERE name='New Unique Customer XYZ'",
        )
      ).rows[0].phone,
      "00123456789",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM customers WHERE name='Duplicate Source Name'",
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT * FROM customers WHERE name='Mr. Arshad' ORDER BY id",
        )
      ).rows,
      beforeArshad,
    );
    const repeat = await importCustomers(db.pool, actor, input);
    assert.equal(repeat.counts.added, 0);
    assert.equal(repeat.counts.updated, 0);
    const omitted = customerImportPlan(
      { source: "omit", rows: [{ name: "New Unique Customer XYZ", ...blank }] },
      [match, ...beforeArshad],
    );
    assert.equal(omitted.protectedCustomers.length, beforeArshad.length);
    await assert.rejects(
      db.pool.query(
        "UPDATE customer_import_batches SET source='changed' WHERE id=$1",
        [saved.batchId],
      ),
      /immutable/i,
    );
    await db.pool.query("UPDATE users SET role='Coordinator' WHERE id=$1", [
      actor,
    ]);
    await assert.rejects(
      importCustomers(db.pool, actor, input),
      /Administrator/i,
    );
  } finally {
    await db.close();
  }
});

test("punctuation duplicates and similar new source names are held before customer creation", () => {
  const blank = {
    contact_person: "",
    phone: "",
    address: "",
    city: "",
    province: "",
  };
  const rows = [
    "Example New Ltd",
    "Example New Ltd.",
    "Distinct Long Company",
    "Distinct Long Compny",
  ].map((name) => ({ name, ...blank }));
  const plan = customerImportPlan({ source: "duplicate test", rows }, []);
  assert.equal(plan.counts.added, 0);
  assert.equal(plan.counts.needsReview, 4);
});
