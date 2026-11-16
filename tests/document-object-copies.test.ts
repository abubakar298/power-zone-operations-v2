import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import type { ObjectStore } from "../server/documents/r2-store.js";
import { copyPending, newUploadCopier, pendingSummary } from "../server/documents/object-copies.js";

class FakeStore implements ObjectStore {
  objects = new Map<string, { body: Buffer; type: string }>();
  failPuts = false;
  corrupt = false;
  async put(key: string, body: Buffer, type: string) {
    if (this.failPuts) throw new Error("R2 upload failed with status 503");
    if (this.objects.has(key)) return "exists" as const;
    this.objects.set(key, { body: this.corrupt ? Buffer.from("bad") : Buffer.from(body), type });
    return "created" as const;
  }
  async get(key: string) {
    return this.objects.get(key)?.body;
  }
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

test("stored files are copied to R2, checked, recorded once, and the database copy is untouched", async () => {
  const db = await testDatabase();
  try {
    // Migrations already seed the UBL source workbooks; count relative to them.
    const seeded = (await pendingSummary(db.pool)).reduce((n, r) => n + r.files, 0);
    const user = randomUUID();
    await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'r2@example.test','R2 Test','Admin','x')", [user]);
    const photo = Buffer.from("site survey photo"), po = Buffer.from("%PDF customer po"), old = Buffer.from("old survey pdf");
    const photoId = randomUUID(), poId = randomUUID(), oldId = randomUUID();
    await db.pool.query("INSERT INTO survey_uploads(id,owner_id,filename,mime,size,sha256,content,created_at) VALUES($1,$2,'Photo.JPG','image/jpeg',$3,$4,$5,'2026-11-16T09:00:00Z')", [photoId, user, photo.length, sha(photo), photo]);
    await db.pool.query("INSERT INTO survey_uploads(id,owner_id,filename,mime,size,sha256,content,created_at) VALUES($1,$2,'Old.pdf','application/pdf',$3,$4,$5,now()-interval '30 days')", [oldId, user, old.length, sha(old), old]);
    await db.pool.query("INSERT INTO customer_po_documents(id,owner_id,filename,mime,sha256,content) VALUES($1,$2,'PO.pdf','application/pdf',$3,$4)", [poId, user, sha(po), po]);
    await db.pool.query("INSERT INTO ubl_workflow_sources(sha256,filename,content,records) VALUES($1,'Sites.xlsx',$2,'[]')", [sha(Buffer.from("xlsx")), Buffer.from("xlsx")]);

    const before = await pendingSummary(db.pool);
    assert.equal(before.reduce((n, r) => n + r.files, 0), seeded + 4);

    // Dry-run style summary changed nothing; the new-upload copier only takes the last 7 days.
    const store = new FakeStore(), lines: Record<string, unknown>[] = [];
    const recent = await copyPending(db.pool, store, { limit: 50, recentDays: 7, log: (l) => lines.push(l) });
    assert.ok(recent.copied >= 3);
    // Rows without an upload date (UBL source workbooks) wait for the backfill script.
    assert.ok(![...store.objects.keys()].some((k) => k.startsWith("ubl/source-documents/")));
    assert.deepEqual(recent.failed, []);
    assert.equal(store.objects.get(`survey-uploads/2026/11/${photoId}.jpg`)?.type, "image/jpeg");
    assert.ok([...store.objects.keys()].some((k) => k.startsWith("customer-po/") && k.endsWith(`/${poId}.pdf`)));
    assert.ok([...store.objects.keys()].some((k) => k.startsWith("ubl/workflow-sources/") && k.endsWith(".xlsx")));
    assert.ok(![...store.objects.keys()].some((k) => k.includes(oldId)));
    assert.ok(lines.every((l) => l.event === "document_storage.copied"));

    // The backfill (no date limit) copies the older file; a second run copies nothing.
    assert.ok((await copyPending(db.pool, store, { limit: 50 })).copied >= 1);
    assert.ok([...store.objects.keys()].some((k) => k.endsWith(`/${oldId}.pdf`)));
    assert.ok([...store.objects.keys()].some((k) => k.startsWith("ubl/source-documents/")));
    assert.equal((await copyPending(db.pool, store, { limit: 50 })).copied, 0);
    const copies = (await db.pool.query("SELECT source_table,source_column,source_id,object_key,sha256,size FROM document_object_copies ORDER BY object_key")).rows;
    assert.equal(copies.length, seeded + 4);
    assert.equal(store.objects.size, seeded + 4);
    const photoCopy = copies.find((c) => c.source_id === photoId);
    assert.deepEqual({ ...photoCopy, size: Number(photoCopy.size) }, {
      source_table: "survey_uploads", source_column: "content", source_id: photoId,
      object_key: `survey-uploads/2026/11/${photoId}.jpg`, sha256: sha(photo), size: photo.length,
    });
    assert.equal((await pendingSummary(db.pool)).reduce((n, r) => n + r.files, 0), 0);

    // Database files are unchanged.
    const kept = (await db.pool.query("SELECT content FROM survey_uploads WHERE id=$1", [photoId])).rows[0].content;
    assert.deepEqual(kept, photo);
  } finally {
    await db.close();
  }
});

test("a failed or mismatched copy is never recorded, and the background copier waits before retrying", async () => {
  const db = await testDatabase();
  try {
    await copyPending(db.pool, new FakeStore(), { limit: 50 }); // seeded UBL workbooks out of the way
    const user = randomUUID(), id = randomUUID(), file = Buffer.from("qc evidence");
    await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'r2b@example.test','R2 Test','Admin','x')", [user]);
    await db.pool.query("INSERT INTO survey_uploads(id,owner_id,filename,mime,size,sha256,content) VALUES($1,$2,'a.pdf','application/pdf',$3,$4,$5)", [id, user, file.length, sha(file), file]);
    const count = async () => Number((await db.pool.query("SELECT count(*) FROM document_object_copies WHERE source_id=$1", [id])).rows[0].count);

    const corrupt = new FakeStore();
    corrupt.corrupt = true;
    const bad = await copyPending(db.pool, corrupt, { limit: 5 });
    assert.equal(bad.copied, 0);
    assert.equal(bad.failed[0]?.reason, "R2 copy does not match the database file");
    assert.equal(await count(), 0);

    const store = new FakeStore();
    store.failPuts = true;
    let clock = 1_000_000;
    const lines: Record<string, unknown>[] = [];
    const tick = newUploadCopier(db.pool, store, (l) => lines.push(l), () => clock);
    assert.equal((await tick())?.failed.length, 1);
    assert.equal(lines.at(-1)?.event, "document_storage.copy_failed");
    assert.equal(lines.at(-1)?.reason, "R2 upload failed with status 503");
    store.failPuts = false;
    // Still inside the 1-minute wait: the file is skipped.
    clock += 30_000;
    assert.equal((await tick())?.copied, 0);
    clock += 31_000;
    assert.equal((await tick())?.copied, 1);
    assert.equal(await count(), 1);
  } finally {
    await db.close();
  }
});
