import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import {jsPDF} from 'jspdf';
import request from 'supertest';
import {digest} from '../server/auth/crypto.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
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
    await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[users.Inventory,users.Admin]);
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
    const ptEntry={sourceKind:'Inventory' as const,sourceId:draft.reportId,sourceVersion:2,ptReference:'PT-IRR-320',entryDate:'2026-10-26',notes:'IRR and approved variable items entered'};
    await assert.rejects(repo.recordPtEntry(users.Inventory,ptEntry),/Accounts access/);
    await assert.rejects(repo.recordPtEntry(users.Accounts,{...ptEntry,sourceVersion:1}),/current Inventory-approved/);
    const ptSaved=await repo.recordPtEntry(users.Accounts,ptEntry);
    assert.equal(ptSaved.entry_date,ptEntry.entryDate,'Creation returns the selected calendar date as text');
    const ptReplay=await repo.recordPtEntry(users.Accounts,ptEntry);
    assert.equal(ptReplay.id,ptSaved.id);assert.equal(ptReplay.entry_date,ptEntry.entryDate,'Replay preserves the same date-only representation');
    const listedPt=(await repo.overview(users.Accounts)).ptEntries.find((row:any)=>row.id===ptSaved.id);
    assert.equal(listedPt.entry_date,ptEntry.entryDate,'Reloaded Recorded rows retain the selected date without UTC conversion');
    await assert.rejects(repo.recordPtEntry(users.Accounts,{...ptEntry,ptReference:'different'}),/already has a PT entry/);
    assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM accounts_pt_entries')).rows[0].count,1);
    await assert.rejects(db.pool.query('UPDATE accounts_pt_entries SET notes=$1 WHERE id=$2',['changed',ptSaved.id]));
    await assert.rejects(repo.job(users.Inventory, j.key), /Accounts access/);
    const job = await repo.job(users.Accounts, j.key);
    assert.equal(job.identity?.customer_code, "UBL");
    assert.equal(job.identity?.configuration_id, "35-30-40");
    assert.ok(job.identity?.branch_code);
    assert.equal(job.phaseSelling["Solar Panels"], "1540000.00");
    assert.equal(job.phaseSelling.EPC, "1018459.68");
    assert.equal(job.selling, "6714576.27");
    assert.equal(Object.keys(job.phaseSelling).length, 6);
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
    await assert.rejects(
      repo.uploadEvidence(
        users.Inventory,
        j.key,
        "pt.png",
        "image/png",
        Buffer.from("not PNG").toString("base64"),
      ),
      /Accounts access/,
    );
    await assert.rejects(
      repo.uploadEvidence(
        users.Accounts,
        j.key,
        "pt.png",
        "image/png",
        Buffer.from("not PNG").toString("base64"),
      ),
      /PNG or JPEG/,
    );
    const pdf=new jsPDF();pdf.text('Local PT report fixture',20,20);
    const pdfBytes=Buffer.from(pdf.output('arraybuffer'));
    const pdfFile=await repo.uploadEvidence(users.Accounts,j.key,'pt-report.pdf','application/pdf',pdfBytes.toString('base64'));
    assert.deepEqual((await repo.evidenceFile(users.Accounts,pdfFile.id)).content,pdfBytes);
    await assert.rejects(repo.evidenceFile(users.Inventory,pdfFile.id),/Accounts access/);
    await assert.rejects(repo.uploadEvidence(users.Accounts,j.key,'invalid.pdf','application/pdf',Buffer.from('not a PDF').toString('base64')),/PDF, PNG or JPEG/);
    const ptFile = await repo.uploadEvidence(
      users.Accounts,
      j.key,
      "pt.png",
      "image/png",
      Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
    );
    const evidenceInput = { ...input, ptAttachmentId: ptFile.id };
    for (const kind of ["Client acknowledgment", "Site photographs"])
      await db.pool.query(
        "INSERT INTO job_closure_evidence(id,job_key,kind,filename,media_type,content,sha256,created_by) VALUES($1,$2,$3,'qc.png','image/png',$4,'fixture',$5)",
        [
          randomUUID(),
          j.key,
          kind,
          Buffer.from("89504e470d0a1a0a", "hex"),
          users.Admin,
        ],
      );
    let submitted = await repo.saveClosure(users.Accounts, {
      ...evidenceInput,
      version: 1,
      stage: "Awaiting Management",
      requestKey: randomUUID(),
    });
    assert.equal(submitted.snapshot.operationsEvidenceSignature,null,'Legacy verified closure evidence remains supported without an invented Operations link.');
    assert.equal(submitted.snapshot.operationsEvidenceSource,null);
    assert.ok(submitted.snapshot.evidence.some((e:any)=>e.kind==='Client acknowledgment'));
    assert.ok(submitted.snapshot.evidence.some((e:any)=>e.kind==='Site photographs'));
    const originalSubmitted=submitted,originalSnapshot=JSON.stringify(submitted.snapshot);
    const amendment={...evidenceInput,version:submitted.version,stage:'Awaiting Management' as const,actual:{...evidenceInput.actual,Inverter:'770100.00'},amendmentReason:'Correct PT inverter cost',requestKey:randomUUID()};
    await assert.rejects(repo.saveClosure(users.Inventory,amendment),/Accounts access/);
    await assert.rejects(repo.saveClosure(users.Accounts,{...amendment,photos:'replacement evidence',requestKey:randomUUID()}),/evidence must remain/);
    submitted=await repo.saveClosure(users.Accounts,amendment);
    assert.equal(submitted.version,originalSubmitted.version+1);assert.equal(submitted.stage,'Awaiting Management');assert.equal(submitted.snapshot.input.actual.Inverter,'770100.00');
    assert.equal((await repo.saveClosure(users.Accounts,amendment)).id,submitted.id);
    assert.equal(JSON.stringify((await db.pool.query('SELECT snapshot FROM accounts_job_closures WHERE id=$1',[originalSubmitted.id])).rows[0].snapshot),originalSnapshot);
    assert.deepEqual(submitted.snapshot.evidence,originalSubmitted.snapshot.evidence);assert.deepEqual(submitted.snapshot.budget,originalSubmitted.snapshot.budget);
    await assert.rejects(repo.saveClosure(users.Accounts,{...amendment,requestKey:randomUUID()}),/changed/);
    await assert.rejects(repo.decision(users.Management,{id:originalSubmitted.id,version:originalSubmitted.version,decision:'Closed',notes:'Stale review',requestKey:randomUUID()}),/current submitted closure/);

    await assert.rejects(
      repo.decision(users.Accounts, {
        id: submitted.id,
        version: submitted.version,
        decision: "Closed",
        notes: "cannot approve myself",
        requestKey: randomUUID(),
      }),
      /Accounts access/,
    );
    const returned = await repo.decision(users.Management, {
      id: submitted.id,
      version: submitted.version,
      decision: "Returned for Revision",
      notes: "Check PT reference",
      requestKey: randomUUID(),
    });
    assert.equal(returned.version, submitted.version+1);
    const again = await repo.saveClosure(users.Accounts, {
      ...evidenceInput,
      version: returned.version,
      stage: "Awaiting Management",
      requestKey: randomUUID(),
    });
    const closed = await repo.decision(users.Management, {
      id: again.id,
      version: again.version,
      decision: "Closed",
      notes: "Costs and evidence reviewed",
      requestKey: randomUUID(),
    });
    assert.equal(closed.stage, "Closed");
    await assert.rejects(repo.saveClosure(users.Accounts,{...amendment,version:closed.version,requestKey:randomUUID()}),/already closed/);
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
          input:{actual:{Inverter:"20000",BMS:"0"}},actualEpc:"30000",
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
          input:{actual:{Inverter:"60000"}},actualEpc:"50000",
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

    const phaseComparison=(await repo.job(users.Management,j.key)).phaseCostComparison;
    assert.deepEqual(phaseComparison.phases.Inverter,{jobs:2,averageActualCost:'40000.00'});
    assert.deepEqual(phaseComparison.phases.BMS,{jobs:1,averageActualCost:'0.00'});
    assert.deepEqual(phaseComparison.phases.EPC,{jobs:2,averageActualCost:'40000.00'});
    assert.deepEqual(phaseComparison.total,{jobs:2,averageActualCost:'200000.00'});
    assert.deepEqual(phaseComparison.phases.Structure,{jobs:0,averageActualCost:null});
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
    assert.equal((await repo.job(users.Accounts, j.key)).history.length, 6);
    await assert.rejects(
      repo.saveClosure(users.Accounts, {
        ...input,
        version: closed.version,
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
    const ptFile2 = await repo.uploadEvidence(
      users.Accounts,
      j2.key,
      "pt2.png",
      "image/png",
      Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
    );
    for (const kind of ["Client acknowledgment", "Site photographs"])
      await db.pool.query(
        "INSERT INTO job_closure_evidence(id,job_key,kind,filename,media_type,content,sha256,created_by) VALUES($1,$2,$3,'qc.png','image/png',$4,'fixture',$5)",
        [
          randomUUID(),
          j2.key,
          kind,
          Buffer.from("89504e470d0a1a0a", "hex"),
          users.Admin,
        ],
      );
    await assert.rejects(repo.saveClosure(users.Accounts,{...aggregateInput,ptAttachmentId:ptFile2.id,version:1,stage:'Awaiting Management',requestKey:randomUUID()}),/Record the current approved IRR/);
    await repo.recordPtEntry(users.Accounts,{...ptEntry,sourceId:d2.reportId,ptReference:'PT-IRR-SECOND'});
    const aggregateSubmitted = await repo.saveClosure(users.Accounts, {
      ...aggregateInput,
      ptAttachmentId: ptFile2.id,
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
    // The connected closure retains exact Operations provenance without copying files.
    const linkedKey='ipo:'+ipo.ipoId,linkedJob=await inv.job(users.Inventory,linkedKey);
    const linkedEntry={...entry,panelCount:'',panelWattage:'',usage:Object.fromEntries(linkedJob.lines.map(l=>[l.key,l.approved]))};
    const linkedDraft=await inv.save(users.Inventory,{jobKey:linkedKey,version:0,stage:'Draft Reconciliation',entry:linkedEntry,requestKey:randomUUID()});
    await inv.upload(users.Inventory,linkedDraft.reportId,'simulation-irr.pdf','application/pdf',Buffer.from('%PDF-1.4 simulation').toString('base64'));
    await inv.save(users.Inventory,{jobKey:linkedKey,version:1,stage:'Sent to Accounts',entry:linkedEntry,requestKey:randomUUID()});
    await repo.recordPtEntry(users.Accounts,{...ptEntry,sourceId:linkedDraft.reportId,ptReference:'SIMULATION-linked-IRR'});
    const boardId='closure-bridge-'+randomUUID(),stamp='2026-10-27';
    await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[boardId,users.Admin]);
    const files=await Promise.all(['acknowledgment','irr','variable','site-photo','corrected-photo'].map(async(name)=>{
      const id=randomUUID(),content=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from(name)]),sha=createHash('sha256').update(content).digest('hex');
      await db.pool.query('INSERT INTO operations_board_files(id,site_id,filename,media_type,sha256,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,boardId,name+'.png','image/png',sha,content,users.Admin]);
      return {id,name:name+'.png',mediaType:'image/png'};
    }));
    const linkedIpo=(await db.pool.query('SELECT snapshot FROM internal_purchase_orders WHERE id=$1',[ipo.ipoId])).rows[0].snapshot;
    const base={id:boardId,ipo:'SIMULATION linked IPO',name:'SIMULATION Accounts closure',stage:'delivered',installation:true,projectType:'solar-bess',operationsTeam:'central',completed:false};
    let boardVersion=0;
    const board=async(snapshot:unknown)=>db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,'qc','SIMULATION closure evidence',$4,$5)",[boardId,++boardVersion,snapshot,randomUUID(),users.Admin]);
    await board(base);
    await db.pool.query('INSERT INTO inventory_material_source_links(id,board_site_id,board_version,ipo_id,boq_revision_id,board_sha256,ipo_sha256,boq_sha256,reason,request_key,request_sha256,created_by) VALUES($1,$2,1,$3,$4,$5,$5,$5,$6,$7,$5,$8)',[randomUUID(),boardId,ipo.ipoId,linkedIpo.boqRevisionId,'a'.repeat(64),'SIMULATION exact source link',randomUUID(),users.Admin]);
    const linkedPt=await repo.uploadEvidence(users.Accounts,linkedKey,'simulation-pt.png','image/png',Buffer.from('89504e470d0a1a0a','hex').toString('base64'));
    const pendingJob=await repo.job(users.Accounts,linkedKey);
    const linkedInput={jobKey:linkedKey,version:0,stage:'Awaiting Management' as const,actual:Object.fromEntries(phases.slice(0,5).map(p=>[p,pendingJob.budget[p]])),epc:{},epcAggregate:pendingJob.budget.EPC,remarks:'SIMULATION exact saved budget actuals',acknowledgment:'',photos:'',ptReference:'SIMULATION PT',ptAttachmentId:linkedPt.id,requestKey:randomUUID()};
    await assert.rejects(repo.saveClosure(users.Accounts,linkedInput),/linked Operations QC handover is incomplete/);
    const final={date:stamp,acknowledgement:files[0],irr:files[1],variableSignoff:files[2]},qc={civil:{date:stamp,evidence:files[3]},electrical:{date:stamp,evidence:files[3]},testing:{date:stamp,evidence:files[3]},signoff:final};
    await board({...base,completed:true,qc});
    const readyJob=await repo.job(users.Accounts,linkedKey);
    assert.ok(readyJob.operationsEvidenceSignature);
    await assert.rejects(repo.saveClosure(users.Accounts,linkedInput),/QC handover evidence changed/,'A linked source signature cannot be omitted to bypass review.');
    const submittedLinked=await repo.saveClosure(users.Accounts,{...linkedInput,operationsEvidenceSignature:readyJob.operationsEvidenceSignature});
    const frozenPhoto=submittedLinked.snapshot.evidence.find((e:any)=>e.source?.purpose==='qc-photo');
    assert.equal(frozenPhoto.source.version,2);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM job_closure_evidence WHERE job_key=$1',[linkedKey])).rows[0].n,1,'Only Accounts PT upload is stored; QC files are references.');
    await assert.rejects(repo.operationsEvidenceFile(users.Inventory,linkedKey,2,files[3].id),/Accounts access/);
    await assert.rejects(repo.operationsEvidenceFile(users.Accounts,j.key,2,files[3].id),/not found/);
    assert.ok((await repo.operationsEvidenceFile(users.Accounts,linkedKey,2,files[3].id)).content.length);
    const mounted=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:'http://127.0.0.1:3219',DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-closure-bridge-test-key'}));
    const cookies:Record<string,string>={};
    for(const role of ['Accounts','Inventory','Admin','Management']){
      const token=randomBytes(32).toString('base64url');
      await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),users[role],randomUUID()]);cookies[role]='pz_session='+token;
    }
    const photoUrl='/api/accounts-workspace/jobs/'+encodeURIComponent(linkedKey)+'/operations-evidence/2/'+files[3].id;
    await request(mounted).get(photoUrl).expect(401);
    await request(mounted).get(photoUrl).set('Cookie',cookies.Inventory).expect(403);
    await request(mounted).get(photoUrl).set('Cookie',cookies.Accounts).expect(200).then(r=>{assert.match(r.headers['content-type'],/image\/png/);assert.match(r.headers['cache-control'],/no-store/);assert.equal(r.headers['x-content-type-options'],'nosniff');assert.match(r.headers['content-security-policy'],/sandbox/);});
    await request(mounted).get('/api/accounts-workspace/jobs/'+encodeURIComponent('ipo:'+randomUUID())+'/operations-evidence/2/'+files[3].id).set('Cookie',cookies.Accounts).expect(404);
    await request(mounted).get('/api/accounts-workspace/jobs/'+encodeURIComponent(linkedKey)+'/operations-evidence/1/'+files[3].id).set('Cookie',cookies.Accounts).expect(404);
    const storedClosure=JSON.stringify((await db.pool.query('SELECT snapshot FROM accounts_job_closures WHERE id=$1',[submittedLinked.id])).rows[0].snapshot);
    for(const role of ['Admin','Management','Accounts']){
      const path='/api/accounts-workspace/job?key='+encodeURIComponent(linkedKey);
      const hidden=(await request(mounted).get(path).set('Cookie',cookies[role]).expect(200)).body;
      for(const phase of ['Inverter','Batteries','BMS']){assert.equal(hidden.budget[phase],null);assert.equal(hidden.history[0].snapshot.input.actual[phase],null);}
      assert.equal(hidden.budget.Structure,readyJob.budget.Structure);assert.equal(hidden.history[0].snapshot.input.actual['Solar Panels'],linkedInput.actual['Solar Panels']);
      assert.equal(hidden.history[0].snapshot.summary.actual,null);assert.equal(hidden.history[0].snapshot.summary.budget,null);assert.equal(hidden.history[0].snapshot.summary.actualMarkupPercent,null);
      if(role!=='Accounts')assert.equal((await request(mounted).get('/api/accounts-workspace/closure-queue').set('Cookie',cookies[role]).expect(200)).body.closures.find((row:any)=>row.job_key===linkedKey).snapshot.summary.actual,null);
      await db.pool.query("INSERT INTO restricted_cost_access(user_id,granted_reason) VALUES($1,'Explicit isolated closure costing test capability')",[users[role]]);
      const visible=(await request(mounted).get(path).set('Cookie',cookies[role]).expect(200)).body;
      assert.equal(visible.budget.Inverter,readyJob.budget.Inverter);assert.equal(visible.history[0].snapshot.input.actual.Inverter,linkedInput.actual.Inverter);assert.equal(visible.history[0].snapshot.summary.actual,submittedLinked.snapshot.summary.actual);
      if(role!=='Accounts')assert.equal((await request(mounted).get('/api/accounts-workspace/closure-queue').set('Cookie',cookies[role]).expect(200)).body.closures.find((row:any)=>row.job_key===linkedKey).snapshot.summary.actual,submittedLinked.snapshot.summary.actual);
    }
    assert.equal(JSON.stringify((await db.pool.query('SELECT snapshot FROM accounts_job_closures WHERE id=$1',[submittedLinked.id])).rows[0].snapshot),storedClosure,'Permission projections never mutate saved costs.');
    await board({...base,completed:true,qc,documents:[{id:'tracking-only',label:'Originals',location:'Submitted to Accounts',date:stamp,evidence:[]}]});
    const returnedLinked=await repo.decision(users.Management,{id:submittedLinked.id,version:1,decision:'Returned for Revision',notes:'SIMULATION review',requestKey:randomUUID()});
    const locationJob=await repo.job(users.Accounts,linkedKey);
    assert.equal(locationJob.operationsEvidenceSignature,readyJob.operationsEvidenceSignature,'Location-only source versions retain the reviewed signature.');
    const resubmittedLinked=await repo.saveClosure(users.Accounts,{...linkedInput,version:returnedLinked.version,operationsEvidenceSignature:locationJob.operationsEvidenceSignature,requestKey:randomUUID()});
    await board({...base,completed:true,qc:{...qc,civil:{date:stamp,evidence:files[4]}}});
    assert.equal((await repo.job(users.Management,linkedKey)).evidence.find((e:any)=>e.source?.purpose==='qc-photo').id,files[3].id,'Submitted display retains frozen files even after correction.');
    await assert.rejects(repo.decision(users.Management,{id:resubmittedLinked.id,version:resubmittedLinked.version,decision:'Closed',notes:'Stale review',requestKey:randomUUID()}),/QC handover evidence changed after submission/);
    assert.ok((await repo.operationsEvidenceFile(users.Accounts,linkedKey,3,files[3].id)).content.length,'Frozen old evidence remains scoped and readable.');
    const correctedReturn=await repo.decision(users.Management,{id:resubmittedLinked.id,version:resubmittedLinked.version,decision:'Returned for Revision',notes:'Review corrected photograph',requestKey:randomUUID()});
    const correctedJob=await repo.job(users.Accounts,linkedKey),correctedClosure=await repo.saveClosure(users.Accounts,{...linkedInput,version:correctedReturn.version,operationsEvidenceSignature:correctedJob.operationsEvidenceSignature,requestKey:randomUUID()});
    const linkedClosed=await repo.decision(users.Management,{id:correctedClosure.id,version:correctedClosure.version,decision:'Closed',notes:'Corrected source reviewed',requestKey:randomUUID()});
    assert.equal(linkedClosed.stage,'Closed');
    // Sample archival is reversible and new real versions remain monotonic.
    await db.pool.query(
      "INSERT INTO archived_sample_closures SELECT id,'test sample archive',now() FROM accounts_job_closures WHERE job_key=$1",
      [j.key],
    );
    await db.pool.query(
      "UPDATE inventory_reports SET job_key='archived-sample:'||job_key||':'||id WHERE job_key=$1",
      [j.key],
    );
    assert.equal(
      (await repo.overview(users.Accounts)).closures.some(
        (x: any) => x.job_key === j.key,
      ),
      false,
    );
    assert.equal(
      (await inv.list(users.Inventory)).some((x: any) =>
        x.job_key.startsWith("archived-sample:"),
      ),
      false,
    );
    const real = await inv.save(users.Inventory, {
      jobKey: j.key,
      version: 0,
      stage: "Draft Reconciliation",
      entry,
      requestKey: randomUUID(),
    });
    await inv.upload(
      users.Inventory,
      real.reportId,
      "real-fixture.pdf",
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
    const resumed = await repo.job(users.Accounts, j.key);
    assert.equal(resumed.history.length, 0);
    const newClosure = await repo.saveClosure(users.Accounts, {
      ...input,
      version: 0,
      stage: "Draft",
      requestKey: randomUUID(),
    });
    assert.ok(newClosure.version > 1);
    // A newer non-closed version and a different saved configuration must not pollute phase averages.
    for(const [version,stage,identity] of [[2,'Draft',null],[3,'Closed',{customer_code:'UBL',configuration_id:'different-config'}]] as const){
      await db.pool.query("INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[
        randomUUID(),'ubl:'+peer2.site_id,closed.report_version_id,version,stage,{identity,summary:{actual:'900000',actualMarkup:'100'},input:{actual:{Inverter:'999999'}}},randomUUID(),users.Management
      ]);
      assert.deepEqual((await repo.job(users.Management,j.key)).phaseCostComparison.phases.Inverter,{jobs:1,averageActualCost:'20000.00'});
    }

  } finally {
    await db.close();
  }
});
