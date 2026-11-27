import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SidebarBuckets} from '../web/components/SidebarBuckets.js';
import {bucketCounts} from '../web/workspaces/bucket-counts.js';
import {designBuckets,visibleCoordinationBuckets,cancelledSitesBucket} from '../web/workspaces/project-routes.js';
import {shouldRefreshSidebar,sidebarMinRefreshGapMs,sidebarRefreshIntervalMs} from '../web/workspaces/sidebar-refresh.js';

test('sidebar still lists every department bucket with a loading count before data arrives',()=>{
  for(const [department,buckets] of [['design',designBuckets],['coordination',visibleCoordinationBuckets]] as const){
    const html=renderToStaticMarkup(createElement(SidebarBuckets,{department,page:'',onSelect:()=>undefined}));
    assert.equal(html.match(/<button/g)?.length,buckets.length);
    // Cancelled Sites shows its own total on its page (it also lists reviewed-register orders), so it has no sidebar count.
    assert.equal(html.match(/aria-label="Loading document count"/g)?.length,buckets.filter(b=>b!==cancelledSitesBucket).length);
  }
  assert.ok(visibleCoordinationBuckets.includes(cancelledSitesBucket));
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

// User report, 27 Nov 2026: Design Review listed 4 older commercial tasks while its counter showed 0.
test('Design Review counter includes the older commercial tasks its page lists',async()=>{
  const {coordinationBuckets}=await import('../web/workspaces/project-routes.js');
  const legacy=[
    {kind:'Survey / BOQ',status:'Draft',stage:'Survey & Costing Preparation'},
    {kind:'Commercial pricing',status:'Approved BOQ: prepare pricing',stage:'Survey & Costing Preparation'},
    {kind:'Sale confirmation',status:'Approved quotation awaiting send',stage:'Approved quotations awaiting send'},
  ];
  const counts=bucketCounts('coordination',[],legacy);
  assert.equal(counts[coordinationBuckets[1]],2);
  assert.equal(counts[coordinationBuckets[4]],1);
  assert.equal(counts[coordinationBuckets[0]],0,'Survey Requests still counts only survey requests');
});
