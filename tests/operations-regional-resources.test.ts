import {workflowSnapshot,readWorkflowSite} from './operations-snapshot.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {commandSchema} from '../server/operations-board/schema.js';
test('regional vendor/member/vehicle directories enforce scope and retain multiple internal assignments',async()=>{
 const db=await testDatabase();try{
 const ids:Record<string,string>={};for(const name of ['owner','head','central','south','qc']){ids[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[ids[name],name+'@example.test',name,name==='owner'?'Admin':'Operations','isolated']);}
 for(const [name,kind,team]of [['head','head',null],['central','lead','central'],['south','lead','south'],['qc','qc','central']])await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[ids[name!],kind,team,ids.owner]);
 const repo=new OperationsBoardRepository(db.pool);
 const create=(actor:string,kind:string,name:string,team?:string)=>repo.saveVendor(ids[actor],{version:0,requestKey:randomUUID(),name,phone:'',roles:kind==='vehicle'?['delivery']:['electrical','delivery'],active:true,reason:'',kind,team} as any);
 const c=await create('central','vendor','Same name'),s=await create('south','vendor','Same name');
 assert.equal(c.team,'central');assert.equal(s.team,'south');
 assert.ok((await repo.vendors(ids.head)).vendors.some(v=>v.id===c.id));assert.ok((await repo.vendors(ids.head)).vendors.some(v=>v.id===s.id));
 assert.ok(!(await repo.vendors(ids.central)).vendors.some(v=>v.id===s.id));assert.ok(!(await repo.vendors(ids.south)).vendors.some(v=>v.id===c.id));
 await assert.rejects(create('central','vendor','Wrong region','south'),/assigned region/);
 await assert.rejects(repo.saveVendor(ids.central,{id:s.id,version:s.version,requestKey:randomUUID(),name:'Tamper',phone:'',roles:['delivery'],active:true,kind:'vendor',reason:'Edit'} as any),/not found/);
 const m1=await create('central','member','Member One'),m2=await create('central','member','Member Two'),foreign=await create('south','member','South Member'),vehicle=await create('central','vehicle','LHR-TEST');
 assert.equal((await repo.resources(ids.central,'member')).resources.length,2);assert.equal((await repo.resources(ids.south,'member')).resources.length,1);assert.equal((await repo.resources(ids.head,'vehicle')).resources[0].id,vehicle.id);
 await assert.rejects(repo.resources(ids.qc,'member'),/Operations lead/);await assert.rejects(create('qc','member','Denied'),/Operations lead/);
 const legacy=await create('head','vendor','Legacy unassigned');assert.equal(legacy.team,null);assert.ok(!(await repo.vendors(ids.central)).vendors.some(v=>v.id===legacy.id));
 await repo.importSource(ids.owner,{sourceSha256:'d'.repeat(64),rows:[{id:'regional-site',ipo:'REGIONAL-TEST',name:'Isolated example',operationsTeam:'central',stage:'received',installation:true,projectType:'ups'}]});
 const plan=async(extra:any)=>repo.command(ids.central,'regional-site',commandSchema.parse({version:(await readWorkflowSite(repo,ids.owner,'regional-site')).version,requestKey:randomUUID(),action:'plan',dispatchDate:'2026-10-29',assignments:{electrical:c.id,delivery:c.id},...extra}));
 await assert.rejects(plan({teamMemberIds:[foreign.id]}),/site region/);
 await assert.rejects(plan({assignments:{electrical:s.id,delivery:c.id},teamMemberIds:[]}),/active vendor/);
 assert.equal(commandSchema.safeParse({version:1,requestKey:randomUUID(),action:'plan',dispatchDate:'2026-10-29',assignments:{electrical:c.id,delivery:c.id},teamMemberIds:[m1.id,m1.id]}).success,false);
 const saved=workflowSnapshot(await plan({teamMemberIds:[m1.id,m2.id]}));assert.deepEqual(saved.teamMembers?.map(m=>m.id),[m1.id,m2.id]);assert.equal(saved.assignments?.electrical,c.id);
 const edited=workflowSnapshot(await plan({edit:true,reason:'Member Two not deployed',teamMemberIds:[m1.id]}));assert.deepEqual(edited.teamMembers?.map(m=>m.id),[m1.id]);
 const old=(await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1 AND version=$2',['regional-site',saved.version])).rows[0];assert.equal(old.snapshot.teamMembers.length,2);
 for(const entry of [c,m1,vehicle]){
  const payload={...entry,requestKey:randomUUID(),reason:'Remove unused resource',deleted:true,active:false} as any;
  await assert.rejects(repo.saveVendor(ids.central,payload),/Only the Operations head/);
  const removed=await repo.saveVendor(ids.head,payload);assert.equal(removed.deleted,true);assert.equal(removed.active,false);
  const list=entry.kind==='vendor'?(await repo.vendors(ids.central)).vendors:(await repo.resources(ids.central,entry.kind as 'member'|'vehicle')).resources;
  assert.ok(!list.some(r=>r.id===entry.id));
  await assert.rejects(repo.saveVendor(ids.central,{...removed,requestKey:randomUUID(),reason:'Unauthorized restore',deleted:false}),/not found/);
  const restored=await repo.saveVendor(ids.head,{...removed,requestKey:randomUUID(),reason:'Restore saved resource',deleted:false,active:true});assert.equal(restored.deleted,false);assert.equal(restored.active,true);
 }
 const unchanged=await readWorkflowSite(repo,ids.owner,'regional-site');assert.deepEqual(unchanged.teamMembers?.map(m=>m.id),[m1.id]);assert.equal(unchanged.assignments?.electrical,c.id);
 for(const table of ['stock_on_hand_entries','accounts_job_closures'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
