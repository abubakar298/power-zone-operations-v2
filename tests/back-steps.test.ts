import {test} from 'node:test';
import assert from 'node:assert/strict';

// A small browser stand-in: a history stack with popstate, the address and events.
type Entry={url:string;state:any};
const entries:Entry[]=[{url:'http://local/dashboard',state:null}];let index=0;
const listeners=new Map<string,Set<(e:any)=>void>>();
const fire=(type:string)=>{let stopped=false;const event={type,stopImmediatePropagation:()=>{stopped=true;}};for(const f of [...(listeners.get(type)??[])]){if(stopped)break;f(event);}};
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

test('an opened window is a Back step: Back closes it and keeps the page; closing it yourself removes its step',async()=>{
 history.pushState(null,'','/operations/physical-documents');
 let pageHandlerRan=0;window.addEventListener('popstate',()=>{pageHandlerRan++;});
 let closedByBack=0;openStep(()=>{closedByBack++;});
 assert.equal(entries.length-1,index);const page=location.href;
 goBack();await tick();
 assert.equal(closedByBack,1);assert.equal(location.href,page,'still on the same page');
 assert.equal(pageHandlerRan,0,'the page itself does not react to closing a window');
 const close=openStep(()=>{closedByBack++;});
 close();await tick();
 assert.equal(closedByBack,1,'closing it yourself does not call Back');
 assert.equal(location.href,page);assert.equal(history.state?.pzStep,undefined,'its step is gone');
 goBack();await tick();
 assert.equal(location.href,'http://local/dashboard','the next Back leaves the page');
});
