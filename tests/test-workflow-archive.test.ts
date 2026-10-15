import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import {
  archiveConfirmedTestWorkflow,
  testArchiveKey,
  completedSampleArchiveKey,
} from "../server/maintenance/archive-test-workflow.js";

test("operator test archive is recoverable, atomic, cutoff guarded and preserves master data and new work on retry", async () => {
  const db = await testDatabase();
  try {
    const user = randomUUID(),
      draft = randomUUID();
    await db.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,'archive@example.test','Sample operator','unused','Coordinator')",
      [user],
    );
    const masters = (
      await db.pool.query(
        "SELECT (SELECT count(*) FROM customers)::int AS customers,(SELECT count(*) FROM sites)::int AS sites,(SELECT count(*) FROM rate_versions)::int AS rates",
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO survey_drafts(id,owner_id,inputs,created_at) VALUES($1,$2,$3,'2026-10-07T06:00:00Z')",
      [draft, user, { siteName: "SAMPLE archive test" }],
    );
    await archiveConfirmedTestWorkflow(db.pool, "wrong-key");
    assert.equal(
      (await db.pool.query("SELECT count(*)::int AS n FROM survey_drafts"))
        .rows[0].n,
      1,
    );
    const newer = randomUUID();
    await db.pool.query(
      "INSERT INTO survey_drafts(id,owner_id,inputs,created_at) VALUES($1,$2,'{}','2026-10-07T07:00:00Z')",
      [newer, user],
    );
    await assert.rejects(
      archiveConfirmedTestWorkflow(db.pool, testArchiveKey),
      /newer/,
    );
    assert.equal(
      (await db.pool.query("SELECT count(*)::int AS n FROM survey_drafts"))
        .rows[0].n,
      2,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM test_workflow_archives",
        )
      ).rows[0].n,
      0,
    );
    await db.pool.query("DELETE FROM survey_drafts WHERE id=$1", [newer]);
    await db.pool.query("CREATE TABLE future_workflow_child(id uuid PRIMARY KEY, draft_id uuid REFERENCES survey_drafts(id))");
    await db.pool.query("INSERT INTO future_workflow_child VALUES($1,$2)", [randomUUID(),draft]);
    await assert.rejects(archiveConfirmedTestWorkflow(db.pool,testArchiveKey), /unapproved dependent table.*contains data/);
    assert.equal((await db.pool.query("SELECT count(*) FROM survey_drafts")).rows[0].count,"1");
    assert.equal((await db.pool.query("SELECT count(*) FROM test_workflow_archives")).rows[0].count,"0");
    await db.pool.query("DELETE FROM future_workflow_child");
    const counts = await archiveConfirmedTestWorkflow(db.pool, testArchiveKey);
    assert.equal(counts.survey_drafts, 1);
    assert.equal(
      (await db.pool.query("SELECT count(*)::int AS n FROM survey_drafts"))
        .rows[0].n,
      0,
    );
    const archive = (
      await db.pool.query("SELECT records FROM test_workflow_archives")
    ).rows[0].records;
    assert.equal(archive.survey_drafts[0].id, draft);
    assert.equal(
      archive.survey_drafts[0].inputs.siteName,
      "SAMPLE archive test",
    );
    await assert.rejects(
      db.pool.query("DELETE FROM test_workflow_archives"),
      /immutable/i,
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT (SELECT count(*) FROM customers)::int AS customers,(SELECT count(*) FROM sites)::int AS sites,(SELECT count(*) FROM rate_versions)::int AS rates",
        )
      ).rows[0],
      masters,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM users WHERE id=$1",
          [user],
        )
      ).rows[0].n,
      1,
    );
    await db.pool.query(
      "INSERT INTO survey_drafts(id,owner_id,inputs,created_at) VALUES($1,$2,'{}','2026-10-07T11:00:00Z')",
      [newer, user],
    );
    await archiveConfirmedTestWorkflow(db.pool, testArchiveKey);
    assert.equal(
      (await db.pool.query("SELECT id FROM survey_drafts")).rows[0].id,
      newer,
    );
    // A separately authorized second batch archives the completed test, without
    // changing the first archive or letting retries erase future work.
    const second = await archiveConfirmedTestWorkflow(db.pool, completedSampleArchiveKey);
    assert.equal(second.survey_drafts, 1);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM test_workflow_archives")).rows[0].n, 2);
    assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM survey_drafts")).rows[0].n, 0);
    const future = randomUUID();
    await db.pool.query("INSERT INTO survey_drafts(id,owner_id,inputs,created_at) VALUES($1,$2,'{}','2026-10-07T12:00:00Z')", [future,user]);
    await archiveConfirmedTestWorkflow(db.pool, completedSampleArchiveKey);
    assert.equal((await db.pool.query("SELECT id FROM survey_drafts")).rows[0].id, future);
    assert.deepEqual((await db.pool.query("SELECT (SELECT count(*) FROM customers)::int AS customers,(SELECT count(*) FROM sites)::int AS sites,(SELECT count(*) FROM rate_versions)::int AS rates")).rows[0],masters);

  } finally {
    await db.close();
  }
});
