import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './database.js';
import {MastersRepository} from '../server/masters/repository.js';
import {calculate,calculateTechnicalReview} from '../server/boq/engine.js';
import {designCalculation} from '../server/project-workflow/basis.js';
import {surveySchema} from '../server/boq/schema.js';
test('Design calculation defers every brand without changing commercial validation or approved masters',async()=>{
 const db=await testDatabase();try{
 const masters=await new MastersRepository(db.pool,true).list();
 const before=JSON.stringify(masters);
 const survey=surveySchema.parse({customerId:3,siteName:'Isolated technical review',siteCode:'TECH-ONLY',location:'Lahore',panelQty:60,panelWattage:'645',structure:'Elevated',dcMetres:'360',acInverter16:'15',acInverter25:'0',acPanel16:'0',acPanel25:'20',earth25:'20',earth6:'90',earth10:'90',inverter:'2×15 kW',batteryKwh:40,smartMeter:true,genset:true,brands:{},preparedBy:'Engineer'});
 assert.throws(()=>calculate(survey,masters),/active Solar Panel brand/);
 const result=calculateTechnicalReview(survey,masters);
 assert.deepEqual(result.selectedBrands,{});
 assert.ok(result.lines.length>0);
 assert.ok(result.lines.every(l=>!l.brand));
 assert.ok(result.lines.filter(l=>l.key==='Solar PV Modules'||/Cable/.test(l.key)).every(l=>!l.itemId));
 const profile=masters.engineeringProfiles.find(p=>p.key==='standard-installation')!;
 const workflow=await designCalculation(db.pool,{customer_id:3,site_name:survey.siteName,site_code:survey.siteCode},{survey,profileKey:profile.key,profileVersion:profile.version},'Engineer');
 assert.deepEqual(workflow.boq.selectedBrands,{});
 // Invalid obsolete brand selections cannot block technical submission either.
 assert.doesNotThrow(()=>calculateTechnicalReview({...survey,brands:{solar:999999,inverter:999999,battery:999999,cable:999999,switchgear:999999}},masters));
 assert.equal(JSON.stringify(masters),before);
 }finally{await db.close();}
});
