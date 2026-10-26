import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './database.js';
import {exportBackup,decodeBackup} from '../server/backups/archive.js';

test('backup streams large existing JSON fields without database row_to_json and retains exact timestamp, numeric and binary text',async()=>{
  const db=await testDatabase();try{
    await db.pool.query('CREATE TABLE backup_precision_fixture(id bigint, amount numeric(30,12), at timestamptz, payload jsonb, content bytea)');
    const payload={text:'preserved archive '.repeat(250000),nested:{approved:true}};
    const bytes=Buffer.from([0,255,128,65,10]);
    await db.pool.query("INSERT INTO backup_precision_fixture VALUES(9007199254740993,123456789012345678.123456789012,'2026-10-15 01:02:03.123456+00',$1,$2)",[payload,bytes]);
    const archive=await exportBackup(db.pool,'isolated-large-row-backup-passphrase');
    try{
      const lines=await decodeBackup(archive.path,'isolated-large-row-backup-passphrase');
      const row=JSON.parse(lines.find(line=>line.startsWith('{"table":"backup_precision_fixture"'))!).row;
      assert.equal(row.id,'9007199254740993');assert.equal(row.amount,'123456789012345678.123456789012');
      assert.match(row.at,/03\.123456/);assert.deepEqual(row.payload,payload);assert.equal(row.content,'\\x'+bytes.toString('hex'));
      await db.pool.query('CREATE TABLE backup_precision_restored (LIKE backup_precision_fixture)');
      await db.pool.query('INSERT INTO backup_precision_restored SELECT * FROM jsonb_populate_record(NULL::backup_precision_restored,$1::jsonb)',[row]);
      assert.equal((await db.pool.query('SELECT (SELECT md5(row_to_json(t)::text) FROM backup_precision_fixture t)=(SELECT md5(row_to_json(t)::text) FROM backup_precision_restored t) AS equal')).rows[0].equal,true);
    }finally{await archive.cleanup();}
  }finally{await db.close();}
});
