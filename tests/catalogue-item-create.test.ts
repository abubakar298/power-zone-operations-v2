import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {hashPassword} from '../server/auth/crypto.js';
import {testDatabase} from './database.js';
import {MastersRepository} from '../server/masters/repository.js';
test('Coordinator creates descriptive item IDs with duplicate, role and financial protections',async()=>{
 const db=await testDatabase();try{
 const repo=new MastersRepository(db.pool),actor=randomUUID(),design=randomUUID(),password='catalogue-create-test-password';
 for(const [id,role] of [[actor,'Coordinator'],[design,'Design']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$3)',[id,id+'@example.test',role,await hashPassword(password)]);
 const rates=JSON.stringify((await db.pool.query('SELECT * FROM rate_versions ORDER BY key,version')).rows);
 const input={itemId:'TEST-NEW-ITEM',commercialDescription:'New test item',itemGroup:'Cable',unit:'m'};
 await assert.rejects(repo.createCatalogueItem(design,input),/access required/);
 await assert.rejects(repo.createCatalogueItem(actor,{...input,rate:'99'}),/not accepted/);
 const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-catalogue-create-test-setup-only'}));
 const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:actor+'@example.test',password}).expect(200),cookie=login.headers['set-cookie'][0].split(';')[0];
 await request(app).post('/api/masters/catalogue-items').set('Origin',origin).set('Cookie',cookie).send(input).expect(403);
 const response=await request(app).post('/api/masters/catalogue-items').set('Origin',origin).set('Cookie',cookie).set('X-CSRF-Token',login.body.csrfToken).send(input).expect(201);
 assert.equal(response.body.item_id,input.itemId);assert.equal(response.body.rate_key,null);
 assert.equal((await db.pool.query('SELECT item_id FROM inventory_catalogue_final_current WHERE item_id=$1',[input.itemId])).rowCount,1);
 await assert.rejects(repo.createCatalogueItem(actor,{...input,itemId:'test-new-item'}),/already recorded/);
 const existing=(await db.pool.query('SELECT item_id FROM inventory_catalogue_final_current LIMIT 1')).rows[0].item_id;
 await assert.rejects(repo.createCatalogueItem(actor,{...input,itemId:existing}),/already recorded/);
 const attempts=await Promise.allSettled([repo.createCatalogueItem(actor,{...input,itemId:'TEST-CONCURRENT'}),repo.createCatalogueItem(actor,{...input,itemId:'test-concurrent'})]);
 assert.equal(attempts.filter(v=>v.status==='fulfilled').length,1);
 assert.equal(JSON.stringify((await db.pool.query('SELECT * FROM rate_versions ORDER BY key,version')).rows),rates);
 assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit_log WHERE user_id=$1 AND action LIKE 'master.catalogue-item.created:%'",[actor])).rows[0].n,2);
 }finally{await db.close();}
});
