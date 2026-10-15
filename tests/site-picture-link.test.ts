import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sitePictureFolder} from '../server/project-workflow/site-picture-link.js';
import {testDatabase} from './database.js';
import {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';

test('site media accepts Drive folder references without fetching media or accepting executable URLs',()=>{
  assert.equal(sitePictureFolder(' https://drive.google.com/drive/folders/site_123?usp=sharing '),'https://drive.google.com/drive/folders/site_123');
  assert.equal(sitePictureFolder('https://drive.google.com/drive/u/0/folders/site_123'),'https://drive.google.com/drive/folders/site_123');
  for(const value of ['javascript:alert(1)','http://drive.google.com/drive/folders/a','https://drive.google.com.evil.test/drive/folders/a','https://user@drive.google.com/drive/folders/a','https://drive.google.com/file/d/a/view','not a url'])assert.throws(()=>sitePictureFolder(value));
});

test('site folder reference is versioned, audited and restricted to the receiving Design department',async()=>{
  const db=await testDatabase();try{
    const coordinator=randomUUID(),designer=randomUUID();
    for(const [id,role] of [[coordinator,'Coordinator'],[designer,'Design']])await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Disposable link test','test',$3)",[id,id+'@example.test',role]);
    const repo=new ProjectWorkflowRepository(db.pool);
    const record=await repo.create(coordinator,{requestKey:randomUUID(),customerId:5,siteName:'Disposable link-only media',siteCode:'LINK-TEST',route:'survey-framework',notes:'Disposable test'});
    await db.pool.query("UPDATE project_workflow_records SET stage='report_received',technical_owner_id=$2 WHERE id=$1",[record.id,designer]);
    const version=(await db.pool.query('SELECT version FROM project_workflow_records WHERE id=$1',[record.id])).rows[0].version;
    const command={action:'save-site-picture-link',version,requestKey:randomUUID(),input:{url:'https://drive.google.com/drive/folders/site_123'}};
    await assert.rejects(repo.action(coordinator,record.id,command),/with Design|department/);
    await repo.action(designer,record.id,command);
    const saved=(await db.pool.query('SELECT stage,version,data FROM project_workflow_records WHERE id=$1',[record.id])).rows[0];
    assert.equal(saved.stage,'report_received');assert.equal(saved.version,version+1);
    assert.equal(saved.data.sitePictureFolder.url,command.input.url);assert.equal(saved.data.sitePictureFolder.savedBy,designer);
    assert.equal((await repo.detail(designer,record.id)).record.data.sitePictureFolder.url,command.input.url);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM project_workflow_files WHERE record_id=$1',[record.id])).rows[0].n,0);
    assert.equal((await db.pool.query("SELECT count(*)::int n FROM project_workflow_events WHERE record_id=$1 AND action='save-site-picture-link'",[record.id])).rows[0].n,1);
    await assert.rejects(repo.action(designer,record.id,{...command,requestKey:randomUUID()}),/changed/);
  }finally{await db.close();}
});
