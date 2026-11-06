import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api,resetApiPrincipal} from '../web/api.js';
test('stale tab pins its principal, reloads on account change and does not silently continue as another user',async()=>{
 const originalFetch=globalThis.fetch,originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 const window=new EventTarget();Object.defineProperty(globalThis,'window',{configurable:true,value:window});
 let changed=0;window.addEventListener('pz:account-changed',()=>changed++);
 const headers:Headers[]=[];let response:any={user:{id:'account-a'}};let status=200;
 globalThis.fetch=async(_url,options)=>{headers.push(new Headers(options?.headers));return new Response(JSON.stringify(response),{status,headers:{'Content-Type':'application/json'}});};
 try{
  resetApiPrincipal();await api('/auth/session');response={code:'SESSION_CHANGED',message:'Account changed'};status=409;
  await assert.rejects(api('/material-dispatches/intake'),/Account changed/);assert.equal(headers[1].get('X-PZ-Session-User'),'account-a');assert.equal(changed,1);
  status=200;response={user:{id:'account-b'}};await api('/auth/session');assert.equal(headers[2].has('X-PZ-Session-User'),false);
  response={};await api('/dashboard');assert.equal(headers[3].get('X-PZ-Session-User'),'account-b');
  response={user:{id:'account-c'}};await assert.rejects(api('/auth/session'),/signed-in account changed/);assert.equal(changed,2);
 }finally{resetApiPrincipal();globalThis.fetch=originalFetch;if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else delete (globalThis as any).window;}
});
