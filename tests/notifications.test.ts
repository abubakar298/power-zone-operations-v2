import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { NotificationsRepository } from "../server/notifications/repository.js";
import { notificationMessage } from "../server/email/templates.js";
let db: Awaited<ReturnType<typeof testDatabase>>, repo: NotificationsRepository;
const designer = {
  id: randomUUID(),
  email: "design@example.test",
  display_name: "Designer",
  role: "Design" as const,
};
const owner = {
  id: randomUUID(),
  email: "coordinator@example.test",
  display_name: "Coordinator",
  role: "Coordinator" as const,
};
const other = { ...owner, id: randomUUID(), email: "other@example.test" };
before(async () => {
  db = await testDatabase();
  repo = new NotificationsRepository(db.pool);
  await db.pool.query(
    "UPDATE notification_settings SET activated_at=now()-interval '200 hours'",
  );
  for (const u of [designer, owner, other])
    await db.pool.query(
      "INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
      [u.id, u.email, u.display_name, u.role, "isolated"],
    );
});
after(async () => await db?.close());
test("actual assignment event: owner-only, idempotent, direct draft target, read isolation and current role authorization", async () => {
  const draft = randomUUID(),
    survey = randomUUID();
  await db.pool.query(
    "INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,$3)",
    [draft, owner.id, { siteName: "Isolated site" }],
  );
  await db.pool.query(
    "INSERT INTO design_surveys(id,owner_id,inputs) VALUES($1,$2,$3)",
    [survey, designer.id, { siteName: "Isolated site" }],
  );
  await db.pool.query(
    `INSERT INTO design_survey_handoffs(id,survey_id,form_version,draft_id,assigned_to,created_by,inputs,created_at) VALUES($1,$2,1,$3,$4,$5,$6,now()-interval '100 hours')`,
    [
      randomUUID(),
      survey,
      draft,
      owner.id,
      designer.id,
      { siteName: "Isolated site" },
    ],
  );
  await repo.sync();
  await repo.sync();
  const rows = await repo.list(owner);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target.draft_id, draft);
  assert.equal(rows[0].actor, "Designer");
  assert.equal((await repo.list(other)).length, 0);
  await repo.read(other, rows[0].id);
  assert.equal((await repo.list(owner))[0].read_at, null);
  await repo.read(owner, rows[0].id);
  assert.ok((await repo.list(owner))[0].read_at);
  assert.equal((await repo.list({ ...owner, role: "Accounts" })).length, 0);
});
test("email opt-out and delivery failure are isolated; accepted delivery uses stable idempotency key", async () => {
  await db.pool.query("UPDATE notification_settings SET email_enabled=true");
  await repo.savePreferences(owner, false);
  await repo.sync();
  assert.equal(
    (await db.pool.query("SELECT * FROM notification_email_queue")).rowCount,
    0,
  );
  await repo.savePreferences(owner, true);
  await repo.sync();
  await repo.deliverOne(
    {
      configured: true,
      send: async () => {
        throw new Error("secret provider body");
      },
    },
    "https://example.test",
  );
  let q = (await db.pool.query("SELECT * FROM notification_email_queue"))
    .rows[0];
  assert.equal(q.attempts, 1);
  assert.equal(q.last_error, "Provider delivery failed");
  await db.pool.query(
    "UPDATE notification_email_queue SET next_attempt_at=now()",
  );
  let key = "";
  await repo.deliverOne(
    {
      configured: true,
      send: async (m, id) => {
        key = id;
        assert.ok(!m.text.includes("cost"));
        return "provider-test";
      },
    },
    "https://example.test",
  );
  q = (await db.pool.query("SELECT * FROM notification_email_queue")).rows[0];
  assert.equal(q.state, "sent");
  assert.equal(key, q.id);
});
test("template escapes references and contains no business snapshot", () => {
  const m = notificationMessage(
    owner.email,
    "Approval required",
    "<script>",
    "Owner",
    "https://example.test/dashboard#notification=123",
  );
  assert.ok(m.html?.includes("&lt;script&gt;"));
  assert.ok(!m.html?.includes("<script>"));
  assert.ok(m.text.includes("Open the document"));
});
test("reminders and escalation are capped, critical preferences cannot suppress security and changed roles cancel queued delivery", async () => {
  const admin = {
    id: randomUUID(),
    email: "manager@example.test",
    display_name: "Management",
    role: "Management" as const,
  };
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
    [admin.id, admin.email, admin.display_name, admin.role, "isolated"],
  );
  await db.pool.query(
    "UPDATE notification_settings SET reminders_enabled=true,reminder_hours=24",
  );
  await repo.sync();
  await repo.sync();
  assert.equal(
    (await db.pool.query("SELECT * FROM notifications WHERE kind='Reminder'"))
      .rowCount,
    1,
  );
  assert.equal(
    (await db.pool.query("SELECT * FROM notifications WHERE kind='Escalation'"))
      .rowCount,
    1,
  );
  assert.equal((await repo.list(admin)).length, 1);
  await db.pool.query("UPDATE users SET role='Accounts' WHERE id=$1", [
    owner.id,
  ]);
  let sent = 0;
  await repo.deliverOne(
    {
      configured: true,
      send: async () => {
        sent++;
        return "blocked";
      },
    },
    "https://example.test",
  );
  assert.equal(sent, 0);
  await db.pool.query("UPDATE users SET role='Coordinator' WHERE id=$1", [
    owner.id,
  ]);
  await repo.savePreferences(owner, false);
  await db.pool.query(
    "INSERT INTO audit_log(user_id,action,target_user_id) VALUES($1,'account.reset.completed',$1)",
    [owner.id],
  );
  await repo.sync();
  const security = (await repo.list(owner)).find((n) => n.kind === "Security");
  assert.ok(security);
  assert.ok(
    (
      await db.pool.query(
        "SELECT 1 FROM notification_email_queue WHERE id=$1",
        [security.id],
      )
    ).rowCount,
  );
});
test("C&I approval resolves Management task and preserves cost privacy", async () => {
  const manager = (
    await db.pool.query("SELECT * FROM users WHERE role='Management' LIMIT 1")
  ).rows[0];
  const customer = 999999,
    p = randomUUID(),
    v = randomUUID();
  await db.pool.query(
    "INSERT INTO customers(id,name,short_code,status) VALUES($1,'Isolated customer','NOTIFYTEST','Active')",
    [customer],
  );
  await db.pool.query(
    "INSERT INTO cni_proposals(id,created_by,customer_id) VALUES($1,$2,$3)",
    [p, owner.id, customer],
  );
  await db.pool.query(
    "INSERT INTO cni_proposal_versions(id,proposal_id,version,number,snapshot,internal_cost_snapshot,created_by) VALUES($1,$2,1,$3,$4,$5,$6)",
    [
      v,
      p,
      "CNI-TEST-1",
      { customer: { name: "Isolated customer" }, siteName: "Site" },
      { cost: "11000000", markup: "confidential" },
      owner.id,
    ],
  );
  await db.pool.query(
    "INSERT INTO cni_proposal_actions(id,version_id,action,created_by) VALUES($1,$2,'Approval requested',$3)",
    [randomUUID(), v, owner.id],
  );
  await repo.sync();
  const approval = (await repo.list(manager)).find((n) => n.target.id === p);
  assert.ok(approval);
  assert.equal(approval.actionable, true);
  assert.ok(!JSON.stringify(approval).includes("11000000"));
  await db.pool.query(
    "INSERT INTO cni_proposal_actions(id,version_id,action,created_by) VALUES($1,$2,'Approved',$3)",
    [randomUUID(), v, manager.id],
  );
  await repo.sync();
  assert.ok(
    (await repo.list(manager)).find((n) => n.id === approval.id).resolved_at,
  );
  assert.ok(
    (await repo.list(owner)).some(
      (n) => n.target.id === p && n.kind === "Approved",
    ),
  );
});
