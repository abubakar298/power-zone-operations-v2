import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {submittedUblReviews,UblTechnicalReviewSummary} from '../web/components/UblTechnicalReviewSummary.js';
const record=(id:string,code:string,extra:any={})=>({id,siteCode:code,site:'Site '+code,customerCode:'UBL',route:'survey-framework',data:{designHandoffAt:'2026-10-16T12:00:00Z',reviewDocumentId:'review-'+id},...extra});
test('summary includes only handed-off UBL survey documents, flags first and preserves input',()=>{
 const records=[record('2','0200'),record('1','0100'),record('flag','0300',{data:{designHandoffAt:'yes',reviewDocumentId:'review-flag',ublStandardsReview:{needsReview:true}}}),record('pending','0999',{data:{}}),record('other','0001',{customerCode:'MBL'}),record('ups','0002',{route:'direct-framework'}),record('undocumented','0003',{data:{designHandoffAt:'yes'}})];
 const before=JSON.stringify(records);assert.deepEqual(submittedUblReviews(records).map(r=>r.id),['flag','1','2']);assert.equal(JSON.stringify(records),before);
});
test('empty summary distinguishes unsubmitted work and exposes no send or approval action',()=>{
 const html=renderToStaticMarkup(createElement(UblTechnicalReviewSummary,{session:{user:{id:'design'},csrfToken:'test'} as any,records:[record('pending','1614',{data:{}})],onBack(){},onOpen(){}}));
 assert.match(html,/No submitted UBL technical reviews yet/);assert.match(html,/1 UBL surveys have not yet been handed off/);assert.doesNotMatch(html,/Confirm Sale|Submit Technical Review<|Approve review/);
});
