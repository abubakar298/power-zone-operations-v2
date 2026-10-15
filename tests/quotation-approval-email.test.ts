import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {NotificationsRepository} from '../server/notifications/repository.js';
import {quotationApprovalAttachments} from '../server/notifications/quotation-attachment.js';
import {priceCni} from '../server/commercial/cni-policy.js';
import type {Message} from '../server/email/delivery.js';
async function pdfText(content:string){const task=getDocument({data:new Uint8Array(Buffer.from(content,'base64')),useSystemFonts:true});const pdf=await task.promise;let text='';try{for(let i=1;i<=pdf.numPages;i++)text+=(await(await pdf.getPage(i)).getTextContent()).items.map((x:any)=>x.str??'').join(' ');return text;}finally{await task.destroy();}}

test('approval email attaches exact submitted quotation PDF, freezes retry bytes and does not expose financial internals',async()=>{
 const db=await testDatabase();try{
 const c=db.pool,owner=randomUUID(),manager=randomUUID();
 for(const [id,role]of [[owner,'Coordinator'],[manager,'Management']])await c.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,`${id}@example.test`,role,role]);
 const records=await createDashboardSamples(c,owner,manager),record=records.find((r:any)=>r.stage===4)!;
 const q=(await c.query('SELECT * FROM quotation_versions WHERE id=$1',[record.quotationId])).rows[0];
 const before=JSON.stringify(q.snapshot);
 // A filename alias collision must be handled without aborting the delivery transaction.
 const occupied='Q'+createHash('sha256').update(`quotation_versions:${q.id}:0`).digest('hex').slice(0,8).toUpperCase();
 await c.query('INSERT INTO download_reference_aliases(document_key,reference) VALUES($1,$2)',['isolated-collision',occupied]);
 await c.query("UPDATE notification_settings SET activated_at=now()-interval '2000 hours',email_enabled=true,reminders_enabled=false");
 const repo=new NotificationsRepository(c);await repo.sync();
 const n=(await c.query("SELECT n.* FROM notifications n JOIN notification_email_queue e ON e.id=n.id WHERE n.user_id=$1 AND n.entity_key=$2 AND n.kind='Submitted'",[manager,'quote:'+q.id])).rows[0];assert.ok(n);
 // A later saved version must never be substituted for this submitted event.
 await c.query("INSERT INTO quotation_versions(id,pricing_id,boq_revision_id,version,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,$3,$4,'LATER-UNSUBMITTED',$5,'later',$6,$7)",[randomUUID(),q.pricing_id,q.boq_revision_id,q.version+1,{...q.snapshot,siteName:'WRONG LATER SITE'},randomUUID(),owner]);
 await c.query("UPDATE notification_email_queue SET next_attempt_at=now()+interval '1 day' WHERE id<>$1",[n.id]);
 let first:Message|undefined,key='';
 await repo.deliverOne({configured:true,send:async(m,id)=>{first=m;key=id;throw Error('provider rejected');}},'https://example.test');
 assert.equal(first?.attachments?.length,1);assert.equal(key,n.id);
 const name=first!.attachments![0].filename;assert.ok(name.startsWith(q.snapshot.customer.shortCode||q.snapshot.customer.name));assert.ok(name.includes('Quotation'));assert.ok(name.endsWith(`-R${q.version}.pdf`));
 const text=await pdfText(first!.attachments![0].content);assert.ok(text.includes(q.number));assert.ok(!text.includes('WRONG LATER SITE'));assert.ok(!/Budgeted cost|Internal cost|Markup on cost|internal_cost_snapshot/i.test(text));
 const saved=(await c.query('SELECT * FROM notification_email_attachments WHERE notification_id=$1',[n.id])).rows[0];
 assert.equal(saved.sha256,createHash('sha256').update(Buffer.from(first!.attachments![0].content,'base64')).digest('hex'));
 await assert.rejects(c.query("UPDATE notification_email_attachments SET filename='changed.pdf' WHERE notification_id=$1",[n.id]),/immutable/i);
 await c.query('UPDATE notification_email_queue SET next_attempt_at=now() WHERE id=$1',[n.id]);
 let second:Message|undefined;
 await repo.deliverOne({configured:true,send:async(m,id)=>{second=m;assert.equal(id,key);return 'mock-provider-id';}},'https://example.test');
 assert.deepEqual(second!.attachments,first!.attachments);assert.equal((await c.query('SELECT state FROM notification_email_queue WHERE id=$1',[n.id])).rows[0].state,'sent');
 assert.equal(JSON.stringify((await c.query('SELECT snapshot FROM quotation_versions WHERE id=$1',[q.id])).rows[0].snapshot),before);
 }finally{await db.close();}
});

test('C&I approval uses the action version, keeps its saved format and never attaches to a nonmanagement notification',async()=>{
 const db=await testDatabase();try{
 const pool=db.pool,owner=randomUUID(),manager=randomUUID(),proposal=randomUUID(),version=randomUUID(),event=randomUUID();
 for(const[id,role]of[[owner,'Coordinator'],[manager,'Management']])await pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,`${id}@example.test`,role,role]);
 const customer=(await pool.query('SELECT id FROM customers LIMIT 1')).rows[0].id;
 await pool.query('INSERT INTO cni_proposals(id,created_by,customer_id) VALUES($1,$2,$3)',[proposal,owner,customer]);
 const s={customer:{name:'CNI Customer',contact_person:'Contact',phone:'',address:'',city:'Lahore',province:'',email:''},siteName:'FIRST SITE',pricing:priceCni({quantity:1,discount:'0',taxRate:'18',presentation:'Separate'}),validityDays:7,preparedBy:'Coordinator',issuedDate:'2026-10-15',pdfTemplate:'PHOTON-APPROVED-1'};
 for(const [id,v,site]of[[version,1,'FIRST SITE'],[randomUUID(),2,'WRONG LATER SITE']]as const)await pool.query("INSERT INTO cni_proposal_versions(id,proposal_id,version,number,snapshot,internal_cost_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,proposal,v,`CNI-R${v}`,{...s,siteName:site},{secretCost:'PRIVATE-COST-DO-NOT-SEND'},owner]);
 await pool.query("INSERT INTO cni_proposal_actions(id,version_id,action,created_by) VALUES($1,$2,'Approval requested',$3)",[event,version,owner]);
 await pool.query("UPDATE notification_settings SET activated_at=now()-interval '1 hour',email_enabled=true");
 const repo=new NotificationsRepository(pool);await repo.sync();
 const n=(await pool.query("SELECT * FROM notifications WHERE user_id=$1 AND source_key=$2",[manager,'cni:'+event])).rows[0];assert.ok(n);
 const c=await pool.connect();try{
 const row={id:n.id,event_source_key:'cni:'+event,event_kind:'Approval requested',audience:'management',role:'Management'};
 assert.deepEqual(await quotationApprovalAttachments(c,{...row,role:'Coordinator'}),[]);
 const files=await quotationApprovalAttachments(c,row);assert.equal(files.length,1);assert.match(files[0].filename,/^CNI Customer - FIRST SITE - Quotation DRAFT - .+-R1.pdf$/);
 const text=await pdfText(files[0].content);assert.ok(text.includes('CNI-R1'));assert.ok(!text.includes('CNI-R2'));assert.ok(!text.includes('PRIVATE-COST-DO-NOT-SEND'));assert.match(text,/AWAITING MANAGEMENT APPROVAL/);
 }finally{c.release();}
 }finally{await db.close();}
});
