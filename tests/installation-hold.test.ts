import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dispatchDocumentRows} from '../server/inventory/dispatch-document-status.js';

test('Inventory sees the VSO as not due, with the reason, while installation is held',()=>{
 const site={siteId:'ipo-one',registeredSiteId:'board-one',siteName:'First site',customer:'UBL',ipo:'CHP-1',installation:true};
 const cable={key:'cable',itemId:'CH-CBL-AC',description:'Cable',out:'20',sites:['ipo-one']};
 const dispatch={id:'d1',number:'DO-1',draft_id:'draft',warehouse:'Lahore warehouse',created_at:'2026-11-01T08:00:00Z',snapshot:{parent:false,sites:[site],lines:[cable]}};
 const row=(snapshot:any)=>dispatchDocumentRows([dispatch],[{site_id:'board-one',snapshot:{installation:true,...snapshot}}],[],[],[])[0].sites[0];
 const held=row({installationHold:{kind:'postponed',until:'2026-12-05',reason:'Rain'}});
 assert.equal(held.documents.find(d=>d.label==='Variable Items Sign Off')?.notDue,'Not due · installation postponed to 2026-12-05 · Rain');
 assert.equal(held.usageNote,'Not due · installation postponed to 2026-12-05 · Rain');
 assert.equal(row({}).documents.find(d=>d.label==='Variable Items Sign Off')?.notDue,undefined,'without a hold the VSO is simply awaited');
 assert.equal(row({installationHold:{kind:'cancelled',reason:'x'},qcJob:{date:'2026-12-01'}}).documents.find(d=>d.label==='Variable Items Sign Off')?.notDue,undefined,'finished installation ends the hold');
});

test('cancelling or postponing installation holds the site; planning installation again lifts it',async()=>{
 const [{testDatabase},{OperationsBoardRepository},{batchSchema},{readWorkflowSite}]=await Promise.all([import('./database.js'),import('../server/operations-board/repository.js'),import('../server/operations-board/schema.js'),import('./operations-snapshot.js')]);
 const db=await testDatabase();try{
  const owner=randomUUID();
  await db.pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[owner,owner+'@example.test','Owner','Admin','isolated']);
  const repo=new OperationsBoardRepository(db.pool);
  await repo.importSource(owner,{sourceSha256:'c'.repeat(64),rows:['no-install','later'].map(id=>({id,ipo:id,name:id,stage:'received' as const,projectType:'ups' as const,installation:true,operationsTeam:'central' as const}))});
  const stops=async(kinds:Record<string,{kind:'both'|'delivery';plannedDate:string}>)=>Promise.all(Object.entries(kinds).map(async([siteId,s],n)=>({siteId,siteVersion:(await readWorkflowSite(repo,owner,siteId)).version,order:n+1,...s,start:'',end:''})));
  const plan={team:'central',kind:'both',deliveryDate:'2026-12-01',vehicle:'HOLD-1',driver:'Driver',labourTeam:'pz-team'};
  const saved=await repo.saveBatch(owner,batchSchema.parse({...plan,version:0,requestKey:randomUUID(),stops:await stops({'no-install':{kind:'both',plannedDate:'2026-12-02'},later:{kind:'both',plannedDate:'2026-12-02'}})}));
  await repo.saveBatch(owner,batchSchema.parse({...plan,id:saved.id,version:1,edit:true,requestKey:randomUUID(),reason:'Customer not ready for installation',stops:await stops({'no-install':{kind:'delivery',plannedDate:'2026-12-02'},later:{kind:'both',plannedDate:'2026-12-06'}})}));
  const hold=async(id:string)=>(await readWorkflowSite(repo,owner,id) as any).installationHold;
  assert.deepEqual({...await hold('no-install'),at:undefined},{kind:'cancelled',until:null,batch:saved.number,reason:'Customer not ready for installation',at:undefined});
  assert.equal((await hold('later')).kind,'postponed');assert.equal((await hold('later')).until,'2026-12-06');
  await repo.saveBatch(owner,batchSchema.parse({...plan,id:saved.id,version:2,edit:true,requestKey:randomUUID(),reason:'Installation booked again',stops:await stops({'no-install':{kind:'both',plannedDate:'2026-12-03'},later:{kind:'both',plannedDate:'2026-12-06'}})}));
  assert.equal(await hold('no-install'),undefined,'planning installation again lifts the hold');
  assert.equal((await hold('later')).kind,'postponed','an unrelated edit keeps a postponement');
 }finally{await db.close();}
});
