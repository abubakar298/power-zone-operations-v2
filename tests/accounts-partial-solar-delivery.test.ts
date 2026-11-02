import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyOperationsStages} from '../server/accounts/site-projection.js';
import {invoicingQueues} from '../server/accounts/billing-model.js';
import {operationsInvoiceRows,invoiceSubmissionRows} from '../server/accounts/invoice-entries.js';
const file='11111111-1111-4111-8111-111111111111';
const approved={key:'UBL:SOLAR:347',site:'UBL Ameen Gojra',ipo:'CHP-347',customer:'UBL',program:'Solar 70',kind:'Solar',installed:false,delivered:false,invoiceReferences:[],advance:{invoiceAmount:'2000000',submitted:false,received:false},completion:{invoiceAmount:'2000000',submitted:false,received:false}};
const snapshot={name:approved.site,ipo:approved.ipo,customer:'UBL',projectType:'solar',stage:'awaiting',installation:true,completed:false,partial:true,invoiceOnDelivery:true,deliveryDate:'2026-10-24',deliveryRecordedAt:'2026-10-28T09:41:55Z',signedDo:{id:file},documents:[{id:'delivery',evidence:[{id:file,name:'Signed partial DO.jpg'}]}]};
test('signed UBL Solar partial delivery enters one delivery invoice queue while keeping full delivery and completion pending',()=>{
 const input=JSON.stringify({approved,snapshot}),op={site_id:'registered-'+approved.key,version:7,snapshot};
 const projected=applyOperationsStages([approved],[op])[0];assert.equal(projected.delivered,false);assert.equal(projected.installed,false);assert.equal(projected.partialDeliveryInvoiceReady,true);
 const queues=invoicingQueues([{rows:[projected]}]);assert.equal(queues.delivery.length,1);assert.equal(queues.completion.length,0);
 const operations=operationsInvoiceRows([op],[{rows:[approved]}]);assert.equal(operations.length,1);assert.equal(operations[0].milestone,'delivery');assert.equal(operations[0].deliveryDate,'2026-10-24');assert.equal(operations[0].advance.invoiceAmount,'2000000');assert.equal(operations[0].evidence[0].id,file);
 const submission=invoiceSubmissionRows(operations,[],[]);assert.equal(submission[0].billingStage,'delivery');assert.equal(submission[0].invoiceCreated,false);
 const entry={id:'created',milestone:'delivery',source_kind:'Operations',site_key:op.site_id,pt_reference:'26-99999',snapshot:{ipo:approved.ipo,site:approved.site}};const created=invoiceSubmissionRows(operations,[],[entry]);assert.equal(created.length,1);assert.equal(created[0].invoiceCreated,true);assert.deepEqual(created[0].invoiceReferences,['26-99999']);
 assert.equal(JSON.stringify({approved,snapshot}),input);
});
test('partial exception never applies to other customers, UPS, delivery-only or unsigned/planned records',()=>{
 for(const change of [{customer:'MBL'},{customer:'Bank Alfalah Limited'},{projectType:'ups'},{installation:false},{projectType:'delivery-only'},{signedDo:null},{partial:false},{deliveryDate:null},{cancelled:true},{transferred:true},{scopePending:true},{deliveryReturns:[{recordedAt:'2026-10-29T00:00:00Z'}]}]){
 const op={site_id:'registered-'+approved.key,version:7,snapshot:{...snapshot,...change}};
 assert.equal(operationsInvoiceRows([op],[]).length,0,JSON.stringify(change));assert.equal(applyOperationsStages([approved],[op])[0].partialDeliveryInvoiceReady,false);
 }
 const projected=applyOperationsStages([{...approved,advance:{...approved.advance,submitted:true}}],[{site_id:'registered-'+approved.key,version:7,snapshot}]);assert.equal(invoicingQueues([{rows:projected}]).delivery.length,0);
});

test('signed partial delivery survives the database projection and stable site identity despite a display-name change',async()=>{
 const {testDatabase}=await import('./database.js');const {latestOperationsStages}=await import('../server/accounts/site-projection.js');const {randomUUID}=await import('node:crypto');const db=await testDatabase();try{
 const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'partial-solar@example.test','Owner','Admin','isolated')",[actor]);
 const site_id='registered-'+approved.key;await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site_id,actor]);
 const changed={...snapshot,name:'Gojra (updated display name)'};await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'delivery','Signed partial delivery',$3,$4)",[site_id,changed,randomUUID(),actor]);
 const ops=await latestOperationsStages(db.pool);assert.equal(applyOperationsStages([approved],ops)[0].partialDeliveryInvoiceReady,true);
 const entries=operationsInvoiceRows([{site_id,snapshot:changed}],[{rows:[approved]}]);assert.equal(entries.length,1);assert.equal(entries[0].advance.invoiceAmount,approved.advance.invoiceAmount);
 await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,2,$2,'delivery','Delivery-only scope',$3,$4)",[site_id,{...changed,installation:false},randomUUID(),actor]);
 assert.equal(applyOperationsStages([approved],await latestOperationsStages(db.pool))[0].partialDeliveryInvoiceReady,false);
 }finally{await db.close();}
});
