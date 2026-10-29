import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {archivedLegacySolarKeys,isArchivedLegacySolar} from '../shared/legacy-solar-archive.js';
import {projectAccountsSites} from '../server/accounts/site-projection.js';import {operationsInvoiceRows,invoiceRegister} from '../server/accounts/invoice-entries.js';
import {showOperationsSite} from '../shared/operations-site-visibility.js';import {AccountsSourceRegisters} from '../server/accounts/source-registers.js';import {OperationsBoardRepository} from '../server/operations-board/repository.js';import {testDatabase} from './database.js';
test('exact34 legacy identities archive without matching names, IPOs, UPS or current Solar70',()=>{
 assert.equal(archivedLegacySolarKeys.length,34);assert.equal(new Set(archivedLegacySolarKeys).size,34);
 for(const key of archivedLegacySolarKeys){assert.equal(isArchivedLegacySolar({key,program:'Solar legacy'}),true);assert.equal(isArchivedLegacySolar({id:'registered-'+key}),true);assert.equal(isArchivedLegacySolar({key,program:'Solar 70'}),false);assert.equal(isArchivedLegacySolar({key,kind:'UPS'}),false);}
 assert.equal(isArchivedLegacySolar({key:'UBL:SOLAR:315',program:'Solar 70'}),false);assert.equal(isArchivedLegacySolar({key:'unverified',site:'KATHORE SUPER HIGHWAY',ipo:'CHP-105',program:'Solar legacy'}),false);
 const legacy=archivedLegacySolarKeys.map(key=>({key,program:'Solar legacy',installed:true,delivered:true,invoiceReferences:['26-50001'],completion:{received:true}}));
 const current={key:'UBL:SOLAR:315',program:'Solar 70',installed:true,delivered:true,completion:{received:false,expected:'100.25'},invoiceReferences:[]};const snapshot={sites:{rows:[...legacy,current],counts:{}},registers:[{rows:[...legacy,current]}]},before=structuredClone(snapshot),result=projectAccountsSites(snapshot,[]);
 assert.equal(result.counts.archived,34);assert.equal(result.counts.active,1);assert.equal(result.counts.completed,1);assert.equal(result.rows.filter((r:any)=>r.archived&&r.position==='history').length,34);assert.deepEqual(result.rows.at(-1),{...current,position:'completed'});assert.deepEqual(snapshot,before);
 for(const key of archivedLegacySolarKeys){const s={id:'registered-'+key,name:'Historical',stage:'completed',completed:true,installation:true,projectType:'solar-bess'};assert.equal(showOperationsSite(s),false);assert.deepEqual(operationsInvoiceRows([{site_id:s.id,version:1,snapshot:s}]),[]);}
 assert.equal(showOperationsSite({id:'registered-UBL:SOLAR:315',stage:'completed',completed:true,installation:true,projectType:'solar-bess'}),true);
});
test('native read projections retain source, document/history and financial evidence while removing legacy active queues',async()=>{
 const db=await testDatabase();try{
 const admin=randomUUID(),accounts=randomUUID();for(const [id,role] of [[admin,'Admin'],[accounts,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$3,$4)',[id,id+'@example.test',role,'isolated']);
 const make=(key:string,program:string)=>({key,customer:'UBL',kind:'Solar / BESS',program,ipo:'CHP-'+key.split(':').at(-1),site:key,installed:true,delivered:true,flags:[],sources:[],invoiceReferences:[],accountsReferences:[],cancelled:false,transferred:false,advance:{invoiceAmount:null,received:false},completion:{invoiceAmount:null,received:false}});
 const rows=[...archivedLegacySolarKeys.map(k=>make(k,'Solar legacy')),make('UBL:SOLAR:315','Solar 70')];const source:any={sourceDate:'2026-10-29',manifest:[{name:'Archive isolated fixture',sha256:'c'.repeat(64)}],registers:[{rows}],sites:{rows,counts:{}},cables:{rows:[]},internet:{rows:[]},evidence:{rows:[],cableStageAdjustments:[],generalReceipts:[{id:'receipt-kept',amount:'114400.00',notes:'Preserve general receipt'}]}};
 const repo=new AccountsSourceRegisters(db.pool);await repo.import(admin,source,0);
 for(const row of rows){const id='registered-'+row.key;await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[id,admin]);await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','Historical evidence',$3,$4)",[id,{id,name:row.site,ipo:row.ipo,sourceKey:row.key,stage:'completed',completed:true,installation:true,projectType:'solar-bess',documents:[{id:'signed',label:'Signed DO',evidence:[],history:[]}]},randomUUID(),admin]);}
 const tables=['accounts_source_registers','operations_board_sites','operations_board_versions','operations_board_files','accounts_invoice_entries','stock_on_hand_entries','audit_log'];const contents=async()=>Promise.all(tables.map(async t=>(await db.pool.query('SELECT row_to_json(t)::text AS data FROM '+t+' t ORDER BY row_to_json(t)::text')).rows));
 const before=await contents(),board=new OperationsBoardRepository(db.pool),billing=await repo.billing(accounts);
 assert.equal((await repo.sites(accounts)).counts.archived,34);assert.equal((await repo.summary(accounts))!.counts.active,1);
 assert.deepEqual((await board.sites(admin)).sites.map((s:any)=>s.id),['registered-UBL:SOLAR:315']);assert.equal((await board.physicalDocuments(accounts)).sites.length,1);
 assert.equal((await board.site(admin,'registered-'+archivedLegacySolarKeys[0])).documents[0].label,'Signed DO');assert.equal((await board.history(admin,'registered-'+archivedLegacySolarKeys[0])).versions.length,1);
 await assert.rejects(board.command(admin,'registered-'+archivedLegacySolarKeys[0],{action:'assign-team',team:'central',version:1,requestKey:randomUUID(),edit:false,reason:'Attempt new work'}),/read-only/);
 const register=await invoiceRegister(db.pool,accounts);assert.equal(register.queues.completion.length,1);assert.equal(register.queues.completion[0].key,'registered-UBL:SOLAR:315');
 assert.deepEqual((await repo.billing(accounts)).generalReceipts,billing.generalReceipts);assert.deepEqual(await contents(),before);
 }finally{await db.close();}
});
