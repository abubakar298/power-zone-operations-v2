import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { InventoryRepository } from "../server/inventory/repository.js";
import {
  AccountsRepository,
  financialSummary,
  phases,
  epcNames,
} from "../server/accounts/repository.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { UblRepository } from "../server/ubl/repository.js";
import { OrdersRepository } from "../server/orders/repository.js";
test("Markup is calculated on cost, with missing actuals distinct from zero", () => {
  const s = financialSummary("1200", "1000", "1100");
  assert.equal(s.budgetedMarkup, "200.00");
  assert.equal(s.budgetedMarkupPercent, "20.00");
  assert.equal(s.actualMarkup, "100.00");
  assert.equal(s.actualMarkupPercent, "9.09");
  assert.equal(financialSummary("1200", "1000", null).actual, null);
  assert.equal(financialSummary("1200", "1000", "0").actualMarkupPercent, null);
});
test("Accounts closure freezes budgets and evidence, enforces Management approval, returns and immutable history", async () => {
  const db = await testDatabase();
  try {
    const users: Record<string, string> = {};
    for (const role of [
      "Admin",
      "Management",
      "Accounts",
      "Inventory",
      "Coordinator",
    ]) {
      const id = randomUUID();
      users[role] = id;
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, id + "@example.test", role, "not-a-login", role],
      );
    }
    const inv = new InventoryRepository(db.pool),
      repo = new AccountsRepository(db.pool);
    const j = (await inv.jobs(users.Inventory)).find(
      (j) => j.job_id === "CHP-320",
    )!;
    const source = await inv.job(users.Inventory, j.key);
    const entry = {
      start: "2026-10-01",
      end: "2026-10-02",
      panelCount: "55",
      panelWattage: "645",
      usage: Object.fromEntries(
        source.lines
          .filter((l) => l.group !== "watt")
          .map((l) => [l.key, l.approved]),
      ),
      remarks: "isolated fixture",
      expectedReturns: "",
      receivedReturns: "",
      extra: [],
    };
    await assert.rejects(repo.job(users.Accounts, j.key), /not been received/);
    const draft = await inv.save(users.Inventory, {
      jobKey: j.key,
      version: 0,
      stage: "Draft Reconciliation",
      entry,
      requestKey: randomUUID(),
    });
    await inv.upload(
      users.Inventory,
      draft.reportId,
      "fixture.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4 fixture").toString("base64"),
    );
    await inv.save(users.Inventory, {
      jobKey: j.key,
      version: 1,
      stage: "Sent to Accounts",
      entry,
      requestKey: randomUUID(),
    });
    await assert.rejects(repo.job(users.Inventory, j.key), /Accounts access/);
    const job = await repo.job(users.Accounts, j.key);
    assert.deepEqual(job.configurationComparison, {
      closedJobs: 0,
      averageActualMarkupPercent: null,
    });
    assert.equal(job.budget.Inverter, "770000.00");
    assert.equal(job.budget.Batteries, "1720000.00");
    const input = {
      jobKey: j.key,
      version: 0,
      stage: "Draft" as const,
      actual: Object.fromEntries(
        phases.slice(0, 5).map((p) => [p, job.budget[p]]),
      ),
      epc: job.epcBudget,
      remarks: "All costs checked against PT",
      acknowledgment: "Signed acknowledgment file reference",
      photos: "Site photos file reference",
      ptReference: "PT fixture reference",
      requestKey: randomUUID(),
    };
    await assert.rejects(
      repo.saveClosure(users.Accounts, {
        ...input,
        epcDetails: true,
        epcAggregate: "1",
        stage: "Awaiting Management",
        requestKey: randomUUID(),
      }),
      /EPC category costs must equal/,
    );
    await assert.rejects(
      repo.saveClosure(users.Accounts, {
        ...input,
        epc: {},
        epcDetails: true,
        epcAggregate: "100",
        stage: "Awaiting Management",
        requestKey: randomUUID(),
      }),
      /Enter every EPC category/,
    );
    const saved = await repo.saveClosure(users.Accounts, input);
    assert.equal((await repo.saveClosure(users.Accounts, input)).id, saved.id);
    await assert.rejects(
      repo.saveClosure(users.Accounts, { ...input, requestKey: randomUUID() }),
      /changed/,
    );
    await assert.rejects(
      repo.saveClosure(users.Accounts, {
        ...input,
        version: 1,
        stage: "Awaiting Management",
        photos: "",
        requestKey: randomUUID(),
      }),
      /Complete actual costs/,
    );
    const submitted = await repo.saveClosure(users.Accounts, {
      ...input,
      version: 1,
      stage: "Awaiting Management",
      requestKey: randomUUID(),
    });
    await assert.rejects(
      repo.decision(users.Accounts, {
        id: submitted.id,
        version: 2,
        decision: "Closed",
        notes: "cannot approve myself",
        requestKey: randomUUID(),
      }),
      /Accounts access/,
    );
    const returned = await repo.decision(users.Management, {
      id: submitted.id,
      version: 2,
      decision: "Returned for Revision",
      notes: "Check PT reference",
      requestKey: randomUUID(),
    });
    assert.equal(returned.version, 3);
    const again = await repo.saveClosure(users.Accounts, {
      ...input,
      version: 3,
      stage: "Awaiting Management",
      requestKey: randomUUID(),
    });
    const closed = await repo.decision(users.Management, {
      id: again.id,
      version: 4,
      decision: "Closed",
      notes: "Costs and evidence reviewed",
      requestKey: randomUUID(),
    });
    assert.equal(closed.stage, "Closed");
    assert.deepEqual(
      (await repo.job(users.Accounts, j.key)).configurationComparison,
      { closedJobs: 0, averageActualMarkupPercent: null },
      "Current job is excluded from its peer comparison",
    );
    const peer = (
      await db.pool.query(
        "SELECT site_id FROM ubl_site_orders WHERE configuration_id=(SELECT configuration_id FROM ubl_site_orders WHERE site_id=$1) AND site_id<>$1 LIMIT 1",
        [j.key.slice(4)],
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,1,'Closed',$4,$5,$6)",
      [
        randomUUID(),
        "ubl:" + peer.site_id,
        closed.report_version_id,
        {
          summary: {
            actual: "100000",
            actualMarkup: "21110",
            actualMarkupPercent: "21.11",
          },
        },
        randomUUID(),
        users.Management,
      ],
    );
    assert.deepEqual(
      (await repo.job(users.Accounts, j.key)).configurationComparison,
      { closedJobs: 1, averageActualMarkupPercent: "21.11" },
    );
    const peer2 = (
      await db.pool.query(
        "SELECT site_id FROM ubl_site_orders WHERE configuration_id=(SELECT configuration_id FROM ubl_site_orders WHERE site_id=$1) AND site_id<>$1 AND site_id<>$2 LIMIT 1",
        [j.key.slice(4), peer.site_id],
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,1,'Closed',$4,$5,$6)",
      [
        randomUUID(),
        "ubl:" + peer2.site_id,
        closed.report_version_id,
        {
          summary: {
            actual: "300000",
            actualMarkup: "150000",
            actualMarkupPercent: "50.00",
          },
        },
        randomUUID(),
        users.Management,
      ],
    );
    assert.deepEqual(
      (await repo.job(users.Accounts, j.key)).configurationComparison,
      { closedJobs: 2, averageActualMarkupPercent: "42.78" },
      "Average is weighted by actual cost, not an average of percentages",
    );

    const portfolio = await new UblRepository(db.pool).closedJobs(
      users.Management,
    );
    assert.equal(portfolio.jobs.length, 3);
    assert.equal(
      portfolio.jobs.find((x: any) => x.id === closed.id)?.actualCost,
      closed.snapshot.summary.actual,
    );
    await assert.rejects(
      repo.returnReport(users.Accounts, {
        id: draft.reportId,
        version: 2,
        notes: "cannot return closed job",
        requestKey: randomUUID(),
      }),
      /Management must/,
    );
    assert.equal(
      closed.snapshot.summary.budget,
      closed.snapshot.summary.actual,
    );
    assert.equal((await repo.job(users.Accounts, j.key)).history.length, 5);
    await assert.rejects(
      repo.saveClosure(users.Accounts, {
        ...input,
        version: 5,
        requestKey: randomUUID(),
      }),
      /read-only/,
    );
    await assert.rejects(
      db.pool.query("DELETE FROM accounts_job_closures WHERE id=$1", [
        closed.id,
      ]),
      /immutable/,
    );
    const j2 = (await inv.jobs(users.Inventory)).find(
      (x) => x.job_id !== "CHP-320",
    )!;
    const src2 = await inv.job(users.Inventory, j2.key);
    const ent2 = {
      ...entry,
      usage: Object.fromEntries(
        src2.lines
          .filter((l) => l.group !== "watt")
          .map((l) => [l.key, l.approved]),
      ),
    };
    const d2 = await inv.save(users.Inventory, {
      jobKey: j2.key,
      version: 0,
      stage: "Draft Reconciliation",
      entry: ent2,
      requestKey: randomUUID(),
    });
    await inv.upload(
      users.Inventory,
      d2.reportId,
      "fixture.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4 fixture").toString("base64"),
    );
    await inv.save(users.Inventory, {
      jobKey: j2.key,
      version: 1,
      stage: "Sent to Accounts",
      entry: ent2,
      requestKey: randomUUID(),
    });
    const aggregateInput = {
      ...input,
      jobKey: j2.key,
      epc: {},
      epcAggregate: "693330",
      requestKey: randomUUID(),
    };
    const aggregateDraft = await repo.saveClosure(
      users.Accounts,
      aggregateInput,
    );
    assert.equal(aggregateDraft.snapshot.actualEpc, "693330.00");
    assert.notEqual(aggregateDraft.snapshot.summary.actual, null);
    assert.equal(aggregateDraft.snapshot.complete, true);
    assert.equal(aggregateDraft.snapshot.epcBreakdownComplete, false);
    await assert.rejects(
      repo.saveClosure(users.Accounts, {
        ...aggregateInput,
        version: 1,
        stage: "Awaiting Management",
        photos: "",
        requestKey: randomUUID(),
      }),
      /Complete actual costs/,
    );
    await assert.rejects(
      repo.saveClosure(users.Accounts, {
        ...aggregateInput,
        epc: job.epcBudget,
        version: 1,
        requestKey: randomUUID(),
      }),
      /must equal/,
    );
    const aggregateSubmitted = await repo.saveClosure(users.Accounts, {
      ...aggregateInput,
      version: 1,
      stage: "Awaiting Management",
      requestKey: randomUUID(),
    });
    assert.equal(aggregateSubmitted.stage, "Awaiting Management");
    await repo.decision(users.Management, {
      id: aggregateSubmitted.id,
      version: 2,
      decision: "Returned for Revision",
      notes: "isolated review",
      requestKey: randomUUID(),
    });
    await repo.returnReport(users.Accounts, {
      id: d2.reportId,
      version: 2,
      notes: "Correct actual quantities",
      requestKey: randomUUID(),
    });
    await assert.rejects(repo.job(users.Accounts, j2.key), /not been received/);
    await inv.save(users.Inventory, {
      jobKey: j2.key,
      version: 3,
      stage: "Draft Reconciliation",
      entry: ent2,
      requestKey: randomUUID(),
    });
    const samples = await createDashboardSamples(
      db.pool,
      users.Coordinator,
      users.Admin,
    );
    const ipo = samples.find((s: any) => s.ipoId)!;
    await new OrdersRepository(db.pool).sendToAccounts(users.Admin, ipo.ipoId);
    const comp = await repo.comparison(users.Accounts, ipo.ipoId);
    assert.equal(comp.reconciles, true);
    const before = JSON.stringify(comp.ipo.snapshot);
    const review = await repo.review(users.Accounts, {
      id: ipo.ipoId,
      version: 0,
      decision: "Verified",
      notes: "Compared accepted quotation and PT",
      requestKey: randomUUID(),
    });
    assert.equal(review.decision, "Verified");
    assert.equal(
      JSON.stringify(
        (await repo.comparison(users.Accounts, ipo.ipoId)).ipo.snapshot,
      ),
      before,
    );
    await assert.rejects(
      repo.review(users.Inventory, {
        id: ipo.ipoId,
        version: 1,
        decision: "Verified",
        notes: "Not authorized",
        requestKey: randomUUID(),
      }),
      /Accounts access/,
    );
    // Sample archival is reversible and new real versions remain monotonic.
    await db.pool.query("INSERT INTO archived_sample_closures SELECT id,'test sample archive',now() FROM accounts_job_closures WHERE job_key=$1",[j.key]);
    await db.pool.query("UPDATE inventory_reports SET job_key='archived-sample:'||job_key||':'||id WHERE job_key=$1",[j.key]);
    assert.equal((await repo.overview(users.Accounts)).closures.some((x:any)=>x.job_key===j.key),false);
    assert.equal((await inv.list(users.Inventory)).some((x:any)=>x.job_key.startsWith('archived-sample:')),false);
    const real=await inv.save(users.Inventory,{jobKey:j.key,version:0,stage:'Draft Reconciliation',entry,requestKey:randomUUID()});
    await inv.upload(users.Inventory,real.reportId,'real-fixture.pdf','application/pdf',Buffer.from('%PDF-1.4 fixture').toString('base64'));
    await inv.save(users.Inventory,{jobKey:j.key,version:1,stage:'Sent to Accounts',entry,requestKey:randomUUID()});
    const resumed=await repo.job(users.Accounts,j.key);
    assert.equal(resumed.history.length,0);
    const newClosure=await repo.saveClosure(users.Accounts,{...input,version:0,stage:'Draft',requestKey:randomUUID()});
    assert.ok(newClosure.version>1);
  } finally {
    await db.close();
  }
});
