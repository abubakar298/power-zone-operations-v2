import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmDelivery,workflowSiteSchema} from '../server/operations-board/workflow.js';
const pdf={id:'00000000-0000-4000-8000-000000000001',name:'signed.pdf',mediaType:'application/pdf'},photo={id:'00000000-0000-4000-8000-000000000002',name:'material.png',mediaType:'image/png'};
test('final delivery cannot precede its recorded partial shipment',()=>{
 const now='2026-10-27T10:00:00Z',site=workflowSiteSchema.parse({id:'chronology',ipo:'IPO-D',name:'Date fixture',stage:'awaiting',installation:true});
 const partial=confirmDelivery(site,{deliveryDate:'2026-10-25',signedDo:pdf,materialPhoto:photo,partial:true},now);
 assert.equal(partial.stage,'awaiting');assert.throws(()=>confirmDelivery(partial,{deliveryDate:'2026-10-24',signedDo:pdf,materialPhoto:photo,partial:false},now),/previous stage/);
 const final=confirmDelivery(partial,{deliveryDate:'2026-10-26',signedDo:pdf,materialPhoto:photo,partial:false},now);assert.equal(final.stage,'delivered');assert.equal(final.documents?.length,2);assert.notEqual(final.documents?.[0].id,final.documents?.[1].id);
 assert.equal(partial.deliveries?.length,1);assert.throws(()=>confirmDelivery(partial,{deliveryDate:'2026-10-28',signedDo:pdf,materialPhoto:photo,partial:false},now),/future/);
});
