import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CustomerPoStatus} from '../web/components/LateCustomerPo.js';

const html=(followUp:any,recordId?:string)=>renderToStaticMarkup(createElement(CustomerPoStatus,{followUp,recordId}));

test('customer PO label: nothing for ordinary sites, pending, received later, differs',()=>{
 assert.equal(html(null),'');
 assert.equal(html({poToFollow:false,latePo:null,approvalEvidenceType:'WhatsApp approval'}),'','No label when Coordination did not say a PO will follow');
 const pending=html({poToFollow:true,latePo:null,approvalEvidenceType:'Email approval'});
 assert.match(pending,/Customer PO pending/);assert.match(pending,/Approved by Email approval/);
 const received=html({poToFollow:true,latePo:{poNumber:'4500123',poDate:'2026-11-28',amountDiffers:false,fileId:'f1'}},'r1');
 assert.match(received,/PO received later/);assert.match(received,/PO 4500123 · 2026-11-28/);assert.match(received,/\/api\/project-workflow\/r1\/files\/f1/);
 assert.doesNotMatch(received,/pending/);
 assert.match(html({latePo:{poNumber:'9',poDate:'2026-11-28',amountDiffers:true}}),/PO differs from IPO/);
});
