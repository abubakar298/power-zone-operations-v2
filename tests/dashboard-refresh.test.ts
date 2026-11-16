import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalsRefreshIntervalMs,
  coordinationListDue,
  coordinationListMinAgeMs,
  dashboardCheckDue,
  dashboardRefreshIntervalMs,
  dashboardReturnGapMs,
} from '../web/workspaces/dashboard-refresh.js';

test('management dashboard timings: approvals 30 s, other lists 2 min, coordination list 5 min',()=>{
  assert.equal(approvalsRefreshIntervalMs,30_000);
  assert.equal(dashboardRefreshIntervalMs,120_000);
  assert.equal(dashboardReturnGapMs,60_000);
  assert.equal(coordinationListMinAgeMs,300_000);
});

test('dashboard checks never run on a hidden tab or twice at once',()=>{
  const now=1_000_000;
  assert.equal(dashboardCheckDue({hidden:false,inFlight:false,lastStartedAt:undefined,now,minGapMs:dashboardReturnGapMs}),true);
  assert.equal(dashboardCheckDue({hidden:true,inFlight:false,lastStartedAt:undefined,now,minGapMs:0}),false);
  assert.equal(dashboardCheckDue({hidden:true,inFlight:false,lastStartedAt:now-60*60_000,now,minGapMs:dashboardReturnGapMs}),false);
  assert.equal(dashboardCheckDue({hidden:false,inFlight:true,lastStartedAt:undefined,now,minGapMs:0}),false);
});

test('returning to the tab refreshes only when the last check is a minute old',()=>{
  const now=1_000_000;
  assert.equal(dashboardCheckDue({hidden:false,inFlight:false,lastStartedAt:now-1_000,now,minGapMs:dashboardReturnGapMs}),false);
  assert.equal(dashboardCheckDue({hidden:false,inFlight:false,lastStartedAt:now-dashboardReturnGapMs+1,now,minGapMs:dashboardReturnGapMs}),false);
  assert.equal(dashboardCheckDue({hidden:false,inFlight:false,lastStartedAt:now-dashboardReturnGapMs,now,minGapMs:dashboardReturnGapMs}),true);
  // A forced refresh (opening the dashboard, after an approval) passes no gap.
  assert.equal(dashboardCheckDue({hidden:false,inFlight:false,lastStartedAt:now-1,now,minGapMs:0}),true);
});

test('the full coordination list is fetched again only after 5 minutes unless forced',()=>{
  const now=1_000_000;
  assert.equal(coordinationListDue({force:false,loadedAt:undefined,now}),true);
  assert.equal(coordinationListDue({force:false,loadedAt:now-dashboardRefreshIntervalMs,now}),false);
  assert.equal(coordinationListDue({force:false,loadedAt:now-coordinationListMinAgeMs+1,now}),false);
  assert.equal(coordinationListDue({force:false,loadedAt:now-coordinationListMinAgeMs,now}),true);
  assert.equal(coordinationListDue({force:true,loadedAt:now-1,now}),true);
});
