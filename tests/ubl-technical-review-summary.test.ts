import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {submittedUblReviews,UblTechnicalReviewSummary,readyUblReview} from '../web/components/UblTechnicalReviewSummary.js';
const record=(id:string,code:string,extra:any={})=>({id,siteCode:code,site:'Site '+code,customerCode:'UBL',route:'survey-framework',data:{designHandoffAt:'2026-10-16T12:00:00Z',reviewDocumentId:'review-'+id},...extra});
test('summary includes only handed-off UBL survey documents, flags first and preserves input',()=>{
 const records=[record('2','0200'),record('1','0100'),record('flag','0300',{data:{designHandoffAt:'yes',reviewDocumentId:'review-flag',ublStandardsReview:{needsReview:true}}}),record('pending','0999',{data:{}}),record('other','0001',{customerCode:'MBL'}),record('ups','0002',{route:'direct-framework'}),record('undocumented','0003',{data:{designHandoffAt:'yes'}})];
 const before=JSON.stringify(records);assert.deepEqual(submittedUblReviews(records).map(r=>r.id),['flag','1','2']);assert.equal(JSON.stringify(records),before);
});
test('empty summary distinguishes unsubmitted work and exposes no send or approval action',()=>{
 const html=renderToStaticMarkup(createElement(UblTechnicalReviewSummary,{session:{user:{id:'design'},csrfToken:'test'} as any,records:[record('pending','1614',{data:{}})],onBack(){},onOpen(){}}));
 assert.match(html,/No UBL surveys are awaiting technical review submission./);assert.match(html,/0 awaiting submission UBL sites/);assert.doesNotMatch(html,/Confirm Sale|Submit Technical Review<|Approve review/);
});

test('ready queue includes current saved survey inputs before technical review is submitted',()=>{
 const pending=record('pending','1614',{stage:'report_received',data:{surveyInputs:{inverter:'20 kW'}}});assert.equal(readyUblReview(pending),true);assert.equal(readyUblReview({...pending,stage:'design_handed_off'}),false);assert.equal(readyUblReview({...pending,customerCode:'MBL'}),false);assert.equal(readyUblReview({...pending,data:{}}),false);assert.equal(readyUblReview({...pending,route:'direct-framework'}),false);
});
