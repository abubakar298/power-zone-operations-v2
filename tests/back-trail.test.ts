import {test} from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser stand-ins: address, history, session storage and events.
const url={path:'/dashboard',search:'',hash:''};
const store=new Map<string,string>(),listeners=new Map<string,Set<()=>void>>();
let replaced='',reloaded=0,clock=1_000_000;
const setUrl=(value:string)=>{const u=new URL(value,'http://local');url.path=u.pathname;url.search=u.search;url.hash=u.hash;};
Object.assign(globalThis,{
 window:{addEventListener:(n:string,f:()=>void)=>{if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n)!.add(f);},removeEventListener:(n:string,f:()=>void)=>listeners.get(n)?.delete(f),dispatchEvent:(e:Event)=>{for(const f of listeners.get(e.type)??[])f();return true;}},
 location:{get pathname(){return url.path;},get search(){return url.search;},get hash(){return url.hash;},replace:(v:string)=>{replaced=v;setUrl(v);},reload:()=>{reloaded++;}},
 history:{state:null,pushState:(_d:unknown,_u:string,v:string)=>setUrl(v),replaceState:(_d:unknown,_u:string,v:string)=>setUrl(v)},
 sessionStorage:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v)},
});
Date.now=()=>clock;
const {installBackTrail,canGoBack,goBack}=await import('../web/navigation/back-trail.js');
const trail=()=>JSON.parse(store.get('pz-back-trail-v1')??'[]');

test('Back remembers pages opened by tabs (no browser history) and by page links, and returns one step at a time',()=>{
 installBackTrail();
 assert.deepEqual(trail(),['/dashboard']);assert.equal(canGoBack(),false,'no Back on the first page');
 clock+=5000;history.replaceState(null,'','/dashboard#workspace=finance&accountsTab=Physical+Documents');
 clock+=5000;history.replaceState(null,'','/dashboard#workspace=finance&accountsTab=Job+Closure');
 assert.deepEqual(trail(),['/dashboard','/dashboard#workspace=finance&accountsTab=Physical+Documents','/dashboard#workspace=finance&accountsTab=Job+Closure']);
 // Typing in a search box updates the current step instead of adding one per letter.
 clock+=5000;history.replaceState(null,'','/dashboard#workspace=finance&accountsTab=Job+Closure&q=a');
 clock+=200;history.replaceState(null,'','/dashboard#workspace=finance&accountsTab=Job+Closure&q=ab');
 assert.equal(trail().length,4,'the first letter adds a step; the next letters update it');assert.equal(trail().at(-1),'/dashboard#workspace=finance&accountsTab=Job+Closure&q=ab');
 assert.equal(canGoBack(),true);
 goBack();
 assert.equal(url.hash,'#workspace=finance&accountsTab=Job+Closure');assert.equal(reloaded,1,'the same page reopens at the previous step');
 assert.deepEqual(trail(),['/dashboard','/dashboard#workspace=finance&accountsTab=Physical+Documents','/dashboard#workspace=finance&accountsTab=Job+Closure']);
});

test('the browser back key keeps the trail in step, and signing out clears it',async()=>{
 await new Promise(r=>setTimeout(r,1100));
 clock+=5000;history.pushState(null,'','/operations/sites');
 clock+=5000;history.pushState(null,'','/operations/batches');
 setUrl('/operations/sites');for(const f of listeners.get('popstate')??[])f();
 assert.equal(trail().at(-1),'/operations/sites');assert.ok(!trail().includes('/operations/batches'));
 goBack();assert.equal(replaced,'/dashboard#workspace=finance&accountsTab=Job+Closure','another page opens by address');
 await new Promise(r=>setTimeout(r,1100));
 setUrl('/login');for(const f of listeners.get('popstate')??[])f();
 assert.deepEqual(trail(),[]);assert.equal(canGoBack(),false);
});
