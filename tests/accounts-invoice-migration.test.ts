import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {migrate} from '../server/db/migrate.js';
test('invoice register adds migration 138 after live 139/141 while preserving existing records and notification cutoff',async()=>{
 const db=await testDatabase({skipMigrations:true}),baseline=await mkdtemp(join(tmpdir(),'pz-before-invoice-'));
 try{
 for(const f of await readdir('migrations'))if(f.endsWith('.sql')&&!f.startsWith('138_'))await copyFile(join('migrations',f),join(baseline,f));
 await migrate(db.pool,baseline);
 const owner=randomUUID(),request=randomUUID();
 await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'preserve@example.test','Preserve','Admin','isolated')",[owner]);
 await db.pool.query("INSERT INTO workflow_handoff_policy_versions(version,enabled,activated_at,reviewed_by,request_key,recipients,reason) VALUES(1,true,'2026-10-28T20:27:12.296764Z',$1,$2,'{}','Preservation fixture')",[owner,request]);
 const before=(await db.pool.query('SELECT * FROM workflow_handoff_policy_versions')).rows;
 await migrate(db.pool,resolve('migrations'),true);
 assert.deepEqual((await db.pool.query('SELECT * FROM workflow_handoff_policy_versions')).rows,before);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM accounts_invoice_entries')).rows[0].n,0);
 assert.equal((await db.pool.query("SELECT count(*)::int n FROM schema_migrations WHERE name LIKE '138_%'")).rows[0].n,1);
 await migrate(db.pool,resolve('migrations'),true);
 }finally{await db.close();await rm(baseline,{recursive:true,force:true});}
});
