import {test} from 'node:test';
import assert from 'node:assert/strict';
import {phaseCostComparison} from '../server/accounts/phase-comparison.js';
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
 assert.deepEqual(r.phases.Inverter,{jobs:2,averageActualCost:'40.00'});
 assert.deepEqual(r.phases.BMS,{jobs:1,averageActualCost:'0.00'});
 assert.deepEqual(r.phases.EPC,{jobs:2,averageActualCost:'40.00'});
 assert.deepEqual(r.phases.Structure,{jobs:0,averageActualCost:null});
 assert.deepEqual(r.total,{jobs:2,averageActualCost:'200.00'});
 assert.equal(JSON.stringify(peers),before);
});
test('Dashboard queues require actual submissions and exclude completed or superseded work',()=>{
 assert.equal(awaitingClosures([{stage:'Draft'},{stage:'Awaiting Management'},{stage:'Closed'},{stage:'Returned for Revision'}]).length,1);
 const packages=[{id:'p',status:'Submitted for Management',snapshot:{sites:[{recordId:'a'},{recordId:'b'}]}},{id:'old',status:'Submitted for Management',snapshot:{sites:[{recordId:'a'}]}}];
 const records=[{id:'a',stage:'management_review',version:3,data:{ublSurveyPackageId:'p'}},{id:'b',stage:'approved_dispatch',version:4,data:{ublSurveyPackageId:'p'}}];
 const p=pendingTechnicalPackages(packages,records);assert.equal(p.length,1);assert.deepEqual(p[0].pendingSites,[{recordId:'a',version:3}]);
 assert.equal(pendingBoqReviews([{draft_id:'a',draft_version:1,status:'Awaiting review'},{draft_id:'a',draft_version:2,status:'Approved'}]).length,0);
});
