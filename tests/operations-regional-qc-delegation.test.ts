import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {testDatabase} from './database.js';import {migrate} from '../server/db/migrate.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';import {setRegionalQcDelegation} from '../server/operations-board/qc-delegation.js';import {requireQcMaterialSite} from '../server/inventory/qc-material-access.js';
test('136→137 preserves existing records; optional QC grant is regional, revocable and retains lead duties',async()=>{
 const old=await mkdtemp(join(tmpdir(),'pz-qc-before-'));const db=await testDatabase({skipMigrations:true});
 try{
  for(const file of await readdir('migrations'))if(file.endsWith('.sql')&&Number(file.split('_')[0])<137)await copyFile(join('migrations',file),join(old,file));await migrate(db.pool,old);
  const owner=randomUUID(),lead=randomUUID(),other=randomUUID();for(const[id,role]of[[owner,'Admin'],[lead,'Operations'],[other,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.invalid',role,role,'isolated']);
  for(const[id,team]of[[lead,'south'],[other,'central']])await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'lead',$2,$3)",[id,team,owner]);
  const usersBefore=(await db.pool.query('SELECT id,role,active FROM users ORDER BY id')).rows,accessBefore=(await db.pool.query('SELECT * FROM operations_board_access ORDER BY user_id')).rows;
  await migrate(db.pool,undefined,true);assert.deepEqual((await db.pool.query('SELECT id,role,active FROM users ORDER BY id')).rows,usersBefore);assert.deepEqual((await db.pool.query('SELECT * FROM operations_board_access ORDER BY user_id')).rows,accessBefore);assert.equal((await db.pool.query('SELECT count(*)::int n FROM operations_board_qc_delegations')).rows[0].n,0);
  const repo=new OperationsBoardRepository(db.pool);await repo.importSource(owner,{sourceSha256:'c'.repeat(64),rows:[{id:'south',ipo:'SOUTH',name:'South test site',operationsTeam:'south',projectType:'solar-bess',installation:true,stage:'delivered',deliveryDate:'2026-01-01'},{id:'central',ipo:'CENTRAL',name:'Central test site',operationsTeam:'central',projectType:'solar-bess',installation:true,stage:'delivered',deliveryDate:'2026-01-01'}]});
  assert.equal((await repo.sites(lead)).access.qcDelegated,false);
  await assert.rejects(requireQcMaterialSite(lead,'south',db.pool,true),/assigned QC/);
  await assert.rejects(setRegionalQcDelegation(db.pool,lead,{email:lead+'@example.invalid',team:'south',enabled:true,reason:'Self grant blocked'}),/Only Admin/);
  await assert.rejects(setRegionalQcDelegation(db.pool,owner,{email:lead+'@example.invalid',team:'central',enabled:true,reason:'Wrong region blocked'}),/current region/);
  await setRegionalQcDelegation(db.pool,owner,{email:lead+'@example.invalid',team:'south',enabled:true,reason:'Temporary South QC duties approved by owner'});
  const access=(await repo.sites(lead)).access;assert.equal(access.kind,'lead');assert.equal(access.team,'south');assert.equal(access.qcDelegated,true);assert.equal((await repo.sites(other)).access.qcDelegated,false);await repo.batches(lead);
  assert.equal((await requireQcMaterialSite(lead,'south',db.pool,true)).id,'south');await assert.rejects(requireQcMaterialSite(lead,'central',db.pool,true),/assigned team/);
  const proof=await repo.upload(lead,'south',{filename:'proof.png',mediaType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='});
  const command={action:'qc' as const,stageId:'civil' as const,edit:false,reason:'',date:'2026-01-02',evidenceIds:[proof.id],version:1,requestKey:randomUUID()};const saved=await repo.command(lead,'south',command);assert.ok(saved.qc?.civil);await assert.rejects(repo.command(lead,'central',command),/assigned team/);
  await setRegionalQcDelegation(db.pool,owner,{email:lead+'@example.invalid',team:'south',enabled:false,reason:'Temporary QC duty ended'});assert.equal((await repo.sites(lead)).access.qcDelegated,false);await assert.rejects(requireQcMaterialSite(lead,'south',db.pool,true),/assigned QC/);await repo.batches(lead);
  await setRegionalQcDelegation(db.pool,owner,{email:lead+'@example.invalid',team:'south',enabled:true,reason:'Test expiration and reassignment boundaries'});await db.pool.query("UPDATE operations_board_qc_delegations SET expires_at=now()-interval '1 second' WHERE user_id=$1",[lead]);assert.equal((await repo.sites(lead)).access.qcDelegated,false);
  await db.pool.query('UPDATE operations_board_qc_delegations SET expires_at=NULL WHERE user_id=$1',[lead]);await db.pool.query("UPDATE operations_board_access SET team='central' WHERE user_id=$1",[lead]);assert.equal((await repo.sites(lead)).access.qcDelegated,false);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM stock_on_hand_entries')).rows[0].n,0);
 }finally{await db.close();await rm(old,{recursive:true,force:true});}
});
