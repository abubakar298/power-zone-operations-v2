import {test} from 'node:test';
import assert from 'node:assert/strict';

// A small browser stand-in: a history stack with popstate, the address and events.
type Entry={url:string;state:any};
const entries:Entry[]=[{url:'http://local/dashboard',state:null}];let index=0;
const store=new Map<string,string>();
const listeners=new Map<string,Set<(e:any)=>void>>();
const fire=(type:string)=>{for(const f of [...(listeners.get(type)??[])])f({type});};
const at=()=>new URL(entries[index].url);
Object.assign(globalThis,{
 history:{
  get state(){return entries[index].state;},
  pushState:(state:any,_u:string,url?:string)=>{entries.splice(index+1);entries.push({url:url?new URL(url,entries[index].url).href:entries[index].url,state});index++;},
  replaceState:(state:any,_u:string,url?:string)=>{entries[index]={url:url?new URL(url,entries[index].url).href:entries[index].url,state};},
  back:()=>{if(index>0){index--;queueMicrotask(()=>fire('popstate'));}},
 },
 location:{get href(){return at().href;},get pathname(){return at().pathname;},get search(){return at().search;},get hash(){return at().hash;}},
 sessionStorage:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v),removeItem:(k:string)=>void store.delete(k)},
 window:{addEventListener:(t:string,f:any)=>{if(!listeners.has(t))listeners.set(t,new Set());listeners.get(t)!.add(f);},removeEventListener:(t:string,f:any)=>listeners.get(t)?.delete(f),dispatchEvent:(e:Event)=>{fire(e.type);return true;}},
 document:{referrer:'',documentElement:{},querySelectorAll:()=>[]},
 MutationObserver:class{observe(){}},
});
const {installBackSteps,canGoBack,goBack,stepDepth,previousAddress}=await import('../web/navigation/back-steps.js');
const {addressValue,choiceAddress,choiceIn,pageAddress,pageOf,pageOnlyAddress,pushChoice}=await import('../web/navigation/page-steps.js');
const tick=()=>new Promise(r=>setTimeout(r,0));
const queues=['awaiting','confirmed','all'] as const;
const queue=()=>choiceIn(addressValue('paymentsQueue'),queues,'awaiting');

test('Accounts pages and cards are Back steps: All invoices → Payments to record → Dashboard, without reloading',async()=>{
 installBackSteps();
 // The Accounts dashboard names itself in the address without adding a step.
 history.replaceState(null,'',choiceAddress('accountsTab','My Workspace'));
 assert.equal(canGoBack(),false,'no Back on the first page');
 history.pushState(null,'',pageAddress('accountsTab','Payments to Record'));
 assert.equal(queue(),'awaiting','Payments to record opens on Awaiting payment');
 history.pushState(null,'',choiceAddress('paymentsQueue','all'));
 assert.equal(queue(),'all');assert.equal(stepDepth(),2);
 const loads=entries.length;
 goBack();await tick();
 assert.equal(addressValue('accountsTab'),'Payments to Record');assert.equal(queue(),'awaiting','Back from All invoices returns to Payments to record');
 goBack();await tick();
 assert.equal(addressValue('accountsTab'),'My Workspace','Back again returns to the dashboard');
 assert.equal(canGoBack(),false);
 assert.equal(entries.length,loads,'Back only moves within the same page history');
});

test('opening another page keeps the workspace and View as but leaves the previous page\'s cards behind',()=>{
 history.replaceState(null,'','/dashboard#workspace=finance&viewAs=Accounts&accountsTab=Payments+to+Record&paymentsQueue=all&notification=x');
 assert.equal(pageAddress('accountsTab','Invoices to Submit'),'/dashboard#workspace=finance&viewAs=Accounts&accountsTab=Invoices+to+Submit');
 assert.equal(choiceAddress('paymentsQueue','confirmed'),'/dashboard#workspace=finance&viewAs=Accounts&accountsTab=Payments+to+Record&paymentsQueue=confirmed&notification=x');
});

test('one click that changes two cards is one Back step; Back restores both',async()=>{
 history.replaceState(null,'','/dashboard#workspace=dashboard&page=Workspace');
 await new Promise(r=>setTimeout(r,200));
 const before=stepDepth();
 pushChoice('taskStage','Quotation');pushChoice('taskGroup','all');
 assert.equal(stepDepth(),before+1,'both choices share one step');
 assert.equal(addressValue('taskStage'),'Quotation');assert.equal(addressValue('taskGroup'),'all');
 goBack();await tick();
 assert.equal(addressValue('taskStage'),null);assert.equal(addressValue('taskGroup'),null);
});

test('during Back a page can tell whether it was left (another page) or only its cards changed',async()=>{
 const seen:string[]=[];const listen=()=>seen.push(pageOf(previousAddress())===pageOf(location.href)?'same page':'other page');
 window.addEventListener('popstate',listen);
 history.pushState(null,'','/dashboard#workspace=finance&accountsTab=Payments+to+Record');
 await new Promise(r=>setTimeout(r,200));
 pushChoice('paymentsQueue','all');
 history.pushState(null,'','/dashboard#workspace=finance&accountsTab=Invoices+to+Submit');
 goBack();await tick();goBack();await tick();
 window.removeEventListener('popstate',listen);
 assert.deepEqual(seen,['other page','same page']);
 assert.equal(pageOnlyAddress(new URLSearchParams('workspace=finance&boq=7')),'/dashboard#workspace=finance&boq=7','links that are not cards stay');
});

test('an unknown card in the address falls back to the first card',()=>{
 assert.equal(choiceIn('something-else',queues,'awaiting'),'awaiting');
 assert.equal(choiceIn(null,queues,'awaiting'),'awaiting');
 assert.equal(choiceIn('confirmed',queues,'awaiting'),'confirmed');
});
