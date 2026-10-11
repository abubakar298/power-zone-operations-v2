import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {testDatabase} from './database.js';
import {migrate} from '../server/db/migrate.js';
import {UblRepository} from '../server/ubl/repository.js';
import {ublIpoSample} from '../server/ubl/ipo-sample.js';
import {ublIpoSamplePdf} from '../server/ubl/ipo-sample-report.js';

test('36 immutable historical IPO/PT registrations reconcile and preserve exceptions without workflow handoffs',async()=>{
 const db=await testDatabase();try{
  const actor=randomUUID(),coord=randomUUID();
  for(const [id,role] of [[actor,'Management'],[coord,'Coordinator']])await db.pool.query('INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,`${id}@example.test`,role,'fixture-only',role]);
  const repo=new UblRepository(db.pool),sites=await repo.sites(actor);
  assert.equal(sites.filter(s=>s.document_version===1).length,36);
  for(const site of sites){
   if(site.status!=='Active'){await assert.rejects(repo.document(actor,site.site_id),/No registered/);continue;}
   const {snapshot:s}=await repo.document(actor,site.site_id);
   assert.equal(s.po_number,site.po_number);assert.equal(s.legacy_ipo_number,site.legacy_ipo_number);
   assert.equal(s.agreedWatts,Number(site.configuration_id.split('-')[0])*1000);
   const p=ublIpoSample({...s,status:'Active',documentStatus:s.status});
   assert.equal(p.totalPayable,new Decimal(site.baseline.sellingIncludingGst).toFixed(2));
   assert.equal(p.phases.reduce((v,x)=>v.add(x.sellingExcludingGst),new Decimal(0)).toFixed(2),p.totalSellingExcludingGst);
   assert.equal(p.phases.reduce((v,x)=>v.add(x.payable),new Decimal(0)).toFixed(2),p.totalPayable);
   assert.equal(p.billing[0].sellingExcludingGst,new Decimal(s.agreedWatts).mul(s.panelSellingRate).toFixed(2));
   if(['232','311'].includes(s.legacy_ipo_number)){assert.equal(s.panelSellingRate,33);assert.equal(s.budgetSnapshot.panelRate,30);assert.equal(s.pricing_stage,'Negotiated');}
   else assert.equal(s.panelSellingRate,44);
   if(s.legacy_ipo_number==='320')assert.equal(p.phases[1].sellingExcludingGst,'800635.39');
   for(const kind of ['ipo','pt'] as const)assert.match(ublIpoSamplePdf({...p,agreedWatts:s.agreedWatts,panelSellingRate:s.panelSellingRate},kind).subarray(0,8).toString(),/^%PDF-/);
  }
  await assert.rejects(repo.document(coord,sites[0].site_id),/Administrator and Management/);
  await assert.rejects(db.pool.query("UPDATE ubl_site_document_versions SET version=2"),/immutable/);
  await migrate(db.pool);assert.equal((await db.pool.query('SELECT count(*) AS n FROM ubl_site_document_versions')).rows[0].n,'36');
  assert.equal((await db.pool.query('SELECT count(*) AS n FROM customer_purchase_orders')).rows[0].n,'0');
 }finally{await db.close();}
});
