import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import request from 'supertest';
import {testDatabase} from './database.js';
import {workflowSiteSchema} from '../server/operations-board/workflow.js';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {commandSchema,targetStageIds,type BoardCommand} from '../server/operations-board/schema.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {digest} from '../server/auth/crypto.js';

test('Operations planning, UPS/Solar/BESS QC, blockers and corrections preserve handoffs and enforce scoped evidence/roles',async()=>{
 const db=await testDatabase();try{
  const users:Record<string,string>={};for(const [name,role] of [['owner','Admin'],['head','Operations'],['lead','Operations'],['qc','Operations'],['south','Operations'],['accounts','Accounts'],['inventory','Inventory']]){
   const id=users[name]=randomUUID();await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',name,role,'isolated']);
  }
  for(const [name,kind,team] of [['head','head',null],['lead','lead','central'],['qc','qc','central'],['south','qc','south']])await db.pool.query('INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,$2,$3,$4)',[users[name!],kind,team,users.owner]);
  const repo=new OperationsBoardRepository(db.pool);
  const rows=['ups','solar-bess','bess','delivery-only'].map(type=>({id:type,ipo:'IPO-'+type,name:'Safe '+type,stage:'received' as const,installation:type!=='delivery-only',projectType:type as 'ups'|'solar-bess'|'bess'|'delivery-only',completed:false}));
  await repo.importSource(users.owner,{sourceSha256:'a'.repeat(64),rows:[...rows,{id:'unknown',ipo:'IPO-unknown',name:'Unknown scope',stage:'received',installation:null,projectType:null,scopePending:true}]});
  const command=async(name:string,id:string,value:Record<string,unknown>)=>repo.command(users[name],id,commandSchema.parse({version:(await repo.site(users.owner,id)).version,requestKey:randomUUID(),...value}));
  await assert.rejects(command('lead','ups',{action:'assign-team',team:'central'}),/not found|Only Moaz/);
  for(const row of [...rows,{id:'unknown'}])await command('head',row.id,{action:'assign-team',team:'central'});
  const vendor=await repo.saveVendor(users.lead,{version:0,requestKey:randomUUID(),kind:'vendor',name:'Installation vendor',phone:'',roles:['structure','electrical','earthing','delivery'],active:true,reason:''});
  const assignments={structure:vendor.id,electrical:'pz-team',earthing:vendor.id,delivery:vendor.id};
  await assert.rejects(repo.saveVendor(users.qc,{version:0,requestKey:randomUUID(),kind:'vendor',name:'Forbidden',phone:'',roles:['delivery'],active:true,reason:''}),/Operations lead/);
  await assert.rejects(command('qc','ups',{action:'plan',dispatchDate:'2026-01-01',assignments}),/Operations lead/);
  await assert.rejects(command('lead','unknown',{action:'plan',dispatchDate:'2026-01-01',assignments}),/scope/);
  await assert.rejects(command('lead','ups',{action:'plan',dispatchDate:'2026-01-01',assignments:{delivery:'pz-team',electrical:'pz-team',earthing:vendor.id}}),/active vendor/);
  for(const row of rows)await command('lead',row.id,{action:'plan',dispatchDate:'2026-01-01',assignments:row.projectType==='ups'?{electrical:'pz-team',delivery:vendor.id}:row.installation?assignments:{delivery:vendor.id}});
  await assert.rejects(command('lead','ups',{action:'plan',dispatchDate:'2026-01-02',assignments}),/locked/);
  await assert.rejects(command('lead','ups',{action:'plan',dispatchDate:'2026-01-02',assignments,edit:true}),/reason/);
  const fixed=await command('lead','ups',{action:'plan',dispatchDate:'2026-01-02',assignments:{electrical:'pz-team',earthing:vendor.id,delivery:vendor.id},edit:true,reason:'Vehicle rescheduled'});
  assert.equal(fixed.dispatchDate,'2026-01-02');await assert.rejects(command('lead','ups',{action:'plan',dispatchDate:'2026-01-02',assignments:{electrical:'pz-team',earthing:vendor.id,delivery:vendor.id},edit:true,reason:'No actual changes'}),/Nothing changed/);
  const files:Record<string,{pdf:string;photo:string;vso:string}>={};
  for(const row of rows){
   const pdf=await repo.upload(users.qc,row.id,{filename:'signed.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7\nfixture '+row.id).toString('base64')});
   const photo=await repo.upload(users.qc,row.id,{filename:'photo.png',mediaType:'image/png',base64:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')});const vso=await repo.upload(users.qc,row.id,{filename:'variable-signoff.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 variable '+row.id).toString('base64')});files[row.id]={pdf:pdf.id,photo:photo.id,vso:vso.id};
  }
  await assert.rejects(command('qc','ups',{action:'delivery',deliveryDate:'2026-01-02',signedDoId:files.bess.pdf,materialPhotoId:files.ups.photo}),/different site/);
  await assert.rejects(command('qc','ups',{action:'delivery',deliveryDate:'2026-01-02',signedDoId:files.ups.pdf,materialPhotoId:files.ups.pdf}),/photo/);
  const partial=await command('qc','ups',{action:'delivery',deliveryDate:'2026-01-02',signedDoId:files.ups.pdf,materialPhotoId:files.ups.photo,partial:true});assert.equal(partial.stage,'awaiting');assert.equal(partial.completed,false);
  await command('qc','solar-bess',{action:'delivery',deliveryDate:'2026-01-02',signedDoId:files['solar-bess'].pdf,materialPhotoId:files['solar-bess'].photo,partial:true});
  const partialQc=await command('qc','solar-bess',{action:'qc',stageId:'civil',date:'2026-01-02',evidenceIds:[files['solar-bess'].photo]});
  assert.equal(partialQc.stage,'awaiting');assert.equal(partialQc.completed,false);
  assert.equal(partialQc.accounts?.some((event:any)=>event.type==='Installation completed'||event.type==='Delivery invoice due'),false);
  for(const row of rows)await command('qc',row.id,{action:'delivery',deliveryDate:'2026-01-03',signedDoId:files[row.id].pdf,materialPhotoId:files[row.id].photo});
  assert.equal((await repo.site(users.owner,'delivery-only')).completed,true);
  const upsDeliveries=await repo.site(users.owner,'ups');assert.equal(new Set(upsDeliveries.documents?.map(d=>d.id)).size,2,'partial and final deliveries stay distinct even when a combined PDF is reused');
  const upsEntry={stagePictureIds:{mounting:[files.ups.photo],electrical:[files.ups.photo],testingTraining:[files.ups.photo]},action:'ups-job',date:'2026-01-04',evidenceIds:[files.ups.photo],acknowledgementId:files.ups.pdf,irrId:files.ups.pdf,variableSignoffId:files.ups.vso,checks:{mounting:true,electrical:true,testingTraining:true,signoff:true}};
  await assert.rejects(command('lead','ups',upsEntry),/QC team/);await assert.rejects(command('south','ups',upsEntry),/not found/);
  await assert.rejects(command('qc','ups',{...upsEntry,checks:{...upsEntry.checks,mounting:false}}),/Confirm system/);
  const version=(await repo.site(users.owner,'ups')).version,requestKey=randomUUID(),body=commandSchema.parse({version,requestKey,...upsEntry});
  const done=await repo.command(users.qc,'ups',body);assert.equal(done.completed,true);assert.equal((await repo.command(users.qc,'ups',body)).version,done.version);
  await assert.rejects(command('qc','ups',upsEntry),/locked/);
  await assert.rejects(command('qc','ups',{action:'qc',stageId:'civil',date:'2026-01-04',evidenceIds:[files.ups.photo]}),/single date/);
  const jobs=[['solar-bess',['civil','electrical','testing','signoff']],['bess',['cabinet','panel','bessTesting','handover']]] as const;
  for(const [id,stages] of jobs){
   if(id!=='solar-bess')await assert.rejects(command('qc',id,{action:'qc',stageId:stages[1],date:'2026-01-04',evidenceIds:[files[id].photo]}),/earlier QC/);
   for(const stageId of stages.filter(stage=>id!=='solar-bess'||stage!=='civil'))await command('qc',id,{action:'qc',stageId,date:'2026-01-04',evidenceIds:[files[id].photo],...(stageId===stages[3]?{acknowledgementId:files[id].pdf,irrId:files[id].pdf,variableSignoffId:files[id].vso}:{})});
   assert.equal((await repo.site(users.owner,id)).completed,true);
  }
  const beforeCorrection=workflowSiteSchema.parse(await repo.site(users.owner,'bess'));
  await command('qc','bess',{action:'qc',stageId:'cabinet',date:'2026-01-03',evidenceIds:[files.bess.photo],edit:true,reason:'Correct actual placement date'});
  assert.equal(workflowSiteSchema.parse(await repo.site(users.owner,'bess')).stageStartedAt,beforeCorrection.stageStartedAt,'editing previous QC cannot restart the current stage clock');
  const blocked=await command('qc','ups',{action:'blocker',text:'Customer document pending'});assert.equal(blocked.blockers.length,1);
  await assert.rejects(command('qc','ups',{action:'blocker',text:'Customer document pending'}),/already recorded/);
  await command('qc','ups',{action:'resolve-blocker',blockerId:blocked.blockers[0].id,resolution:'Documents collected'});
  const changeHistory=await repo.history(users.head,'ups');assert.ok(changeHistory.versions.some(r=>r.reason==='Vehicle rescheduled'));await assert.rejects(repo.history(users.accounts,'ups'),/tracking only/);
  const docs=await repo.physicalDocuments(users.accounts);assert.equal(docs.sites.find(s=>s.id==='ups')!.documents.some((d:any)=>d.label.includes('Acknowledgement')),true);
  const events=(await db.pool.query("SELECT kind,audiences FROM operations_board_events WHERE site_id='ups'")).rows;assert.equal(events.filter(e=>e.kind==='Installation completed').length,1);assert.ok(events.some(e=>e.kind==='Saved site decision changed'&&e.audiences.includes('management')));
  for(const table of ['internal_purchase_orders','accounts_job_closures','stock_on_hand_entries'])assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
  const targets=Object.fromEntries(targetStageIds.map(id=>[id,null]));
  await assert.rejects(repo.saveTargets(users.lead,{version:0,requestKey:randomUUID(),values:targets as any,reason:''}),/Moaz/);
  const targetSaved=await repo.saveTargets(users.head,{version:0,requestKey:randomUUID(),values:targets as any,reason:''});assert.equal(targetSaved.version,1);await assert.rejects(repo.saveTargets(users.head,{version:1,requestKey:randomUUID(),values:targets as any,reason:'No actual change'}),/No stage targets/);
  await assert.rejects(repo.targets(users.accounts),/tracking only/);
  const origin='http://localhost:3000',app=createApp(db.pool,readConfig({NODE_ENV:'test',APP_ORIGIN:origin,DATABASE_URL:db.url,ADMIN_SETUP_TOKEN:'operations-workflow-isolated-setup-token'}));
  const token=randomBytes(32).toString('base64url'),csrf=randomUUID();await db.pool.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),users.qc,csrf]);
  await request(app).post('/api/operations-board/sites/ups/decisions').set('Cookie','pz_session='+token).set('Origin',origin).send(body).expect(403);
  await request(app).post('/api/operations-board/vendors').set('Cookie','pz_session='+token).set('Origin',origin).set('X-CSRF-Token',csrf).send({version:0,requestKey:randomUUID(),name:'Forbidden',roles:['delivery']}).expect(403);
 }finally{await db.close();}
});
