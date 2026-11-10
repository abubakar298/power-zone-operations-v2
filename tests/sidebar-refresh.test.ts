import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SidebarBuckets} from '../web/components/SidebarBuckets.js';
import {bucketCounts} from '../web/workspaces/bucket-counts.js';
import {designBuckets,visibleCoordinationBuckets} from '../web/workspaces/project-routes.js';
import {shouldRefreshSidebar,sidebarMinRefreshGapMs,sidebarRefreshIntervalMs} from '../web/workspaces/sidebar-refresh.js';

test('sidebar still lists every department bucket with a loading count before data arrives',()=>{
  for(const [department,buckets] of [['design',designBuckets],['coordination',visibleCoordinationBuckets]] as const){
    const html=renderToStaticMarkup(createElement(SidebarBuckets,{department,page:'',onSelect:()=>undefined}));
    assert.equal(html.match(/<button/g)?.length,buckets.length);
    assert.equal(html.match(/aria-label="Loading document count"/g)?.length,buckets.length);
  }
});

test('sidebar counts are unchanged for an empty workflow list',()=>{
  for(const [department,buckets] of [['design',designBuckets],['coordination',visibleCoordinationBuckets]] as const){
    const counts=bucketCounts(department,[],[]);
    assert.deepEqual(Object.keys(counts),[...buckets]);
    assert.ok(Object.values(counts).every(n=>n===0));
  }
});

test('sidebar refreshes once a minute at most and never on a hidden tab',()=>{
  assert.equal(sidebarRefreshIntervalMs,60_000);
  assert.equal(sidebarMinRefreshGapMs,15_000);
  const now=1_000_000;
  // First load on a visible tab always runs.
  assert.equal(shouldRefreshSidebar({hidden:false,inFlight:false,lastLoadedAt:undefined,now}),true);
  // Hidden tabs never poll; they refresh when they become visible again.
  assert.equal(shouldRefreshSidebar({hidden:true,inFlight:false,lastLoadedAt:undefined,now}),false);
  assert.equal(shouldRefreshSidebar({hidden:true,inFlight:false,lastLoadedAt:now-10*60_000,now}),false);
  // A request already on its way is not duplicated.
  assert.equal(shouldRefreshSidebar({hidden:false,inFlight:true,lastLoadedAt:undefined,now}),false);
  // Focus and visibility events right after a load (or after the page supplied fresh records) are skipped.
  assert.equal(shouldRefreshSidebar({hidden:false,inFlight:false,lastLoadedAt:now-1_000,now}),false);
  assert.equal(shouldRefreshSidebar({hidden:false,inFlight:false,lastLoadedAt:now-sidebarMinRefreshGapMs+1,now}),false);
  // Once the gap has passed, a return to the tab or the minute timer refreshes.
  assert.equal(shouldRefreshSidebar({hidden:false,inFlight:false,lastLoadedAt:now-sidebarMinRefreshGapMs,now}),true);
  assert.equal(shouldRefreshSidebar({hidden:false,inFlight:false,lastLoadedAt:now-sidebarRefreshIntervalMs,now}),true);
});
