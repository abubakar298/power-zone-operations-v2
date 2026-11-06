import {test} from 'node:test';import assert from 'node:assert/strict';import {fitA4Image} from '../shared/a4-image-fit.js';
test('DO, Parent DO and acknowledgment captures fit complete content into A4 rather than blocking oversized pages',()=>{
 for(const [w,h]of [[794,1123],[740,1400],[1588,3100],[1200,600],[794,2600]]){const f=fitA4Image(w,h);assert.ok(f.x>=7);assert.equal(f.y,7);assert.ok(f.width<=196.00001);assert.ok(f.height<=283.00001);assert.ok(f.x+f.width<=203.00001);assert.ok(f.y+f.height<=290.00001);assert.ok(Math.abs(f.width/f.height-w/h)<1e-9);}
});

test('every dispatched site has a VSO, including fixed-only and delivery-only DOs, with five blank writing rows outside a Parent DO',async()=>{
 const {issuedCustomerSignoffModels}=await import('../server/inventory/material-document-model.js');
 for(const installation of [true,false]){
  const record:any={id:'fixed',number:'DO-TEST',created_at:'2026-11-03',snapshot:{status:'issued',stockPosting:true,kind:'fixed',warehouse:'Lahore',parent:false,sites:[{siteId:'site',siteName:'Fixed-only site',ipo:'CHP-1',installation}],lines:[{itemId:'CH-BMS',description:'BMS',unit:'Nos',out:'1',sites:['site']}]}};
  const models=issuedCustomerSignoffModels(record);assert.equal(models.length,1);assert.equal(models[0].kind,'customer-signoff');assert.equal(models[0].blankRows,5);assert.equal(models[0].sourceSiteId,'site');
 }
});
