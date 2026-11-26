import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {AccountsRepository} from '../server/onboarding/repository.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {requireQcMaterialSite} from '../server/inventory/qc-material-access.js';
test('Admin can give a QC account a second region; it sees and works on both, and losing QC ends the extra region',async()=>{
 const db=await testDatabase();try{
  const admin=randomUUID(),hash='fixture-not-a-login-hash';
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'extra-admin@example.invalid','Extra Admin','Admin',$2)",[admin,hash]);
  const accounts=new AccountsRepository(db.pool),base={displayName:'Fixture staff',passwordHash:hash,actorId:admin,actorHash:hash};
  const qc=(await accounts.createDirect({...base,email:'qc@example.invalid',role:'Operations',scopedAccess:{kind:'QC',region:'central'}})).id;
  const lead=(await accounts.createDirect({...base,email:'lead@example.invalid',role:'Operations',scopedAccess:{kind:'Operations Lead',region:'central'}})).id;
  const board=new OperationsBoardRepository(db.pool);
  await board.importSource(admin,{sourceSha256:'e'.repeat(64),rows:[{id:'south',ipo:'SOUTH',name:'South test site',operationsTeam:'south',projectType:'solar-bess',installation:true,stage:'delivered',deliveryDate:'2026-01-01'},{id:'central',ipo:'CENTRAL',name:'Central test site',operationsTeam:'central',projectType:'solar-bess',installation:true,stage:'delivered',deliveryDate:'2026-01-01'}]});
  const visible=async(id:string)=>(await board.sites(id)).sites.map(s=>s.id).sort();
  assert.deepEqual(await visible(qc),['central']);await assert.rejects(board.site(qc,'south'),/assigned team/);await assert.rejects(requireQcMaterialSite(qc,'south',db.pool,true),/assigned team/);
  // Only QC accounts, and never the region they already have.
  await assert.rejects(accounts.change(admin,hash,lead,{qcRegion:{team:'south',enabled:true}}),/active QC account/);
  await assert.rejects(accounts.change(admin,hash,qc,{qcRegion:{team:'central',enabled:true}}),/main QC region/);
  await assert.rejects(accounts.change(qc,hash,qc,{qcRegion:{team:'south',enabled:true}}),/account access changed/);
  await accounts.change(admin,hash,qc,{qcRegion:{team:'south',enabled:true}});
  const access=(await board.sites(qc)).access;assert.equal(access.kind,'qc');assert.equal(access.team,'central');assert.deepEqual(access.teams,['central','south']);
  assert.deepEqual(await visible(qc),['central','south']);assert.equal((await board.site(qc,'south')).id,'south');assert.equal((await requireQcMaterialSite(qc,'south',db.pool,true)).id,'south');
  assert.deepEqual(await visible(lead),['central']);
  const listed=(await accounts.list()).users.find(u=>u.id===qc);assert.deepEqual(listed?.operations_access,{kind:'qc',team:'central',extraTeams:['south']});
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit_log WHERE action='account.qc_region.added:south'")).rows[0].n,1);
  // A stale extra region never follows the account out of QC.
  await db.pool.query("UPDATE operations_board_access SET kind='lead' WHERE user_id=$1",[qc]);assert.deepEqual(await visible(qc),['central']);
  await db.pool.query("UPDATE operations_board_access SET kind='qc' WHERE user_id=$1",[qc]);
  await accounts.change(admin,hash,qc,{qcRegion:{team:'south',enabled:false}});assert.deepEqual(await visible(qc),['central']);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_qc_regions')).rows[0].n,0);
 }finally{await db.close();}
});
