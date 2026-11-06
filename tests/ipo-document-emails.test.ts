import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {transaction} from '../server/db/transaction.js';
import {ipoIdentity,operationsEmailIdentity,operationsStageEvidence,changedStageEvidence,ipoEmailTo,ipoEmailCc} from '../server/ipo-email/model.js';
import {queueIpoEmail,queueOperationsEmails} from '../server/ipo-email/queue.js';
import {IpoEmailWorker,attachmentParts,replyHeaders} from '../server/ipo-email/worker.js';
import type {Message,EmailDelivery} from '../server/email/delivery.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {importThreadIndex} from '../server/ipo-email/import-index.js';

test('Thread identities never merge programme orders or CHJ/CHP, and headers retain the actual RFC anchor',()=>{
 assert.notEqual(ipoIdentity('CHP-163','165/250')!.key,ipoIdentity('CHP-163','166/250')!.key);
 assert.notEqual(ipoIdentity('CHJ-102')!.key,ipoIdentity('CHP-102')!.key);
 assert.notEqual(ipoIdentity('CHP-118-R')!.key,ipoIdentity('CHP-118')!.key);
 assert.equal(ipoIdentity('CHP-0163','8/250')!.key,'CHP-163|8/250');
 assert.equal(ipoIdentity('CHP-163','251/250'),null);
 assert.equal(operationsEmailIdentity({id:'received-UBL:UPS:165/250',ipo:'CHP-163'})!.key,'CHP-163|165/250');
 assert.deepEqual(replyHeaders({last_message_id:'<actual@example.test>',reference_ids:['<root@example.test>']}),{'In-Reply-To':'<actual@example.test>',References:'<root@example.test> <actual@example.test>'});
 assert.equal(replyHeaders({last_message_id:'gmail-hex-id'}),undefined);
});
test('Authenticated upload alone sends nothing; committed delivery attaches exact signed bytes on a new tracked thread',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'owner@example.test','Owner','Admin','isolated')",[actor]);
  await importThreadIndex(db.pool,actor,{schemaVersion:2,summary:{sourceSHA256:'a'.repeat(64)},threads:[{threadId:'known',identityKey:'CHP-1|',subject:'IPO: CHP-1',routingDecision:'unique_thread',replyAnchor:{messageId:'<known@example.test>',references:''}}]},true);
  const repo=new OperationsBoardRepository(db.pool),id='received-UBL:UPS:165/250';
  await repo.importSource(actor,{sourceSha256:'a'.repeat(64),rows:[{id,ipo:'CHP-163',name:'Isolated site',customer:'UBL',stage:'awaiting',installation:false,operationsTeam:'central',dispatchDate:'2026-01-01',documents:[]}]});
  const pdf=Buffer.from('%PDF-1.7\nsigned original fixture'),png=Buffer.from([137,80,78,71,13,10,26,10,0]);
  const signed=await repo.upload(actor,id,{filename:'signed-do.pdf',mediaType:'application/pdf',base64:pdf.toString('base64')});
  const photo=await repo.upload(actor,id,{filename:'delivery.png',mediaType:'image/png',base64:png.toString('base64')});
  assert.equal((await db.pool.query('SELECT * FROM ipo_document_email_queue')).rowCount,0);
  const command={version:1,requestKey:randomUUID(),action:'delivery' as const,deliveryDate:'2026-01-02',signedDoId:signed.id,materialPhotoId:photo.id,partial:false,edit:false,reason:''};
  await repo.command(actor,id,command);await repo.command(actor,id,command);
  assert.equal((await db.pool.query('SELECT * FROM ipo_document_email_queue')).rowCount,1);
  const messages:Message[]=[];
  const worker=new IpoEmailWorker(db.pool),delivery:EmailDelivery={configured:true,send:async m=>{messages.push(m);return 'new-thread-provider-id';},getMessageId:async()=>'<new-root@example.test>'};
  await worker.deliverOne(delivery);
  assert.equal(messages.length,1);assert.equal(messages[0].headers,undefined);
  assert.ok(messages[0].subject.includes('165/250'));assert.ok(!messages[0].subject.includes('1/250'));
  assert.deepEqual(Buffer.from(messages[0].attachments![0].content,'base64'),pdf);
  assert.deepEqual(Buffer.from(messages[0].attachments![1].content,'base64'),png);
  assert.equal((await db.pool.query('SELECT root_message_id FROM ipo_document_email_threads')).rows[0].root_message_id,'<new-root@example.test>');
  await assert.rejects(importThreadIndex(db.pool,actor,{schemaVersion:2,summary:{sourceSHA256:'a'.repeat(64)},threads:[]},true),/verified/);
 }finally{await db.close();}
});
test('Each delivery is emitted, including partial deliveries with reused scans; IRR never becomes an email stage',()=>{
 const pdf={id:randomUUID(),mediaType:'application/pdf'},photo={id:randomUUID(),mediaType:'image/png'};
 const before={id:'s',installation:true,deliveries:[{deliveryDate:'2026-10-01',partial:true,signedDo:pdf,materialPhoto:photo}]};
 const after={...before,deliveries:[...before.deliveries,{deliveryDate:'2026-10-02',partial:false,signedDo:pdf,materialPhoto:photo}],qcJob:{date:'2026-10-03',irr:pdf,variableSignoff:pdf,acknowledgement:pdf,evidence:photo}};
 const changed=changedStageEvidence(before,after);assert.deepEqual(changed.map(e=>e.stage),[3,4,5,6]);assert.ok(changed[0].detail.includes('Delivery 2'));
 assert.deepEqual(operationsStageEvidence({...after,installation:false}).map(e=>e.stage),[3,3]);
 assert.equal(operationsStageEvidence({installation:true,qcJob:{irr:pdf}}).length,0);
 const historical={id:'s',installation:true,documents:[{id:'s:historical-handover-documents',evidence:[pdf,{id:'legacy-irr'},photo]}]};
 assert.deepEqual(operationsStageEvidence(historical).map(e=>e.stage),[4,5]);
});
test('Large attachment groups split below the provider limit without modifying signed file bytes',()=>{
 assert.deepEqual(attachmentParts([{size:20},{size:15},{size:3}],30).map(p=>p.length),[1,2]);
 assert.throws(()=>attachmentParts([{size:31}],30),/review/);
 assert.deepEqual(attachmentParts([]),[[]]);
});
test('Future-only transactional queue, exact canonical thread, retained provider acceptance, wrong-site hold and retry idempotency',async()=>{
 const db=await testDatabase();
 try{
  const actor=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'isolated@example.test','Owner','Admin','isolated')",[actor]);
  const identity=ipoIdentity('CHP-163','8/250','Sitara Market','UBL')!;
  const enqueue=()=>transaction(db.pool,c=>queueIpoEmail(c,actor,'event-1',identity,{stage:3,files:[],detail:'Signed delivery'}));
  await enqueue();assert.equal((await db.pool.query('SELECT * FROM ipo_document_email_queue')).rowCount,0,'disabled does not collect history');
  await db.pool.query('UPDATE ipo_document_email_settings SET enabled=true,mailbox_indexed_at=now()');
  await assert.rejects(transaction(db.pool,async c=>{await queueIpoEmail(c,actor,'rollback',identity,{stage:3,files:[],detail:'Rolled back'});throw Error('rollback');}));
  assert.equal((await db.pool.query('SELECT * FROM ipo_document_email_queue')).rowCount,0);
  await db.pool.query(`INSERT INTO ipo_mailbox_thread_index(gmail_thread_id,identity_key,ipo,order_number,subject,message_id,reference_ids,routing_decision) VALUES
   ('current',$1,'CHP-163','8/250','Original IPO subject','<latest@example.test>','["<root@example.test>"]','confirmed_current'),
   ('old',$1,'CHP-163','8/250','Noncurrent subject','<old@example.test>','[]','duplicate_noncurrent')`,[identity.key]);
  await enqueue();await enqueue();assert.equal((await db.pool.query('SELECT * FROM ipo_document_email_queue')).rowCount,1);
  const sent:Message[]=[],ids:string[]=[];let lookupWorks=false;
  const delivery:EmailDelivery={configured:true,send:async(message,id)=>{sent.push(message);ids.push(id);return 'accepted-1';},getMessageId:async()=>{if(!lookupWorks)throw Error('lookup interrupted');return '<actual-provider@example.test>';}};
  const worker=new IpoEmailWorker(db.pool);await worker.deliverOne(delivery);
  assert.equal(sent.length,1);assert.equal(sent[0].to,ipoEmailTo);assert.deepEqual(sent[0].cc,ipoEmailCc);assert.equal(sent[0].subject,'Original IPO subject');
  assert.equal(sent[0].headers!['In-Reply-To'],'<latest@example.test>');assert.ok(sent[0].headers!.References.includes('<root@example.test>'));
  assert.equal((await db.pool.query('SELECT provider_id FROM ipo_document_email_parts')).rows[0].provider_id,'accepted-1');
  lookupWorks=true;await db.pool.query('UPDATE ipo_document_email_queue SET next_attempt_at=now()');await worker.deliverOne(delivery);
  assert.equal(sent.length,1,'RFC lookup retry never repeats an accepted send');
  assert.equal((await db.pool.query('SELECT state FROM ipo_document_email_queue')).rows[0].state,'sent');
  assert.equal((await db.pool.query('SELECT last_message_id FROM ipo_document_email_threads')).rows[0].last_message_id,'<actual-provider@example.test>');
  await transaction(db.pool,c=>queueIpoEmail(c,actor,'wrong-site',identity,{stage:3,files:[{kind:'operations',id:randomUUID(),siteId:'different-site'}],detail:'Wrong source'}));
  await worker.deliverOne(delivery);assert.equal(sent.length,1);assert.equal((await db.pool.query("SELECT state FROM ipo_document_email_queue WHERE source_key='wrong-site'")).rows[0].state,'held');
  await transaction(db.pool,c=>queueOperationsEmails(c,actor,{deliveries:[]},{id:'unidentified',ipo:'missing',deliveries:[{deliveryDate:'2026-10-01',signedDo:{id:randomUUID()},materialPhoto:{id:randomUUID()}}]}));
  assert.equal((await db.pool.query("SELECT state FROM ipo_document_email_queue WHERE identity_key LIKE 'unresolved:%'")).rows[0].state,'held');
 }finally{await db.close();}
});
