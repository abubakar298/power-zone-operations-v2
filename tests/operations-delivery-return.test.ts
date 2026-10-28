import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {workflowSiteSchema,completeUpsJob} from '../server/operations-board/workflow.js';
import {recordDeliveryReturn} from '../server/operations-board/delivery-return.js';
const input={scope:'full' as const,dateUnknown:true,warehouse:'',reference:'',reason:'All material returned; nothing delivered. Owner confirmed date unknown.'};
test('full return preserves original evidence, unknown date and stock boundary; partial blocks final installation',()=>{
 const site=workflowSiteSchema.parse({id:'site',name:'Site',ipo:'IPO',stage:'delivered',installation:true,projectType:'ups',deliveryDate:'2026-10-15',documents:[{id:'old-proof',label:'DO',location:'At site',date:'2026-10-15',evidence:[],history:[]}]});
 const returned=recordDeliveryReturn(site,input,'2026-10-28T12:00:00Z');assert.equal(returned.stage,'received');assert.equal(returned.deliveryDate,undefined);assert.equal(returned.deliveryReturns[0].date,null);assert.equal(returned.deliveryReturns[0].priorDeliveryDate,'2026-10-15');assert.deepEqual(returned.documents,site.documents);assert.equal(returned.accounts.at(-1)?.stockPosted,false);assert.equal(site.deliveryDate,'2026-10-15');
 assert.throws(()=>completeUpsJob(returned,{date:'2026-10-28',checks:{}},'2026-10-28T12:00:00Z'),/after delivery/);
 assert.equal(recordDeliveryReturn(site,{...input,scope:'partial'},'2026-10-28T12:00:00Z').stage,'awaiting');
 assert.throws(()=>recordDeliveryReturn({...site,completed:true},input,'2026-10-28T12:00:00Z'),/Management review/);
 assert.throws(()=>recordDeliveryReturn(site,{...input,dateUnknown:false},'2026-10-28T12:00:00Z'),/return date/);
});
test('return decision is regional, versioned, idempotent and creates no stock movement',async()=>{
 const db=await testDatabase();try{const owner=randomUUID(),lead=randomUUID(),qc=randomUUID();for(const [id,role]of[[owner,'Admin'],[lead,'Operations'],[qc,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.invalid',role,role,'isolated']);for(const[id,kind]of[[lead,'lead'],[qc,'qc']])await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,'central',$3)",[id,kind,owner]);
 const repo=new OperationsBoardRepository(db.pool);await repo.importSource(owner,{sourceSha256:'9'.repeat(64),rows:['central','south'].map(team=>({id:team,ipo:team,name:team,stage:'delivered',installation:true,projectType:'ups',operationsTeam:team,deliveryDate:'2026-10-15'}))});
 const command={action:'delivery-return' as const,...input,version:1,requestKey:randomUUID()};await assert.rejects(repo.command(qc,'central',command),/Operations lead/);await assert.rejects(repo.command(lead,'south',command),/not found/);
 const saved=await repo.command(lead,'central',command);assert.equal(saved.stage,'received');assert.equal(saved.version,2);assert.equal((await repo.command(lead,'central',command)).version,2);assert.equal((await repo.site(owner,'central')).deliveryReturns.length,1);await assert.rejects(repo.command(lead,'central',{...command,requestKey:randomUUID()}),/updated/);
 for(const table of ['stock_on_hand_entries','internal_purchase_orders','accounts_job_closures'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
