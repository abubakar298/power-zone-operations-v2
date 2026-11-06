import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {InventoryRepository} from '../server/inventory/repository.js';
import {AccountsRepository} from '../server/accounts/repository.js';

const phases=['Solar Panels','Structure','Inverter','Batteries','BMS'];

test('Accounts can send an old Draft closure to Management without evidence documents, with a reason; everything else still applies',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};
  for(const role of ['Admin','Management','Accounts','Inventory']){const id=randomUUID();users[role]=id;await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,'not-a-login',role]);}
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[users.Inventory,users.Admin]);
  const inv=new InventoryRepository(db.pool);
  // "Old" means the closure draft started before the cutoff; tests choose the cutoff.
  const oldRecords=new AccountsRepository(db.pool,'2999-01-01T00:00:00Z'),newRecords=new AccountsRepository(db.pool,'2000-01-01T00:00:00Z');
  const j=(await inv.jobs(users.Inventory)).find(x=>x.job_id==='CHP-320')!;
  const source=await inv.job(users.Inventory,j.key);
  const entry={start:'2026-10-01',end:'2026-10-02',panelCount:'55',panelWattage:'645',usage:Object.fromEntries(source.lines.filter(l=>l.group!=='watt').map(l=>[l.key,l.approved])),remarks:'isolated fixture',expectedReturns:'',receivedReturns:'',extra:[]};
  const draftReport=await inv.save(users.Inventory,{jobKey:j.key,version:0,stage:'Draft Reconciliation',entry,requestKey:randomUUID()});
  await inv.upload(users.Inventory,draftReport.reportId,'fixture.pdf','application/pdf',Buffer.from('%PDF-1.4 fixture').toString('base64'));
  await inv.save(users.Inventory,{jobKey:j.key,version:1,stage:'Sent to Accounts',entry,requestKey:randomUUID()});
  await oldRecords.recordPtEntry(users.Accounts,{sourceKind:'Inventory',sourceId:draftReport.reportId,sourceVersion:2,ptReference:'PT-IRR-320',entryDate:'2026-10-26',notes:'entered'});
  const job=await oldRecords.job(users.Accounts,j.key);
  assert.equal(job.legacyEvidenceBypassEligible,false,'no closure draft yet');
  const base={jobKey:j.key,actual:Object.fromEntries(phases.map(p=>[p,job.budget[p]])),epc:job.epcBudget,remarks:'Costs checked against PT',acknowledgment:'',photos:'',ptReference:'PT fixture reference'};
  const reason={reason:'Historical record, originals not available'};
  // Without a draft there is nothing old to send.
  await assert.rejects(oldRecords.saveClosure(users.Accounts,{...base,version:0,stage:'Awaiting Management',legacyEvidenceBypass:reason,requestKey:randomUUID()}),/old records already in Draft/);
  const draft=await oldRecords.saveClosure(users.Accounts,{...base,version:0,stage:'Draft',requestKey:randomUUID()});
  assert.equal((await oldRecords.job(users.Accounts,j.key)).legacyEvidenceBypassEligible,true);
  // The normal rule still holds without the bypass.
  await assert.rejects(oldRecords.saveClosure(users.Accounts,{...base,version:draft.version,stage:'Awaiting Management',requestKey:randomUUID()}),/attach the PT costing screenshot/);
  // Only Accounts, only with a reason, only for drafts started before the cutoff, only when sending to Management.
  await assert.rejects(oldRecords.saveClosure(users.Admin,{...base,version:draft.version,stage:'Awaiting Management',legacyEvidenceBypass:reason,requestKey:randomUUID()}),/Only Accounts/);
  await assert.rejects(newRecords.saveClosure(users.Accounts,{...base,version:draft.version,stage:'Awaiting Management',legacyEvidenceBypass:reason,requestKey:randomUUID()}),/old records already in Draft/);
  await assert.rejects(oldRecords.saveClosure(users.Accounts,{...base,version:draft.version,stage:'Draft',legacyEvidenceBypass:reason,requestKey:randomUUID()}),/only when sending to Management/);
  // Costs and remarks are still required.
  await assert.rejects(oldRecords.saveClosure(users.Accounts,{...base,remarks:'',version:draft.version,stage:'Awaiting Management',legacyEvidenceBypass:reason,requestKey:randomUUID()}),/Complete actual costs/);
  const sent=await oldRecords.saveClosure(users.Accounts,{...base,version:draft.version,stage:'Awaiting Management',legacyEvidenceBypass:reason,requestKey:randomUUID()});
  assert.equal(sent.stage,'Awaiting Management');
  assert.equal(sent.snapshot.legacyEvidenceBypass.reason,reason.reason);assert.equal(sent.snapshot.legacyEvidenceBypass.by,users.Accounts);
  assert.equal(sent.snapshot.legacyEvidenceBypass.label,'Sent without evidence – old record');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit_log WHERE action=$1",['accounts.closure.legacy-evidence-bypass:'+sent.id])).rows[0].n,1);
  // The draft version is kept unchanged; the submission is a new version.
  assert.equal((await db.pool.query('SELECT stage FROM accounts_job_closures WHERE id=$1',[draft.id])).rows[0].stage,'Draft');
  assert.equal((await oldRecords.job(users.Accounts,j.key)).legacyEvidenceBypassEligible,false,'already sent');
 }finally{await db.close();}
});
