import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,cp,rm,readdir} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import {testDatabase} from './database.js';import {migrate} from '../server/db/migrate.js';
test('handoff-only migration preserves every existing table row and starts without active recipients',async()=>{
 const db=await testDatabase({skipMigrations:true}),dir=await mkdtemp(join(tmpdir(),'pz-handoff-baseline-')),upgrade=await mkdtemp(join(tmpdir(),'pz-handoff-upgrade-'));try{
 // Reconstruct the pre-handoff baseline, then apply only the historical
 // 139–143 release and its prerequisites. Later notification rewrites are separate migrations.
 for(const file of await readdir('migrations'))if(file.endsWith('.sql')){const number=Number(file.split('_')[0]);if(number<139)await cp(join('migrations',file),join(dir,file));if(number<=143)await cp(join('migrations',file),join(upgrade,file));}
 await migrate(db.pool,dir);const id=randomUUID();await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'preserved@example.test','Preserved owner','Management','isolated')",[id]);
 await db.pool.query("INSERT INTO operations_board_sites(id,created_by) VALUES('preserved-site',$1)",[id]);await db.pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES('preserved-site',1,$1,'Source imported','Preserved evidence',$2,$3)",[{id:'preserved-site',name:'Preserved site',ipo:'UNCHANGED',documents:[{id:'original',label:'Original signed record'}]},randomUUID(),id]);
 const tables=(await db.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN('schema_migrations','notification_types') ORDER BY tablename")).rows.map(r=>r.tablename);
 const snapshot=async()=>{const result:any={};for(const table of tables)result[table]=(await db.pool.query(`SELECT count(*)::text n,md5(coalesce(string_agg(h,'' ORDER BY h),'')) digest FROM(SELECT md5(to_jsonb(t)::text) h FROM "${table}" t) rows`)).rows[0];return result;};
 const before=await snapshot(),types=(await db.pool.query('SELECT * FROM notification_types ORDER BY kind')).rows;
 await migrate(db.pool,upgrade,true);assert.deepEqual(await snapshot(),before);
 assert.deepEqual((await db.pool.query('SELECT * FROM notification_types WHERE kind=ANY($1::text[]) ORDER BY kind',[types.map(t=>t.kind)])).rows,types);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM workflow_handoff_policy_versions')).rows[0].n,0);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM workflow_handoff_events')).rows[0].n,0);
 }finally{await db.close();await rm(dir,{recursive:true,force:true});await rm(upgrade,{recursive:true,force:true});}
});
