import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';import {NotificationsRepository} from '../server/notifications/repository.js';import {activateWorkflowHandoffs} from '../server/notifications/handoff-activation.js';
test('forward-only reviewed handoffs route Accounts, Inventory and regional QC, without activating overdue or stock alerts',async()=>{
 const db=await testDatabase();try{
 const ids:Record<string,string>={};for(const [name,role]of [['owner','Management'],['accounts','Accounts'],['inventory','Inventory'],['central','Operations'],['south','Operations'],['wrong','Operations'],['lead','Operations']]){ids[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[ids[name],name+'@example.test',name,role,'isolated']);}
 for(const [n,kind,team]of [['central','qc','central'],['south','qc','south'],['wrong','lead','central'],['lead','lead','south']])await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[ids[n],kind,team,ids.owner]);
 await db.pool.query("INSERT INTO operations_board_qc_delegations(user_id,team,granted_by,reason) VALUES($1,'south',$2,'Owner dual QC permission')",[ids.lead,ids.owner]);
 await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[ids.inventory,ids.owner]);
 const recipients={accounts:[ids.accounts],inventory:[ids.inventory],leads:[ids.wrong,ids.lead],qc:[ids.central,ids.south,ids.lead],management:[ids.owner]},input={version:0,requestKey:randomUUID(),recipients,reason:'Owner approves new handoffs only'};
 await assert.rejects(activateWorkflowHandoffs(db.pool,ids.wrong,input),/Management/);
 const policy=await activateWorkflowHandoffs(db.pool,ids.owner,input);assert.equal((await activateWorkflowHandoffs(db.pool,ids.owner,input)).version,policy.version);
 const site='isolated-handoff-site';await db.pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)',[site,ids.owner]);
 const snapshot={id:site,name:'Example site',ipo:'EXAMPLE',operationsTeam:'central',stage:'awaiting',planningBatches:[],documents:[],completed:false};
 for(const [version,action,doc] of [[1,'plan',false],[2,'Document movement:do',true]] as const){await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[site,version,{...snapshot,documents:doc?[{id:'do',label:'Signed DO',location:'With delivery driver'}]:[]},action,doc?JSON.stringify({location:'With delivery driver'}):'Isolated real save',randomUUID(),ids.owner]);await db.pool.query('INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),site,version,doc?'Physical document updated':'Dispatch plan','[]',ids.owner]);}
 const notices=new NotificationsRepository(db.pool);await db.pool.query("UPDATE notification_settings SET email_enabled=true,activated_at=now()-interval '1 day'");await notices.sync();await notices.sync();
 const list=(name:string,role:string)=>notices.list({id:ids[name],role} as any);
 assert.equal((await list('inventory','Inventory')).filter(n=>n.kind==='Dispatch plan saved').length,1);assert.equal((await list('central','Operations')).filter(n=>n.kind==='Dispatch plan saved').length,1);assert.equal((await list('south','Operations')).length,0);
 assert.equal((await list('accounts','Accounts')).filter(n=>n.kind==='Physical document update').length,1);
 // Real-source read-model fixtures use valid relational identities; no stock or financial posting is invoked.
 const po=randomUUID(),ipo=randomUUID(),oldPo=randomUUID(),oldIpo=randomUUID(),sha='d'.repeat(64),draft=randomUUID(),dispatch=randomUUID(),evidence=randomUUID(),report=randomUUID(),reportVersion=randomUUID();
 for(const [p,i,historical]of [[po,ipo,false],[oldPo,oldIpo,true]] as const){
 await db.pool.query("INSERT INTO customer_purchase_orders(id,customer_id,po_number,input,created_by) VALUES($1,(SELECT id FROM customers ORDER BY id LIMIT 1),$2,'{}',$3)",[p,'PO-'+p,ids.owner]);
 await db.pool.query("INSERT INTO internal_purchase_orders(id,customer_po_id,number,snapshot,fingerprint,request_key,created_by,created_at) VALUES($1,$2,$3,'{}','isolated',$4,$5,CASE WHEN $6 THEN now()-interval '1 day' ELSE now() END)",[i,p,'IPO-'+i,randomUUID(),ids.owner,historical]);}
 for(const id of [ipo,oldIpo])await db.pool.query('INSERT INTO ipo_accounts_handoffs(id,ipo_id,created_by) VALUES($1,$2,$3)',[randomUUID(),id,ids.owner]);
 await db.pool.query("INSERT INTO inventory_warehouse_sources(source_sha256,catalogue_sha256,metadata,content_fingerprint,created_by) VALUES($1,$1,'{}',$1,$2)",[sha,ids.owner]);
 await db.pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)',[draft,ids.inventory]);
 await db.pool.query("INSERT INTO inventory_material_draft_versions(draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,'{}',$2,$3,$4)",[draft,randomUUID(),sha,ids.inventory]);
 const material={sites:[{siteId:ipo,registeredSiteId:site,ipo:'EXAMPLE',siteName:'Example site'}]};
 await db.pool.query('INSERT INTO inventory_material_dispatches(id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$4,$8)',[dispatch,'DO-'+dispatch,draft,sha,'Lahore warehouse',material,randomUUID(),ids.inventory]);
 await db.pool.query("INSERT INTO inventory_material_evidence(id,warehouse,original_name,media_type,content,sha256,created_by) VALUES($1,'Lahore warehouse','signed.pdf','application/pdf',$2,$3,$4)",[evidence,Buffer.from('isolated-copy'),sha,ids.inventory]);
 await db.pool.query("INSERT INTO inventory_gate_pass_copies(id,document_kind,document_id,warehouse,copy_kind,evidence_id,note,request_key,fingerprint,created_by) VALUES($1,'dispatch',$2,'Lahore warehouse','signed-gate',$3,'Signed saved copy',$4,'isolated',$5)",[randomUUID(),dispatch,evidence,randomUUID(),ids.inventory]);
 await db.pool.query("INSERT INTO inventory_reports(id,job_key,created_by) VALUES($1,'isolated-job',$2)",[report,ids.central]);
 await db.pool.query("INSERT INTO inventory_report_versions(id,report_id,version,stage,snapshot,request_key,created_by) VALUES($1,$2,1,'IRR Received','{}',$3,$4)",[reportVersion,report,randomUUID(),ids.central]);
 await db.pool.query("INSERT INTO accounts_job_closures(id,job_key,report_version_id,version,stage,snapshot,request_key,created_by) VALUES($1,'isolated-job',$2,1,'Awaiting Management','{}',$3,$4)",[randomUUID(),reportVersion,randomUUID(),ids.accounts]);
 for(const [version,action,kind,complete]of [[3,'ups-job','Installation completed',true],[4,'assign-team','Operations team assigned',true],[5,'Batch plan','Batch plan',true]] as const){
 await db.pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[site,version,{...snapshot,completed:complete,documents:[{id:'do',label:'Signed DO',location:'With delivery driver'}],planningBatches:version===5?[{kind:'both',stops:[{kind:'labour'}]}]:[]},action,'Isolated saved decision',randomUUID(),ids.owner]);
 await db.pool.query('INSERT INTO operations_board_events(id,site_id,site_version,kind,audiences,created_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),site,version,kind,'[]',ids.owner]);}
 await notices.sync();await notices.sync();
 const acc=await list('accounts','Accounts'),qc=await list('central','Operations');
 for(const kind of ['IPO issued to Accounts','Material dispatched','Signed gate DO saved','Physical document update','Site completed'])assert.ok(acc.some(n=>n.kind===kind),kind);
 assert.equal(acc.filter(n=>n.kind==='IPO issued to Accounts').length,1,'historical IPO not replayed');
 assert.equal(acc.filter(n=>n.kind==='Departmental handoff').length,1,'new receipt of old IPO retained; duplicate new IPO receipt suppressed');
 assert.ok(qc.some(n=>n.kind==='Material dispatched'));assert.ok(qc.some(n=>n.kind==='Signed gate DO saved'));
 assert.equal((await list('inventory','Inventory')).filter(n=>n.kind==='Dispatch plan saved').length,1,'installation-only stop does not alert Inventory');
 assert.equal((await list('wrong','Operations')).filter(n=>n.kind==='Project assigned').length,1);assert.equal((await list('lead','Operations')).filter(n=>n.kind==='Project assigned').length,0);
 assert.ok((await list('owner','Management')).some(n=>n.kind==='Closure approval required'));
 let sent=0;for(let i=0;i<25;i++)await notices.deliverOne({configured:true,send:async()=>{sent++;return 'captured-'+sent;}},'http://127.0.0.1');assert.ok(sent>=8,'captured mail delivered without contacting provider');
 // Changing current team revokes retained regional access and cancels queued delivery, without changing business snapshots.
 await db.pool.query("UPDATE operations_board_access SET team='south' WHERE user_id=$1",[ids.central]);await notices.sync();assert.equal((await list('central','Operations')).length,0);
 assert.equal((await db.pool.query("SELECT enabled FROM operations_notification_policy_current")).rows[0].enabled,false);
 assert.equal((await db.pool.query("SELECT reminders_enabled FROM notification_settings")).rows[0].reminders_enabled,false);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,0);
 }finally{await db.close();}
});
