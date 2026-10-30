import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{canRecordSiteDelivery}from'../shared/operations-delivery-ready.js';
import{confirmDelivery,workflowSiteSchema}from'../server/operations-board/workflow.js';
import{OperationsBoardRepository}from'../server/operations-board/repository.js';
import{batchSchema}from'../server/operations-board/schema.js';
import{testDatabase}from'./database.js';
const base={id:'site',name:'Fictional UPS',ipo:'TEST',stage:'received',operationsTeam:'central',installation:true,projectType:'ups'};
const batch={id:'batch',team:'central',kind:'both',deliveryDate:'2026-10-29',stops:[{siteId:'site',kind:'both',plannedDate:'2026-10-30',start:'',end:''}]};
test('only the exact current dated delivery/both stop makes an unadvanced site eligible; no input mutation',()=>{
 const value={...base,planningBatches:[batch]},before=JSON.stringify(value);
 assert.equal(canRecordSiteDelivery(value),true);assert.equal(JSON.stringify(value),before);
 for(const patch of [{planningBatches:[]},{completed:true},{superseded:true},{cancelled:true},{transferred:true},{stage:'delivered'},{planningBatches:[{...batch,deliveryDate:undefined}]},{planningBatches:[{...batch,deliveryDate:'2026-02-30'}]},{planningBatches:[{...batch,team:'south'}]},{planningBatches:[{...batch,cancelled:true}]},{planningBatches:[{...batch,stops:[{...batch.stops[0],siteId:'other'}]}]},{planningBatches:[{...batch,stops:[{...batch.stops[0],kind:'labour'}]}]},{planningBatches:[{...batch,stops:[{...batch.stops[0],cancelled:true}]}]}])assert.equal(canRecordSiteDelivery({...value,...patch}),false,JSON.stringify(patch));
 assert.equal(canRecordSiteDelivery({...base,stage:'awaiting'}),true,'Existing individual dispatch path is retained.');
 assert.equal(canRecordSiteDelivery({...base,planningBatches:[{...batch,kind:'delivery',stops:[{...batch.stops[0],kind:undefined}]}]}),true);
 const photo={id:randomUUID(),name:'material.png',mediaType:'image/png'},signed={id:randomUUID(),name:'signed.pdf',mediaType:'application/pdf'};
 const site=workflowSiteSchema.parse(value),out=confirmDelivery(site,{deliveryDate:'2026-10-29',signedDo:signed,materialPhoto:photo,partial:false},'2026-10-30T00:00:00Z');
 assert.equal(out.stage,'delivered');assert.equal(out.completed,false);assert.equal(out.deliveries!.length,1);assert.equal(out.planningBatches[0].deliveryDate,batch.deliveryDate);assert.equal(site.stage,'received');
 const partial=confirmDelivery(site,{deliveryDate:'2026-10-29',signedDo:signed,materialPhoto:photo,partial:true},'2026-10-30T00:00:00Z');assert.equal(partial.stage,'awaiting');assert.equal(partial.partial,true);
});
test('regional QC can record a batch-scheduled UPS delivery with the existing signed DO/photo requirements; cancellation and replay stay enforced',async()=>{
 const db=await testDatabase();try{
  const owner=randomUUID(),qc=randomUUID(),south=randomUUID();
  for(const[id,role]of[[owner,'Admin'],[qc,'Operations'],[south,'Operations']])await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@example.test',role,role,'isolated']);
  for(const[id,team]of[[qc,'central'],[south,'south']])await db.pool.query("INSERT INTO operations_board_access(user_id,kind,team,granted_by) VALUES($1,'qc',$2,$3)",[id,team,owner]);
  const repo=new OperationsBoardRepository(db.pool);await repo.importSource(owner,{sourceSha256:'d'.repeat(64),rows:['site','cancelled'].map(id=>({...base,id}))});
  const planned=await repo.saveBatch(owner,batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'both',deliveryDate:'2026-10-29',vehicle:'Fictional route',driver:'Fictional driver',labourTeam:'pz-team',stops:['site','cancelled'].map((siteId,n)=>({siteId,siteVersion:1,order:n+1,kind:'both',plannedDate:'2026-10-30'}))}));
  assert.equal((await repo.site(qc,'site')).stage,'received','Scheduling still does not rewrite the stored stage.');
  await repo.saveBatch(owner,batchSchema.parse({id:planned.id,team:planned.team,kind:planned.kind,deliveryDate:planned.deliveryDate,vehicle:planned.vehicle,driver:planned.driver,labourTeam:planned.labourTeam,inventoryReference:planned.inventoryReference,version:1,requestKey:randomUUID(),edit:true,reason:'Customer postponed the second site',stops:[{...planned.stops[0],siteVersion:2}],cancelledSites:[{siteId:'cancelled',siteVersion:2}]}));
  const upload=async(siteId:string)=>{const doc=await repo.upload(qc,siteId,{filename:'signed.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 fictional delivery evidence').toString('base64')}),photo=await repo.upload(qc,siteId,{filename:'material.png',mediaType:'image/png',base64:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')});return{signedDoId:doc.id,materialPhotoId:photo.id};};
  const files=await upload('site'),cancelledFiles=await upload('cancelled');
  const current=await repo.site(qc,'site'),command={action:'delivery' as const,version:current.version,requestKey:randomUUID(),deliveryDate:'2026-10-29',partial:false,...files};
  await assert.rejects(repo.command(south,'site',command),/not found/);
  await assert.rejects(repo.command(qc,'site',{...command,materialPhotoId:files.signedDoId}),/photo/);
  await assert.rejects(repo.command(qc,'site',{...command,deliveryDate:'2099-01-01'}),/future/);
  const cancelled=await repo.site(qc,'cancelled');assert.equal(canRecordSiteDelivery(cancelled),false);await assert.rejects(repo.command(qc,'cancelled',{...command,...cancelledFiles,version:cancelled.version,requestKey:randomUUID()}),/dispatch plan/);
  const original=(await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1 AND version=$2',['site',current.version])).rows[0].snapshot;
  const saved=await repo.command(qc,'site',command);assert.equal(saved.stage,'delivered');assert.equal(saved.deliveries!.length,1);assert.equal(saved.documents.at(-1)?.label,'Delivery DO');assert.equal(saved.installationPlanDate,'2026-10-30');
  assert.equal((await repo.command(qc,'site',command)).version,saved.version);await assert.rejects(repo.command(qc,'site',{...command,requestKey:randomUUID()}),/updated/);
  assert.deepEqual((await db.pool.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1 AND version=$2',['site',current.version])).rows[0].snapshot,original);
  for(const table of['stock_on_hand_entries','inventory_warehouse_operational_movements','accounts_invoice_entries','accounts_payment_records'])assert.equal((await db.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
 }finally{await db.close();}
});
