import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {batchSchema} from '../server/operations-board/schema.js';
import {validateBatch} from '../server/operations-board/batches.js';
const sites:any[]=['one','two'].map(id=>({id,name:id,stage:'delivered',installation:true,completed:false,deliveryDate:'2026-10-27',operationsTeam:'central'}));
const input=(stops:any[]=[{},{}])=>({version:0,requestKey:randomUUID(),team:'central',kind:'labour',labourTeam:'pz-team',stops:sites.map((site,n)=>({siteId:site.id,siteVersion:1,order:n+1,plannedDate:'2026-10-28',...stops[n]}))});

test('each batch site can carry a POC name and number; they are optional and kept with the saved stop',()=>{
 const without=batchSchema.parse(input());
 assert.deepEqual(without.stops.map(s=>[s.pocName,s.pocPhone]),[['',''],['','']],'existing batches without a POC stay valid');
 const value=batchSchema.parse(input([{pocName:'  Ali Raza ',pocPhone:' +92 300-1234567 '},{pocName:'Sana',pocPhone:'(042) 3576 1234'}]));
 assert.deepEqual(value.stops.map(s=>[s.pocName,s.pocPhone]),[['Ali Raza','+92 300-1234567'],['Sana','(042) 3576 1234']]);
 assert.deepEqual(validateBatch(value,sites,[]).map(s=>[s.siteId,s.pocName,s.pocPhone]),[['one','Ali Raza','+92 300-1234567'],['two','Sana','(042) 3576 1234']]);
 assert.equal(batchSchema.safeParse(input([{pocPhone:'call me'},{}])).success,false,'the POC number takes digits, spaces, +, - and brackets only');
 assert.equal(batchSchema.safeParse(input([{pocName:'x'.repeat(201)},{}])).success,false);
});

test('re-saving a batch saved before POC fields existed is still "no change"; changing only a POC is a change',()=>{
 const value=batchSchema.parse(input());
 const legacy={...value,id:randomUUID(),number:'OPB-OLD',createdAt:'',updatedAt:'',plannedBy:'',stops:value.stops.map(({pocName,pocPhone,...stop})=>stop)} as any;
 assert.throws(()=>validateBatch(value,sites,[],legacy),/No batch decisions changed/);
 const withPoc=batchSchema.parse(input([{pocName:'Ali Raza',pocPhone:'03001234567'},{}]));
 assert.equal(validateBatch(withPoc,sites,[],legacy).length,2);
});
