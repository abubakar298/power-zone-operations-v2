import {closurePvWatts} from '../shared/closure-pv-watts.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {phaseCostComparison,closureEpcSelling} from '../server/accounts/phase-comparison.js';
import {awaitingClosures,pendingTechnicalPackages,pendingBoqReviews} from '../web/workspaces/management-reviews.js';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ClosureComparison} from '../web/components/ClosureComparison.js';
test('Empty Accounts draft costs remain visibly missing without a financial render error',()=>{
 const names=['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];
 const html=renderToStaticMarkup(createElement(ClosureComparison,{job:{selling:'1200',budget:Object.fromEntries(names.map(p=>[p,'100'])),phaseSelling:Object.fromEntries(names.map(p=>[p,'200']))},actual:{},epcAggregate:''}));
 assert.ok(html.includes('Not entered'));
 assert.ok(html.includes('Draft costs are not yet submitted'));
});
test('Phase cost averages exclude missing values, preserve zero and use arithmetic mean',()=>{
 const peers=[{summary:{actual:'100'},input:{actual:{Inverter:'20',BMS:'0'},epcAggregate:'30'}},{summary:{actual:'300'},actualEpc:'50',input:{actual:{Inverter:'60'}}},{summary:{actual:null},input:{actual:{Inverter:'999'}}}];
 const before=JSON.stringify(peers),r=phaseCostComparison(peers);
 assert.equal(r.phases.Inverter.jobs,2);assert.equal(r.phases.Inverter.averageActualCost,'40.00');assert.equal(r.phases.Inverter.averageActualMarkup,null);
 assert.equal(r.phases.BMS.jobs,1);assert.equal(r.phases.BMS.averageActualCost,'0.00');
 assert.equal(r.phases.EPC.jobs,2);assert.equal(r.phases.EPC.averageActualCost,'40.00');
 assert.equal(r.phases.Structure.jobs,0);assert.equal(r.phases.Structure.averageActualCost,null);
 assert.equal(r.total.jobs,2);assert.equal(r.total.averageActualCost,'200.00');
 assert.equal(JSON.stringify(peers),before);
});
test('Dashboard queues require actual submissions and exclude completed or superseded work',()=>{
 assert.equal(awaitingClosures([{stage:'Draft'},{stage:'Awaiting Management'},{stage:'Closed'},{stage:'Returned for Revision'}]).length,1);
 const packages=[{id:'p',status:'Submitted for Management',snapshot:{sites:[{recordId:'a'},{recordId:'b'}]}},{id:'old',status:'Submitted for Management',snapshot:{sites:[{recordId:'a'}]}}];
 const records=[{id:'a',stage:'management_review',version:3,data:{ublSurveyPackageId:'p'}},{id:'b',stage:'approved_dispatch',version:4,data:{ublSurveyPackageId:'p'}}];
 const p=pendingTechnicalPackages(packages,records);assert.equal(p.length,1);assert.deepEqual(p[0].pendingSites,[{recordId:'a',version:3}]);
 assert.equal(pendingBoqReviews([{draft_id:'a',draft_version:1,status:'Awaiting review'},{draft_id:'a',draft_version:2,status:'Approved'}]).length,0);
});

test('one Management card keeps phase comparisons and EPC breakup without adding child costs to totals twice',()=>{
 const names=['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];
 const actual=Object.fromEntries(names.slice(0,5).map(p=>[p,'80']));
 const job={selling:'1200',budget:Object.fromEntries(names.map(p=>[p,'100'])),phaseSelling:Object.fromEntries(names.map(p=>[p,'200'])),epcBudget:{'Electrical Labour':'10','Earthing Cost':'20',Deliveries:'30','Installation Cost':'40'},identity:{configuration_id:'QA'},history:[{stage:'Awaiting Management'}]};
 const epc={'Electrical Labour':'0','Earthing Cost':'10',Deliveries:'30','Installation Cost':'40'},before=JSON.stringify({job,actual,epc});
 const html=renderToStaticMarkup(createElement(ClosureComparison,{job,actual,epcAggregate:'80',epc}));
 assert.equal((html.match(/class="pz-panel /g)??[]).length,1);assert.ok(html.includes('Job cost comparison'));
 for(const name of Object.keys(epc))assert.ok(html.includes(name));
 const total=html.split('<tfoot>')[1].split('</tfoot>')[0];for(const amount of ['1,200.00','600.00','480.00','-120.00','720.00'])assert.ok(total.includes(amount),amount);
 const electrical=html.split('<tr').find(r=>r.includes('Electrical Labour'))!;assert.ok(electrical.includes('0.00'));assert.ok(!electrical.includes('Not entered'));
 assert.equal(JSON.stringify({job,actual,epc}),before);
 const missing=renderToStaticMarkup(createElement(ClosureComparison,{job,actual,epcAggregate:'80',epc:{}}));assert.ok(missing.split('<tr').find(r=>r.includes('Electrical Labour'))!.includes('Not entered'));assert.ok(missing.split('<tfoot>')[1].includes('480.00'));
});

test('EPC selling uses budget weights, keeps zero, preserves pennies and rejects missing/mismatched budgets',()=>{
 const budget={'Electrical Labour':'105000','Earthing Cost':'50000',Deliveries:'105000','Installation Cost':'614800'};
 const r=closureEpcSelling('1018459.68',budget,'874800')!;
 assert.deepEqual(r,{'Electrical Labour':'122243.10','Earthing Cost':'58211.00',Deliveries:'122243.11','Installation Cost':'715762.47'});
 assert.equal(closureEpcSelling('100',{},'100'),null);assert.equal(closureEpcSelling('100',budget,'10'),null);
 const zero=closureEpcSelling('0',budget,'874800')!;assert.ok(Object.values(zero).every(v=>v==='0.00'));
 const explicit={'Electrical Labour':'10','Earthing Cost':'20',Deliveries:'30','Installation Cost':'40'};assert.deepEqual(closureEpcSelling('100',budget,'874800',explicit),Object.fromEntries(Object.entries(explicit).map(([k,v])=>[k,Number(v).toFixed(2)])));
});

test('closed peer averages show monetary markup and cost-weighted percentage, including EPC children and zero costs',()=>{
 const budget=Object.fromEntries(['Electrical Labour','Earthing Cost','Deliveries','Installation Cost'].map(p=>[p,'25']));
 const make=(selling:string,cost:string,epc:Record<string,string>)=>({selling,summary:{selling,actual:cost},phaseSelling:{Inverter:selling,EPC:'200'},budget:{EPC:'100'},epcBudget:budget,input:{actual:{Inverter:cost},epc,epcDetails:true,epcAggregate:Object.values(epc).reduce((a,b)=>a+Number(b),0).toString()}});
 const peers=[make('150','100',{'Electrical Labour':'40','Earthing Cost':'20',Deliveries:'20','Installation Cost':'20'}),make('400','200',{'Electrical Labour':'0','Earthing Cost':'20',Deliveries:'20','Installation Cost':'40'})];
 const before=JSON.stringify(peers),r=phaseCostComparison(peers);
 assert.equal(r.phases.Inverter.averageActualMarkup,'125.00');assert.equal(r.phases.Inverter.averageActualMarkupPercent,'83.33');assert.equal(r.total.averageActualMarkup,'125.00');
 assert.equal(r.epc['Electrical Labour'].markupJobs,2);assert.equal(r.epc['Electrical Labour'].averageActualMarkup,'30.00');assert.equal(r.epc['Electrical Labour'].averageActualMarkupPercent,'150.00');
 assert.equal(JSON.stringify(peers),before);
 const missing=phaseCostComparison([{...peers[0],input:{...peers[0].input,epcDetails:false}}]);assert.equal(missing.epc['Electrical Labour'].averageActualMarkup,null);
 const names=['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];const html=renderToStaticMarkup(createElement(ClosureComparison,{job:{selling:'1200',budget:Object.fromEntries(names.map(p=>[p,'100'])),phaseSelling:Object.fromEntries(names.map(p=>[p,'200'])),epcBudget:budget,phaseCostComparison:r},actual:Object.fromEntries(names.slice(0,5).map(p=>[p,'80'])),epcAggregate:'80',epc:peers[1].input.epc}));
 assert.match(html,/<th>Average markup<\/th>/);const electrical=html.split('<tr').find(row=>row.includes('Electrical Labour'))!;assert.ok(electrical.includes('30.00'));assert.ok(electrical.includes('150%'));assert.ok(electrical.includes('2 closed'));
});


test('Closure per-watt figures use saved PV quantities, preserve totals and leave absent wattage unavailable',()=>{
 assert.deepEqual(closurePvWatts({panelCount:'55',panelWattage:'645',installedWatts:'35000'}),{watts:'35475',basis:'55 panels × 645 W'});
 assert.equal(closurePvWatts({installedWatts:'35475'})?.watts,'35475');
 for(const entry of [{},{panelCount:'0',panelWattage:'645'},{installedWatts:'0'},{installedWatts:'NaN'},{panelCount:'-1',panelWattage:'645'}])assert.equal(closurePvWatts(entry),null);
 const names=['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];
 const job={entry:{panelCount:'10',panelWattage:'500'},selling:'60000',phaseSelling:Object.fromEntries(names.map(p=>[p,'10000'])),budget:Object.fromEntries(names.map(p=>[p,'5000'])),epcBudget:{'Electrical Labour':'1250','Earthing Cost':'1250',Deliveries:'1250','Installation Cost':'1250'}};
 const actual=Object.fromEntries(names.slice(0,5).map(p=>[p,'4000'])),before=JSON.stringify(job);
 const html=renderToStaticMarkup(createElement(ClosureComparison,{job,actual,epcAggregate:'4000',epc:{'Electrical Labour':'0','Earthing Cost':'1000',Deliveries:'1000','Installation Cost':'2000'}}));
 assert.ok(html.includes('5,000'));assert.ok(html.includes('10 panels × 500 W'));
 const firstRow=html.split('<tbody>')[1].split('</tr>')[0];assert.ok(firstRow.includes('5,000.00'));assert.ok(firstRow.includes('1.00 / W'));assert.ok(firstRow.includes('0.80 / W'));assert.ok(firstRow.includes('-0.20 / W'));
 const electrical=html.split('<tr').find(r=>r.includes('Electrical Labour'))!;assert.ok(electrical.includes('0.00 / W'));
 const total=html.split('<tfoot>')[1];assert.ok(total.includes('24,000.00'));assert.ok(total.includes('4.80 / W'));
 assert.equal(JSON.stringify(job),before);
 const absent=renderToStaticMarkup(createElement(ClosureComparison,{job:{...job,entry:{}},actual,epcAggregate:'4000'}));assert.ok(absent.includes('per-watt figures unavailable'));assert.ok(!absent.includes('/ W</small>'));
});
