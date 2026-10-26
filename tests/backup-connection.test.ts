import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {exportBackup} from '../server/backups/archive.js';

test('backup connection loss between queries aborts safely and destroys the checked-out client',async()=>{
 const client=new EventEmitter() as any;
 const interrupted=new Error('Connection terminated unexpectedly');
 const queries:string[]=[];
 let released:Error|undefined;
 client.query=async(sql:string)=>{
   queries.push(sql);
   if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
   if(sql.includes('pg_sequences'))setImmediate(()=>client.emit('error',interrupted));
   if(sql==='COMMIT')assert.fail('Interrupted archive must never be committed or returned');
   return {rows:[],rowCount:0};
 };
 client.release=(error?:Error)=>{released=error;};
 await assert.rejects(exportBackup({connect:async()=>client} as any,'isolated-encryption-test-passphrase'),/abort|Connection terminated/i);
 assert.equal(released,interrupted);
 assert.equal(client.listenerCount('error'),0);
 assert.ok(queries.includes('ROLLBACK'));
});
