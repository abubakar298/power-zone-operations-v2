import {test} from 'node:test';import assert from 'node:assert/strict';
import {inventoryOperationsBatches} from '../server/inventory/operations-batches.js';
test('Inventory receives only current delivery stops with exact approved links and explicit holds',()=>{
 const stops=['ready','install','both','held','sale','returned','done','other'].map((siteId,n)=>({siteId,kind:siteId==='install'?'labour':siteId==='both'?'both':'delivery',plannedDate:'2026-11-02',order:n+1}));
 const snapshot={id:'batch',number:'OPB',deliveryDate:'2026-11-01',team:'central',kind:'both',vehicle:'Vehicle',driver:'Driver',stops};
 const boards=stops.map(stop=>({site_id:stop.siteId,snapshot:{id:stop.siteId,name:stop.siteId,ipo:stop.siteId,stage:'received',operationsTeam:stop.siteId==='other'?'south':'central',completed:stop.siteId==='done',planningBatches:stop.siteId==='returned'?[]:[snapshot]}}));
 const sources=['ready','both','sale'].map(id=>({registeredSiteId:id,siteId:'ipo-'+id,authorization:'approved-ipo-boq',installation:id!=='sale'})) as any;
 const result=inventoryOperationsBatches([{version:2,snapshot}],boards,sources);assert.deepEqual(result[0].stops.map(stop=>[stop.boardSiteId,stop.status]),[['ready','ready'],['both','ready'],['held','approved-boq-required'],['sale','fixed-only']]);assert.equal(result[0].stops[0].date,'2026-11-01');assert.equal(result[0].version,2);assert.equal(result[0].stops[0].siteId,'ipo-ready');
 const duplicate=inventoryOperationsBatches([{version:2,snapshot}],boards,[...sources,sources[0]]);assert.equal(duplicate[0].stops[0].status,'approved-boq-required','ambiguous links never guessed');assert.equal(snapshot.stops.length,8,'read projection changes no route records');
});
