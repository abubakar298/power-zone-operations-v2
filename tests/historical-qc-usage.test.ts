import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {HistoricalQcUsageRepository} from '../server/inventory/historical-qc-usage.js';
import {materialCostingQueue} from '../server/accounts/material-costing.js';
import {recordPtEntry} from '../server/accounts/pt-entries.js';
import {AccountsRepository} from '../server/accounts/repository.js';
test('historical QC usage reaches one Accounts task, PT then closure, without warehouse posting or old usage seeding',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),accounts=randomUUID(),south=randomUUID();
  for(const [id,role] of [[actor,'Management'],[accounts,'Accounts'],[south,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'qc','south',$2)",[south,actor]);
  const boardId='registered-UBL:SOLAR:294',board=new OperationsBoardRepository(db.pool);
  await board.importSource(actor,{sourceSha256:'e'.repeat(64),rows:[{id:boardId,ipo:'CHP-294',name:'Jhudo',customer:'UBL',installation:true,projectType:'solar',stage:'delivered',completed:true,operationsTeam:'central'}]});
  const repo=new HistoricalQcUsageRepository(db.pool),initial=await repo.read(actor,boardId);
  assert.equal(initial.entry,null);assert.ok(initial.issued.length);await assert.rejects(repo.read(south,boardId),/assigned team/);
  const entry={start:'',end:'',panelCount:'49',panelWattage:'620',usage:Object.fromEntries(initial.lines.filter(l=>l.group!=='watt').map(l=>[l.key,'0'])),remarks:'Test source actuals',expectedReturns:'',receivedReturns:'',extra:initial.additionalCables.filter(c=>c.used!=='').map(({description,unit,used})=>({description,unit,used}))};
  const draft={version:initial.version,entry,reason:'Entered by Rafiq from owner-provided screenshot',verify:false,requestKey:randomUUID()};
  const saved=await repo.save(actor,boardId,draft);assert.equal(saved.stage,'IRR Received');assert.equal((await repo.read(actor,boardId)).entry.panelCount,'49');
  await assert.rejects(repo.save(actor,boardId,{...draft,version:saved.version,verify:true,requestKey:randomUUID()}),/signed DO and distinct VSO/);
  const doFile=await board.upload(actor,boardId,{filename:'DO.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7\nDO fixture').toString('base64')}),vso=await board.upload(actor,boardId,{filename:'VSO.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7\nVSO fixture').toString('base64')});
  await board.command(actor,boardId,{action:'historical-evidence',category:'delivery',version:1,date:'2026-01-01',signedDoId:doFile.id,edit:false,reason:'Existing DO',requestKey:randomUUID()});
  await board.command(actor,boardId,{action:'historical-evidence',category:'handover',version:2,date:'2026-01-01',acknowledgementId:vso.id,variableSignoffId:vso.id,edit:false,reason:'Existing customer source',requestKey:randomUUID()});
  const verifiedInput={...draft,version:saved.version,verify:true,requestKey:randomUUID()},verified=await repo.save(actor,boardId,verifiedInput);
  assert.equal(verified.stage,'Sent to Accounts');assert.equal((await repo.save(actor,boardId,verifiedInput)).version,verified.version);
  const queue=(await materialCostingQueue(db.pool,accounts)).rows.filter(r=>r.jobKey===initial.jobKey);assert.equal(queue.length,1);assert.equal(queue[0].documents.length,3);assert.equal(queue[0].status,'Ready for PT entry');
  await recordPtEntry(db.pool,accounts,{sourceKind:'Inventory',sourceId:verified.reportId,sourceVersion:verified.version,ptReference:'PT-TEST',entryDate:'2026-11-01',notes:'Recorded in test PT'});
  assert.equal((await materialCostingQueue(db.pool,accounts)).rows.some(r=>r.jobKey===initial.jobKey),false);
  assert.equal((await new AccountsRepository(db.pool).job(accounts,initial.jobKey)).entry.panelCount,'49');
  await assert.rejects(repo.save(actor,boardId,{...verifiedInput,version:verified.version,requestKey:randomUUID()}),/PT entry already exists/);
  assert.equal((await db.pool.query('SELECT count(*) n FROM inventory_material_dispatches')).rows[0].n,'0');
 }finally{await db.close();}
});
