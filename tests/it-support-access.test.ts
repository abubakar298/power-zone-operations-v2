import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';import request from 'supertest';
import {testDatabase} from './database.js';import {createApp} from '../server/app.js';import {readConfig} from '../server/config.js';import {digest} from '../server/auth/crypto.js';import {supportCostView,supportRequestAllowed} from '../server/http/support-access.js';
test('IT support projection removes nested internal costing and policy inputs while retaining workflow quantities and invoice totals',()=>{
 const input={invoice:{total:'500',number:'INV-1'},usage:{used:'4',actualUsedQty:'4'},budget:{BESS:'101'},actual:{EPC:'102'},history:[{costing:{cost:'103'},profit:'104',markup:'105',policy:{base:'106'}}],boq:{engineering:{pvWatts:'25000'},survey:{},lines:[{itemId:'panel',qty:'4',rate:'107',total:'428'}],total:'428'}};
 assert.equal(supportCostView({lines:[{qty:'2',rate:'99',total:'198'}]}).lines[0].total,null,'ordinary priced rows do not expose cost through extended totals');
 const value=supportCostView(input);assert.equal(value.invoice.total,'500');assert.equal(value.usage.used,'4');assert.equal(value.usage.actualUsedQty,'4');assert.equal(value.boq.lines[0].rate,null);assert.equal(value.boq.total,null);
 for(const secret of ['101','102','103','104','105','106','107','428'])assert.equal(JSON.stringify(value).includes('"'+secret+'"'),false,secret);
 for(const path of ['/api/commercial/standard-policy','/api/accounts-workspace/job?key=one','/api/masters/rates','/api/accounts/users','/api/backups'])assert.equal(supportRequestAllowed(path,'GET'),false,path);
 for(const path of ['/api/operations-board/sites/site','/api/project-workflow/one/actions','/api/material-dispatches','/api/accounts-workspace/invoice-entries'])assert.equal(supportRequestAllowed(path,'POST'),true,path);
});
test('IT support uses audited real staff scopes without gaining Management, costing or account administration',async()=>{
 const db=await testDatabase();try{
 const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'isolated-it-support-department-setup-token'}));
 const ids:Record<string,string>={},cookies:Record<string,string>={},csrf:Record<string,string>={};
 for(const role of ['IT Support','Management','Coordinator','Design','Accounts','Inventory','Employee']){const id=ids[role]=randomUUID(),token=randomBytes(32).toString('base64url');csrf[role]=randomUUID();cookies[role]='pz_session='+token;await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,'isolated',$4)",[id,id+'@example.test',role,role]);await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,csrf[role]]);}
 const support='IT Support';const get=(path:string,role=support,target?:string)=>{const r=request(app).get(path).set('Cookie',cookies[role]);if(target)r.set('X-PZ-Department-User',ids[target]).set('X-PZ-Management-User',ids[role]);return r;};
 const post=(path:string,target?:string)=>{const r=request(app).post(path).set('Origin',origin).set('Cookie',cookies[support]).set('X-CSRF-Token',csrf[support]);if(target)r.set('X-PZ-Department-User',ids[target]).set('X-PZ-Management-User',ids[support]);return r;};
 const users=await get('/api/auth/department-views').expect(200);assert.equal(users.body.users.some((u:any)=>['Admin','Management','IT Support'].includes(u.role)),false);
 const selected=await post('/api/auth/department-view').send({userId:ids.Accounts}).expect(200);assert.equal(selected.body.user.supportAccess,true);assert.equal(selected.body.user.restrictedCostAccess,false);
 await post('/api/auth/department-view').send({userId:ids.Management}).expect(403);
 await get('/api/auth/session').expect(200).expect(r=>assert.equal(r.body.user.role,support));
 for(const target of ['Coordinator','Design','Accounts','Inventory'])await get('/api/dashboard',support,target).expect(200).expect(r=>{assert.equal(r.body.user.id,ids[target]);assert.equal(r.body.user.supportAccess,true);assert.equal(r.body.user.restrictedCostAccess,false);});
 await get('/api/director/portfolio',support,'Accounts').expect(403);
 await get('/api/commercial/standard-policy',support,'Coordinator').expect(403);
 await get('/api/accounts-workspace/job?key=one',support,'Accounts').expect(403);
 await get('/api/accounts/users',support,'Accounts').expect(403);
 await post('/api/masters/customers','Coordinator').send({id:'new',version:0,changeReason:'IT support fixes customer entry',values:{name:'Support fixture customer',short_code:'SUPPORT',contact_person:'',phone:'',email:'',address:'',status:'Active',notes:''}}).expect(200);
 assert.ok((await db.pool.query("SELECT 1 FROM audit_log WHERE user_id=$1 AND action LIKE 'management.department-view:%request-attempt%'",[ids[support]])).rowCount);
 await get('/api/dashboard','Employee','Coordinator').expect(403);
 await db.pool.query('UPDATE users SET active=false WHERE id=$1',[ids[support]]);await get('/api/dashboard',support,'Accounts').expect(401);
 }finally{await db.close();}
});

test('support response boundary cannot expose internal costs through a borrowed Accounts capability or opaque downloads',async()=>{
 const {default:express}=await import('express');const {financialVisibility}=await import('../server/http/cost-visibility.js');const app=express();
 app.use((req,_res,next)=>{req.authSession={user:{id:'support-target',email:'fixture@example.test',display_name:'Accounts',role:'Accounts',supportAccess:true,restrictedCostAccess:true},csrfToken:'isolated',expiresAt:new Date(),tokenHash:'isolated'};next();});
 app.use(financialVisibility);
 app.get('/json',(_req,res)=>res.json({budgetedCost:'secret-cost',profit:'secret-profit',invoice:{number:'INV-1',total:'500'}}));
 app.get('/original',(_req,res)=>res.type('application/pdf').send(Buffer.from('secret-cost-in-original')));
 const value=await request(app).get('/json').expect(200);assert.equal(value.body.budgetedCost,null);assert.equal(value.body.profit,null);assert.equal(value.body.invoice.total,'500');
 const file=await request(app).get('/original').expect(403);assert.equal(file.text.includes('secret-cost-in-original'),false);assert.match(file.body.message,/restricted for IT Support/);
});
