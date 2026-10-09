import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {createDashboardSamples} from '../server/coordinator/samples.js';
import {CoordinatorRepository} from '../server/coordinator/repository.js';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest,newToken} from '../server/auth/crypto.js';
test('project metadata/history preserves ownership, exact versions, chronological events and financial privacy',async()=>{
 const db=await testDatabase();try{
 const owner=randomUUID(),admin=randomUUID(),other=randomUUID(),department=randomUUID();const cookies:Record<string,string>={};
 for(const [id,role] of [[owner,'Coordinator'],[admin,'Admin'],[other,'Coordinator'],[department,'Operations']]){const token=newToken();await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'test-only',$4)",[id,`${id}@example.test`,role,role]);await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,randomUUID()]);cookies[id]=`pz_session=${token}`;}
 await createDashboardSamples(db.pool,owner,admin);
 const repo=new CoordinatorRepository(db.pool);const catalog=await repo.projects(owner);assert.ok(catalog.documents.length>=20);assert.equal((await repo.projects(other)).documents.length,0);
 const first=catalog.documents.find(d=>d.resource==='ipo');assert.ok(first);const project=await repo.project(owner,first.project_key);
 assert.ok(project.documents.some(d=>d.resource==='quotation'));assert.ok(project.documents.some(d=>d.resource==='boq'));assert.ok(project.documents.some(d=>d.resource==='ipo'));
 assert.ok(project.events.some(e=>e.action==='IPO approved and issued'));assert.ok(project.events.some(e=>e.action==='Approved'));assert.ok(project.events.every(e=>e.actor&&e.document&&e.at));
 for(let i=1;i<project.events.length;i++)assert.ok(new Date(project.events[i].at).getTime()>=new Date(project.events[i-1].at).getTime());
 assert.ok(project.documents.every(d=>!d.pdf_url||d.pdf_url.includes(d.resource==='cni'?d.proposal_id:d.id)));
 assert.doesNotMatch(JSON.stringify(project),/internal_cost_snapshot|private_boq|budgeted_cost|profitPercent|itemPricing|batteryRate|inverterRate|markup|unitCostBeforeTax/);
 await assert.rejects(repo.project(other,first.project_key),/unavailable/);
 const app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'project-test-setup-token-123456789012345678'}));
 await request(app).get('/api/coordinator/projects').expect(401);
 await request(app).get('/api/coordinator/projects').set('Cookie',cookies[department]).expect(403);
 await request(app).get('/api/coordinator/project').set('Cookie',cookies[owner]).expect(400);
 await request(app).get('/api/coordinator/projects').set('Cookie',cookies[owner]).expect(200);
 await request(app).get('/api/coordinator/project').query({key:first.project_key}).set('Cookie',cookies[other]).expect(404);
 await request(app).get('/api/coordinator/project').query({key:first.project_key}).set('Cookie',cookies[owner]).expect(200);
 }finally{await db.close();}
});
