import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {batchStopChange,batchStopChangeHistory} from '../server/operations-board/batch-stop-change.js';

test('an edited batch stop names delivery and installation cancellations and postponements',()=>{
 assert.equal(batchStopChange({kind:'both',plannedDate:'2026-12-02'},{kind:'labour',plannedDate:'2026-12-02'}),'Batch delivery cancelled');
 assert.equal(batchStopChange({kind:'delivery'},{kind:'labour',plannedDate:'2026-12-02'}),'Batch delivery cancelled');
 assert.equal(batchStopChange({kind:'both',plannedDate:'2026-12-02'},{kind:'delivery'}),'Batch installation cancelled');
 assert.equal(batchStopChange({kind:'labour',plannedDate:'2026-12-02'},{kind:'labour',plannedDate:'2026-12-05'}),'Batch installation postponed');
 assert.equal(batchStopChange({kind:'labour',plannedDate:'2026-12-05'},{kind:'labour',plannedDate:'2026-12-02'}),'Batch plan changed','an earlier date is a plan change, not a postponement');
 assert.equal(batchStopChange({kind:'delivery'},{kind:'both',plannedDate:'2026-12-02'}),'Batch plan changed','adding installation cancels nothing');
 const visit={before:{kind:'both' as const,plannedDate:'2026-12-02'},after:{kind:'labour' as const,plannedDate:'2026-12-02'}};
 assert.equal(batchStopChangeHistory('Batch delivery cancelled',{number:'OPB-1',deliveryDate:'2026-12-01',...visit,reason:'Gate closed',issuedDos:['CPZ-DO-7']}),
  'OPB-1: delivery cancelled; installation stays planned for 2026-12-02. Reason: Gate closed DOs already issued for this site: CPZ-DO-7. Inventory to review them.');
 assert.match(batchStopChangeHistory('Batch installation postponed',{number:'OPB-1',before:{kind:'labour',plannedDate:'2026-12-02'},after:{kind:'labour',plannedDate:'2026-12-05'},reason:'Rain',issuedDos:[]})!,/postponed from 2026-12-02 to 2026-12-05.*Reason: Rain$/);
 assert.equal(batchStopChangeHistory('Batch plan changed',{number:'OPB-1',...visit,reason:'x',issuedDos:[]}),null);
});

test('Inventory and QC are told about delivery and installation cancellations with the reason',async()=>{
 const [{testDatabase},{OperationsBoardRepository},{batchSchema},{NotificationsRepository},{activateWorkflowHandoffs},{readWorkflowSite}]=await Promise.all([
  import('./database.js'),import('../server/operations-board/repository.js'),import('../server/operations-board/schema.js'),import('../server/notifications/repository.js'),import('../server/notifications/handoff-activation.js'),import('./operations-snapshot.js')]);
 const db=await testDatabase();try{
  const owner=randomUUID(),lead=randomUUID(),qc=randomUUID(),inventory=randomUUID(),accounts=randomUUID();
  for(const [id,role] of [[owner,'Admin'],[lead,'Operations'],[qc,'Operations'],[inventory,'Inventory'],[accounts,'Accounts']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  for(const [id,kind] of [[lead,'lead'],[qc,'qc']])await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,'central',$3)",[id,kind,owner]);
  await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)",[inventory,owner]);
  const repo=new OperationsBoardRepository(db.pool),ids=['keep-install','keep-delivery','untouched','postpone'];
  await repo.importSource(owner,{sourceSha256:'e'.repeat(64),rows:ids.map(id=>({id,ipo:'IPO-'+id,name:'Site '+id,stage:'received' as const,projectType:'ups' as const,installation:true,operationsTeam:'central' as const}))});
  await activateWorkflowHandoffs(db.pool,owner,{version:0,requestKey:randomUUID(),recipients:{inventory:[inventory],accounts:[accounts],qc:[qc],leads:[lead],management:[owner]},reason:'Batch cancellation notices'});
  await db.pool.query("UPDATE notification_settings SET email_enabled=true,activated_at=now()-interval '1 day'");
  const stops=async(kinds:Record<string,{kind:'both'|'labour'|'delivery';plannedDate:string}>)=>Promise.all(Object.entries(kinds).map(async([siteId,s],n)=>({siteId,siteVersion:(await readWorkflowSite(repo,owner,siteId)).version,order:n+1,kind:s.kind,plannedDate:s.plannedDate,start:'',end:''})));
  const plan={team:'central',kind:'both',deliveryDate:'2026-12-01',vehicle:'CAN-1',driver:'Driver',labourTeam:'pz-team'};
  const all=(date:string)=>Object.fromEntries(ids.map(id=>[id,{kind:'both' as const,plannedDate:date}]));
  const saved=await repo.saveBatch(lead,batchSchema.parse({...plan,version:0,requestKey:randomUUID(),stops:await stops(all('2026-12-02'))}));
  const edit=batchSchema.parse({...plan,id:saved.id,version:1,requestKey:randomUUID(),edit:true,reason:'Customer gate closed on Monday',stops:await stops({...all('2026-12-02'),
   'keep-install':{kind:'labour',plannedDate:'2026-12-02'},'keep-delivery':{kind:'delivery',plannedDate:'2026-12-02'},postpone:{kind:'both',plannedDate:'2026-12-04'}})});
  await repo.saveBatch(lead,edit);
  const kinds=(await db.pool.query("SELECT site_id,kind FROM operations_board_events WHERE kind LIKE 'Batch%' AND kind<>'Batch plan' ORDER BY site_id")).rows;
  assert.deepEqual(kinds.map(r=>[r.site_id,r.kind]),[['keep-delivery','Batch installation cancelled'],['keep-install','Batch delivery cancelled'],['postpone','Batch installation postponed']],'an unchanged stop raises no event');
  const history=(await readWorkflowSite(repo,owner,'keep-install')).history.at(-1)!.description;
  assert.equal(history,`${saved.number}: delivery cancelled; installation stays planned for 2026-12-02. Reason: Customer gate closed on Monday`);
  await repo.deleteBatch(owner,{id:saved.id,version:2,requestKey:randomUUID(),reason:'Vehicle unavailable this week'});
  const notices=new NotificationsRepository(db.pool);await notices.sync();await notices.sync();
  for(const user of [{id:inventory,role:'Inventory'},{id:qc,role:'Operations'}]){
   const inbox=await notices.list(user as any);
   const of=(kind:string)=>inbox.filter(n=>n.kind===kind);
   assert.equal(of('Delivery cancelled from batch').length,1,user.role);
   assert.match(of('Delivery cancelled from batch')[0].reference,/IPO-keep-install \| Site keep-install \| .*delivery cancelled.*Reason: Customer gate closed on Monday/);
   assert.match(of('Installation cancelled from batch')[0].reference,/Site keep-delivery .*VSO and acknowledgment are not due yet.*Customer gate closed/);
   assert.match(of('Installation postponed')[0].reference,/from 2026-12-02 to 2026-12-04/);
   assert.equal(of('Batch deleted').length,ids.length,'every site of the deleted batch is listed once');
   assert.ok(of('Batch deleted').every(n=>n.reference.includes('Reason: Vehicle unavailable this week')));
   assert.equal(of('Dispatch plan saved').length,ids.length,'only the first plan is a saved plan; the cancellations are not');
  }
  const mails=(await db.pool.query("SELECT n.kind FROM notifications n JOIN notification_email_queue q ON q.id=n.id WHERE n.user_id=$1 AND n.kind='Delivery cancelled from batch'",[inventory])).rowCount;
  assert.equal(mails,1,'the cancellation is emailed as well');
 }finally{await db.close();}
});
