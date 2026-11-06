import {test} from 'node:test';
import assert from 'node:assert/strict';

// A small browser stand-in: a history stack with popstate, the address and events.
type Entry={url:string;state:any};
const entries:Entry[]=[{url:'http://local/dashboard',state:null}];let index=0;
const listeners=new Map<string,Set<(e:any)=>void>>();
const fire=(type:string)=>{for(const f of [...(listeners.get(type)??[])])f({type});};
const fakeHistory:any={
 get state(){return entries[index].state;},
 pushState:(state:any,_u:string,url?:string)=>{entries.splice(index+1);entries.push({url:url?new URL(url,entries[index].url).href:entries[index].url,state});index++;},
 replaceState:(state:any,_u:string,url?:string)=>{entries[index]={url:url?new URL(url,entries[index].url).href:entries[index].url,state};},
 back:()=>{if(index>0){index--;queueMicrotask(()=>fire('popstate'));}},
};
Object.assign(globalThis,{
 history:fakeHistory,
 location:{get href(){return entries[index].url;}},
 window:{addEventListener:(t:string,f:any)=>{if(!listeners.has(t))listeners.set(t,new Set());listeners.get(t)!.add(f);},removeEventListener:(t:string,f:any)=>listeners.get(t)?.delete(f),dispatchEvent:(e:Event)=>{fire(e.type);return true;}},
 document:{referrer:'',documentElement:{},querySelectorAll:()=>[]},
 MutationObserver:class{observe(){}},
});
const {installBackSteps,canGoBack,goBack,openStep}=await import('../web/navigation/back-steps.js');
const tick=()=>new Promise(r=>setTimeout(r,0));

test('each tab or page opened is one Back step; Back returns one step without reloading',async()=>{
 installBackSteps();
 assert.equal(canGoBack(),false,'no Back on the first page');
 history.pushState(null,'','/dashboard#workspace=finance&accountsTab=Physical+Documents');
 history.pushState(null,'','/dashboard#workspace=finance&accountsTab=Physical+Documents');
 assert.equal(entries.length,2,'opening the page already shown adds no step');
 history.pushState(null,'','/dashboard#workspace=finance&accountsTab=Job+Closure');
 assert.equal(canGoBack(),true);
 goBack();await tick();
 assert.equal(location.href,'http://local/dashboard#workspace=finance&accountsTab=Physical+Documents');
 goBack();await tick();
 assert.equal(location.href,'http://local/dashboard');assert.equal(canGoBack(),false);
});

test('an open record is closed by Back first and never touches the browser history',async()=>{
 history.pushState(null,'','/operations/physical-documents');
 const before=entries.length,page=location.href;
 let closed=0;const remove=openStep(()=>{closed++;remove();});
 assert.equal(entries.length,before,'opening a record adds no history entry');
 goBack();await tick();
 assert.equal(closed,1);assert.equal(location.href,page,'still on the same page');
 // A record closed by its own button, followed straight away by a page change, must not move the browser back.
 const removeSecond=openStep(()=>{});removeSecond();
 history.pushState(null,'','/operations/batches');await tick();
 assert.equal(location.href,'http://local/operations/batches','the new page stays');
 goBack();await tick();
 assert.equal(location.href,page,'Back then returns to the previous page');
});
