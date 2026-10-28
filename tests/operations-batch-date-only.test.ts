import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {batchSchema} from '../server/operations-board/schema.js';
import {validateBatch,type BatchSnapshot} from '../server/operations-board/batches.js';
const sites:any[]=['one','two'].map(id=>({id,name:id,stage:'delivered',installation:true,completed:false,deliveryDate:'2026-10-27',operationsTeam:'central'}));
const input=()=>batchSchema.parse({version:0,requestKey:randomUUID(),team:'central',kind:'labour',labourTeam:'pz-team',stops:sites.map((site,n)=>({siteId:site.id,siteVersion:1,order:n+1,plannedDate:'2026-10-28'}))});
test('delivered installation sites share a date-only route without times or delivery vehicle',()=>{
 const value=input(),stops=validateBatch(value,sites,[]);assert.equal(stops.length,2);assert.ok(stops.every(s=>s.start===''&&s.end===''));assert.equal(value.vehicle,'');
 assert.throws(()=>validateBatch(value,[{...sites[0],completed:true},sites[1]],[]),/not eligible/);
 assert.throws(()=>validateBatch({...value,kind:'delivery',vehicle:'V',driver:'D'},sites,[]),/not eligible/);
 assert.throws(()=>validateBatch({...value,stops:value.stops.map(s=>({...s,plannedDate:'2026-10-26'}))},sites,[]),/before delivery/);
});
test('date-only routes preserve date ordering and shared-resource conflicts with timed legacy bookings',()=>{
 const value=input();const booked={...value,id:randomUUID(),number:'OLD',createdAt:'',updatedAt:'',plannedBy:'',stops:value.stops.map((s,n)=>({...s,start:n?'11:00':'08:00',end:n?'12:00':'10:00'}))} as BatchSnapshot;
 assert.throws(()=>validateBatch(value,sites,[booked]),/already booked/);
 const next={...value,stops:value.stops.map(s=>({...s,plannedDate:'2026-10-29'}))};assert.equal(validateBatch(next,sites,[booked]).length,2);
 assert.throws(()=>validateBatch({...value,stops:[{...value.stops[0],plannedDate:'2026-10-29'},value.stops[1]]},sites,[]),/route order/);
 assert.throws(()=>validateBatch({...value,stops:value.stops.map(s=>({...s,start:'08:00'}))},sites,[]),/both optional/);
});

test('UPS dispatch needs electrical and delivery assignments, not earthing',async()=>{
 const {saveDispatchPlan}=await import('../server/operations-board/workflow.js');
 const site:any={id:'ups-plan',name:'UPS',stage:'received',installation:true,projectType:'ups',operationsTeam:'central',accounts:[],history:[]};
 const plan={dispatchDate:'2026-10-29',assignments:{electrical:'pz-team',delivery:'delivery-vendor'}};
 const saved=saveDispatchPlan(site,plan,'2026-10-28T10:00:00Z');assert.equal(saved.stage,'awaiting');assert.equal(saved.assignments?.earthing,undefined);
 assert.throws(()=>saveDispatchPlan({...site,projectType:'solar'}, {...plan,assignments:{...plan.assignments,structure:'structure-vendor'}},'2026-10-28T10:00:00Z'),/vendor assignments/);
});
