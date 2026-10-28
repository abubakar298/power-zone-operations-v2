import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowSiteSchema} from '../server/operations-board/workflow.js';
import {siteDelays,activeSiteAlerts} from '../server/operations-board/delays.js';
const site=(extra:object={})=>workflowSiteSchema.parse({id:'safe',ipo:'IPO-safe',name:'Safe site',stage:'delivered',installation:true,projectType:'ups',deliveryDate:'2026-01-01',...extra});
test('blank historical date cells remain unknown and cannot break the whole alert register',()=>{
 const original={id:'pending',ipo:'IPO-pending',name:'Pending imported site',stage:'received',installation:true,projectType:'ups',deliveryDate:'',dispatchDate:''};
 const pending=workflowSiteSchema.parse(original);assert.equal(pending.deliveryDate,undefined);assert.equal(pending.dispatchDate,undefined);assert.equal(original.deliveryDate,'');
 assert.deepEqual(activeSiteAlerts([pending],{awaiting:{amount:1,unit:'days'},'ups:job':{amount:3,unit:'hours'}},'2026-10-27T00:00:00Z'),[]);
 assert.throws(()=>workflowSiteSchema.parse({...original,deliveryDate:'not-a-date'}));
});
test('date-only stage clocks use latest possible start and missing timestamps remain unknown',()=>{
 const now='2026-01-02T20:00:00Z',rows=siteDelays(site(),{'ups:job':{amount:1,unit:'days'}},now);
 assert.equal(rows.length,1);assert.equal(rows[0].due,'2026-01-02T18:59:59.000Z');assert.match(rows[0].basis,/date only/);
 assert.deepEqual(siteDelays(site({stage:'received',deliveryDate:undefined}),{received:{amount:1,unit:'hours'}},now),[]);
});
test('completed work submitted to Accounts creates no stale document delay',()=>{
 const value=site({completed:true,documentsSubmittedToAccounts:true,documents:[{id:'originals',label:'Signed handover',location:'At site',date:'2026-01-01',history:[],evidence:[]}]});
 assert.deepEqual(siteDelays(value,{documents:{amount:1,unit:'hours'}},'2026-01-04T00:00:00Z'),[]);
});
test('a blocker enriches the same overdue site alert instead of creating a second card',()=>{
 const value=site({blockers:[{id:'blocked',reason:'Customer site is not ready for installation',stage:'UPS job completion',status:'open',raisedAt:'2026-01-02T00:00:00Z',raisedBy:'Owner',actorId:'fixture'}]});
 const alerts=activeSiteAlerts([value],{'ups:job':{amount:1,unit:'days'}},'2026-01-04T00:00:00Z');assert.equal(alerts.length,1);assert.equal(alerts[0].blockers.length,1);assert.equal(alerts[0].delays.length,1);
});

test('completed and submitted sites retain old blocker history without an active alert',()=>{
 const value=site({completed:true,documents:[{id:'signed',label:'Signed documents',location:'Submitted to Accounts',date:'2026-01-02',history:[],evidence:[]}],blockers:[{id:'old',reason:'Customer not ready',stage:'UPS job completion',status:'open',raisedAt:'2026-01-01',raisedBy:'Owner',actorId:'fixture'}]});
 assert.equal(activeSiteAlerts([value],{'ups:job':{amount:1,unit:'hours'}},'2026-01-04T00:00:00Z').length,0);assert.equal(value.blockers.length,1);
});
