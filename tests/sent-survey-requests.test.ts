import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sentSurveyAwaitingDesign,surveyRequestInCoordination} from '../shared/sent-survey-requests.js';
import {bucketCounts} from '../web/workspaces/bucket-counts.js';
import {coordinationBuckets,designBuckets} from '../web/workspaces/project-routes.js';
test('sent requests remain in Coordination until Design returns them, with drafts separate from sent work',()=>{
 const stages=['survey_requested','survey_scheduled','report_received','technical_review','technical_revision'];
 const rows=stages.map(stage=>({id:stage,stage,route:'survey-quote',data:{sentToDesignAt:'2026-10-31'},coordinationBucket:coordinationBuckets[0],designBucket:designBuckets[0]}));
 for(const r of rows){assert.equal(sentSurveyAwaitingDesign(r),true);assert.equal(surveyRequestInCoordination(r),true);}
 assert.equal(bucketCounts('coordination',rows)[coordinationBuckets[0]],5);
 assert.equal(bucketCounts('design',rows)[designBuckets[0]],5);
 assert.equal(sentSurveyAwaitingDesign({...rows[0],data:{}}),false);
 assert.equal(surveyRequestInCoordination({...rows[0],stage:'request_review',data:{}}),true);
 for(const stage of ['design_handed_off','management_review','issued','declined'])assert.equal(sentSurveyAwaitingDesign({...rows[0],stage}),false);
 assert.equal(sentSurveyAwaitingDesign({...rows[0],data:{designHandoffAt:'2026-10-31'}}),false);
 assert.equal(sentSurveyAwaitingDesign({...rows[0],route:'quick-quote'}),false);
 // A prepared commercial draft must not hide the still-pending survey.
 assert.equal(bucketCounts('coordination',[{...rows[0],coordinationBucket:coordinationBuckets[2],data:{sentToDesignAt:'2026-10-31',sentQuotationRecordId:'quote'}}])[coordinationBuckets[0]],1);
});
