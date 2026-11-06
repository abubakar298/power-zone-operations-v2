import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {ProjectCheckpointsRepository,remainingDays} from '../server/projects/repository.js';
test('Historical UBL checkpoint import preserves prices, separates completion and invoices, and enforces department access',async()=>{
 const db=await testDatabase();try{
 const users:Record<string,string>={};for(const role of ['Admin','Operations','Accounts','Coordinator']){const id=randomUUID();users[role]=id;await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,'not-a-login',role]);}
 const repo=new ProjectCheckpointsRepository(db.pool);
 const jobs=await repo.list(users.Admin),ubl=jobs.filter(j=>j.key.startsWith('ubl:'));
 assert.equal(ubl.length,38);assert.equal(ubl.filter(j=>j.sourceAvailable).length,36);
 const sample=ubl.find(j=>j.jobId==='CHP-320');assert.equal(sample.operation.startDate,'2026-08-24');assert.equal(sample.operation.completionDate,'2026-09-29');assert.equal(sample.agreedTotal,'7800000');assert.equal(sample.invoiceTotal,'7708016.00');assert.equal(sample.difference,'-91984.00');assert.equal(sample.operation.installationStatus,'Installation completed');
 const hala=ubl.find(j=>j.jobId==='CHP-300');assert.equal(hala.operation.installationStatus,'Cancelled');assert.equal(hala.operation.estimatedDate,'');
 assert.equal(ubl.find(j=>j.jobId==='CHP-305').operation.installationStatus,'Awaiting data');
 assert.equal(ubl.filter(j=>j.operation.installationStatus==='Work in Progress').length,12);
 assert.ok(ubl.filter(j=>j.operation.installationStatus==='Work in Progress').every(j=>j.operation.estimatedDate==='2026-10-14'));
 assert.equal(ubl.filter(j=>j.sourceAvailable&&!j.invoices.some((i:any)=>i.invoice_type==='Internet (11 months)'&&i.recorded_invoice_total!=null)).length,14);
 assert.ok(ubl.find(j=>j.jobId==='CHP-286').operation.remarks.includes('resolved'));
 assert.ok(ubl.find(j=>j.jobId==='CHP-292').flags.some((f:string)=>f.includes('replacement')));
 const operations=await repo.list(users.Operations);assert.equal(operations[0].invoices,undefined);assert.equal(operations[0].agreedTotal,undefined);
 await assert.rejects(repo.list(users.Coordinator));
 await assert.rejects(repo.save(users.Operations,sample.key,{department:'Accounts',version:0,requestKey:randomUUID(),snapshot:{}}));
 const input={department:'Operations',version:0,requestKey:randomUUID(),snapshot:{...sample.operation,remarks:'Verified original dates'}};
 const saved=await repo.save(users.Operations,sample.key,input);assert.equal(saved.version,1);assert.equal((await repo.save(users.Operations,sample.key,input)).id,saved.id);
 await assert.rejects(repo.save(users.Operations,sample.key,{...input,requestKey:randomUUID()}));
 assert.equal((await repo.list(users.Admin)).find(j=>j.key===sample.key).agreedTotal,'7800000');
 await assert.rejects(repo.save(users.Operations,hala.key,{...input,requestKey:randomUUID()}));
 await assert.rejects(db.pool.query("UPDATE project_source_links SET snapshot='{}'"));
 assert.equal(remainingDays('2026-10-14','2026-10-11'),3);
 }finally{await db.close();}
});
