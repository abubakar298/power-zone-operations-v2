import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { InventoryRepository } from "../server/inventory/repository.js";
import {
  cableInvoiceAdjustment,
  reconcile,
  validateSubmission,
  type ReportEntry,
  type InventoryLine,
} from "../server/inventory/reconciliation.js";
const entry: ReportEntry = {
  start: "2026-10-01",
  end: "2026-10-02",
  panelCount: "55",
  panelWattage: "645",
  usage: { cable: "13" },
  remarks: "Verified",
  expectedReturns: "",
  receivedReturns: "",
  extra: [],
};
const lines: InventoryLine[] = [
  {
    key: "panels",
    description: "Panels",
    unit: "W",
    approved: "35000",
    brand: "",
    specification: "",
    sellingRate: "44",
    gstRate: "10",
    group: "watt",
  },
  {
    key: "cable",
    description: "AC cable",
    unit: "MTRS",
    approved: "10",
    brand: "",
    specification: "",
    sellingRate: "3220",
    gstRate: "18",
    group: "cable",
  },
];
test("Installed wattage, mixed GST and cable adjustments reconcile without altering approved quantities", () => {
  const r = reconcile(lines, entry);
  assert.equal(r.watts, "35475");
  assert.equal(r.sections[0].net, "20900.00");
  assert.equal(r.sections[0].gst, "2090.00");
  assert.equal(r.sections[1].net, "9660.00");
  assert.equal(r.sections[1].gst, "1738.80");
  assert.equal(r.net, "30560.00");
  assert.deepEqual(cableInvoiceAdjustment(r), {
    net: "9660.00",
    gst: "1738.80",
    gross: "11398.80",
    complete: true,
  });
  assert.equal(
    cableInvoiceAdjustment(
      reconcile(lines, { ...entry, usage: { cable: "5" } }),
    ).net,
    "-16100.00",
  );
  assert.equal(cableInvoiceAdjustment({ net: "999" }).net, null);
  assert.equal(r.gross, "34388.80");
  assert.equal(lines[0].approved, "35000");
  assert.equal(
    reconcile(lines, { ...entry, usage: { cable: "5" } }).sections[1].net,
    "-16100.00",
  );
  assert.equal(reconcile(lines, { ...entry, usage: {} }).complete, false);
  assert.throws(
    () => validateSubmission({ ...entry, start: "2026-02-30" }, lines),
    /valid installation/,
  );
});
test("IRR records enforce departmental roles, stale saves, immutable handoff and protected evidence", async () => {
  const db = await testDatabase();
  try {
    const users: any = {};
    for (const role of [
      "Admin",
      "Inventory",
      "Operations",
      "Accounts",
      "Coordinator",
    ]) {
      const id = randomUUID();
      users[role] = id;
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, id + "@example.test", role, "not-a-login", role],
      );
    }
    await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[users.Inventory,users.Admin]);
    const repo = new InventoryRepository(db.pool),
      jobs = await repo.jobs(users.Inventory);
    const job = jobs.find((j) => j.job_id === "CHP-320");
    assert.ok(job);
    const source = await repo.job(users.Inventory, job.key);
    assert.equal(
      source.lines.some((l) => (l as any).buying_rate_ex_gst !== undefined),
      false,
    );
    const usage = Object.fromEntries(
      source.lines
        .filter((l) => l.group !== "watt")
        .map((l) => [l.key, l.approved]),
    );
    const input = {
      jobKey: job.key,
      version: 0,
      stage: "Draft Reconciliation",
      entry: { ...entry, usage },
      requestKey: randomUUID(),
    };
    await assert.rejects(repo.jobs(users.Coordinator), /access required/);
    await assert.rejects(repo.save(users.Accounts, input), /access required/);
    await assert.rejects(
      repo.save(users.Operations, input),
      /Operations can upload/,
    );
    const saved = await repo.save(users.Inventory, input);
    assert.deepEqual(await repo.save(users.Inventory, input), saved);
    await assert.rejects(
      repo.save(users.Inventory, { ...input, requestKey: randomUUID() }),
      /newer report/,
    );
    await assert.rejects(
      repo.save(users.Inventory, {
        ...input,
        version: 1,
        stage: "Sent to Accounts",
        requestKey: randomUUID(),
      }),
      /Attach/,
    );
    await assert.rejects(
      repo.upload(
        users.Inventory,
        saved.reportId,
        "x.pdf",
        "application/pdf",
        Buffer.from("invalid").toString("base64"),
      ),
      /Upload a PDF/,
    );
    const attachment = await repo.upload(
      users.Inventory,
      saved.reportId,
      "IRR.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4\nreport").toString("base64"),
    );
    assert.equal(
      (await repo.file(users.Accounts, attachment.id)).filename,
      "IRR.pdf",
    );
    await assert.rejects(
      repo.file(users.Coordinator, attachment.id),
      /access required/,
    );
    const sent = await repo.save(users.Inventory, {
      ...input,
      version: 1,
      stage: "Sent to Accounts",
      requestKey: randomUUID(),
    });
    assert.equal(sent.stage, "Sent to Accounts");
    assert.equal(
      (await repo.detail(users.Accounts, saved.reportId)).versions.length,
      2,
    );
    await assert.rejects(
      repo.save(users.Inventory, {
        ...input,
        version: 2,
        requestKey: randomUUID(),
      }),
      /read-only/,
    );
    await assert.rejects(
      repo.upload(
        users.Inventory,
        saved.reportId,
        "x.pdf",
        "application/pdf",
        Buffer.from("%PDF-x").toString("base64"),
      ),
      /read-only/,
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE inventory_report_versions SET stage='Draft Reconciliation' WHERE report_id=$1",
        [saved.reportId],
      ),
    );
  } finally {
    await db.close();
  }
});
