import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';

test('later historical evidence preserves completion, clocks and financial handoffs with scoped files and reasoned correction',async()=>{
 const db=await testDatabase();try{
  const users=Object.fromEntries(['owner','qc','south','lead','accounts'].map(key=>[key,randomUUID()]));
  for(const [key,id] of Object.entries(users))await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',key,key==='owner'?'Admin':key==='accounts'?'Accounts':'Operations','isolated']);
  for(const [key,kind,team] of [['qc','qc','central'],['south','qc','south'],['lead','lead','central']])await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[users[key],kind,team,users.owner]);
  const repo=new OperationsBoardRepository(db.pool),original={id:'historical',ipo:'IPO-H',name:'Historical fixture',stage:'delivered' as const,installation:true,completed:true,projectType:'ups' as const,operationsTeam:'central' as const,deliveryDate:'2026-01-01',stageStartedAt:'2026-01-01T00:00:00Z',accounts:[{id:'existing-financial-handoff',type:'Installation completed'}]};
  await repo.importSource(users.owner,{sourceSha256:'d'.repeat(64),rows:[original,{...original,id:'pending',stage:'received',completed:false},{...original,id:'other'}]});
  const pdf=await repo.upload(users.qc,'historical',{filename:'combined-signoff.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7\nSafe test evidence').toString('base64')});
  const other=await repo.upload(users.owner,'other',{filename:'other.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7\nOther fixture').toString('base64')});
  const base={edit:false,reason:'',action:'historical-evidence' as const,category:'handover' as const,date:'2026-01-02',version:1,requestKey:randomUUID(),acknowledgementId:pdf.id,irrId:pdf.id,variableSignoffId:pdf.id};
  await assert.rejects(repo.command(users.south,'historical',base),/assigned team/);
  await assert.rejects(repo.command(users.lead,'historical',base),/assigned QC/);
  await assert.rejects(repo.command(users.qc,'historical',{...base,irrId:other.id}),/different site/);
  const saved=await repo.command(users.qc,'historical',base);assert.equal(saved.version,2);
  for(const key of ['stage','completed','deliveryDate','stageStartedAt','accounts'] as const)assert.deepEqual(saved[key],original[key]);
  assert.equal(saved.documents?.length,1);assert.equal(saved.documents[0].location,'Location not recorded');assert.equal(saved.deliveries,undefined);assert.equal(saved.qcJob,undefined);
  assert.equal((await repo.command(users.qc,'historical',base)).version,2);assert.ok((await repo.download(users.accounts,'historical',pdf.id)).content.length);
  await assert.rejects(repo.command(users.qc,'historical',{...base,version:2,requestKey:randomUUID()}),/locked/);
  await assert.rejects(repo.command(users.qc,'historical',{...base,version:2,requestKey:randomUUID(),edit:true}),/reason/);
  const correction=await repo.command(users.qc,'historical',{...base,version:2,requestKey:randomUUID(),edit:true,reason:'Correct document date from signed copy',date:'2026-01-03'});
  assert.equal(correction.documents?.[0].evidenceDate,'2026-01-03');assert.equal(correction.documents?.[0].createdDate,'2026-01-02');assert.equal(correction.deliveryDate,original.deliveryDate);assert.deepEqual(correction.accounts,original.accounts);
  const events=(await db.pool.query('SELECT kind FROM operations_board_events ORDER BY site_version')).rows;assert.deepEqual(events.map(r=>r.kind),['Existing site evidence recorded','Saved site decision changed']);
  const pendingPdf=await repo.upload(users.qc,'pending',{filename:'pending.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7\nPending fixture').toString('base64')});
  await assert.rejects(repo.command(users.qc,'pending',{...base,requestKey:randomUUID(),acknowledgementId:pendingPdf.id,irrId:pendingPdf.id,variableSignoffId:pendingPdf.id}),/already recorded complete/);
  await assert.rejects(repo.command(users.qc,'historical',{edit:false,reason:'',action:'historical-evidence',category:'delivery',version:3,date:'2026-01-01',requestKey:randomUUID(),signedDoId:pdf.id,materialPhotoId:pdf.id}),/photo/);
 }finally{await db.close();}
});
