import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { CoordinatorRepository } from "../server/coordinator/repository.js";
import { hashPassword } from "../server/auth/crypto.js";

test("training batch creates 20 usable staged records atomically and is idempotent", async () => {
  const db = await testDatabase();
  try {
    const owner = randomUUID(),
      reviewer = randomUUID();
    const password = await hashPassword("isolated-sample-test-only-123");
    for (const [id, role] of [
      [owner, "Coordinator"],
      [reviewer, "Admin"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, `${id}@example.test`, role, password, role],
      );
    const records = await createDashboardSamples(db.pool, owner, reviewer);
    assert.equal(records.length, 20);
    const view = await new CoordinatorRepository(db.pool).overview(
      owner,
      false,
    );
    assert.equal(view.total, 20);
    assert.equal(Object.keys(view.stageCounts).length, 10);
    assert.ok(Object.values(view.stageCounts).every((count) => count === 2));
    assert.ok(view.tasks.every((task: any) => task.site.startsWith("SAMPLE")));
    assert.ok(
      view.tasks.some(
        (task: any) =>
          Date.now() - new Date(task.started_at).getTime() > 86400000,
      ),
    );
    const before = (
      await db.pool.query(
        "SELECT id,snapshot FROM quotation_versions ORDER BY id",
      )
    ).rows;
    assert.deepEqual(
      await createDashboardSamples(db.pool, owner, reviewer),
      records,
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT id,snapshot FROM quotation_versions ORDER BY id",
        )
      ).rows,
      before,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM customers WHERE short_code LIKE 'SMPAT%'",
        )
      ).rows[0].n,
      20,
    );
    const ipo = records.find((record: any) => record.ipoId);
    await assert.rejects(
      db.pool.query(
        "UPDATE internal_purchase_orders SET snapshot='{}' WHERE id=$1",
        [ipo.ipoId],
      ),
      /immutable/i,
    );
  } finally {
    await db.close();
  }
});
