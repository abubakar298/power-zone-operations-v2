import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReferencesCache,referencesMaxAgeMs,shareInFlight} from '../web/workspaces/workflow-list-reuse.js';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('two parts of the page asking for the same list at the same time share one request',async()=>{
  let calls=0;const pending=deferred<{records:string[]}>();
  const start=()=>{calls++;return pending.promise;};
  const first=shareInFlight('coordination|mine',start),second=shareInFlight('coordination|mine',start);
  assert.equal(calls,1);
  pending.resolve({records:['a']});
  assert.deepEqual(await first,{records:['a']});assert.equal(await second,await first);
  // Once it has arrived, the next request goes to the server again: finished lists are never reused.
  const again=deferred<{records:string[]}>();
  const third=shareInFlight('coordination|mine',()=>{calls++;return again.promise;});
  assert.equal(calls,2);again.resolve({records:['b']});assert.deepEqual(await third,{records:['b']});
});

test('different departments or scopes never share a request, and a failure is not kept',async()=>{
  let calls=0;const start=()=>{calls++;return Promise.reject(new Error('offline'));};
  await assert.rejects(shareInFlight('design|mine',start));
  await assert.rejects(shareInFlight('coordination|mine',start));
  await assert.rejects(shareInFlight('coordination|team',start));
  assert.equal(calls,3);
});

test('customer and site lists are reused for 5 minutes per account',async()=>{
  assert.equal(referencesMaxAgeMs,5*60_000);
  let now=1_000_000,calls=0;
  const cache=createReferencesCache(async()=>({customers:[++calls]}),()=>now);
  assert.deepEqual(await cache.get('user-1'),{customers:[1]});
  now+=referencesMaxAgeMs-1;assert.deepEqual(await cache.get('user-1'),{customers:[1]});
  assert.equal(calls,1);
  now+=1;assert.deepEqual(await cache.get('user-1'),{customers:[2]});
  // Another account (or a department view as another user) never sees this copy.
  assert.deepEqual(await cache.get('user-2'),{customers:[3]});
  assert.deepEqual(await cache.get('user-1'),{customers:[4]});
});

test('after adding or editing a customer or site the list is fetched fresh and becomes the new copy',async()=>{
  let now=1_000_000,calls=0;
  const cache=createReferencesCache(async()=>({customers:[++calls]}),()=>now);
  await cache.get('user-1');
  assert.deepEqual(await cache.get('user-1',{fresh:true}),{customers:[2]});
  now+=1_000;assert.deepEqual(await cache.get('user-1'),{customers:[2]});
  assert.equal(calls,2);
});

test('a failed download is not kept, so the next open tries again',async()=>{
  let calls=0;
  const cache=createReferencesCache(async()=>{calls++;if(calls===1)throw new Error('offline');return {customers:[calls]};},()=>1_000_000);
  await assert.rejects(cache.get('user-1'));
  assert.deepEqual(await cache.get('user-1'),{customers:[2]});
});
