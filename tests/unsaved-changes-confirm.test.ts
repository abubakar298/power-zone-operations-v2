import {test} from 'node:test';
import assert from 'node:assert/strict';

// A small browser stand-in: events and the confirm box.
const listeners=new Map<string,Set<(e:Event)=>void>>();
let answers:boolean[]=[];let asked=0;
Object.assign(globalThis,{window:{
 addEventListener:(t:string,f:any)=>{if(!listeners.has(t))listeners.set(t,new Set());listeners.get(t)!.add(f);},
 removeEventListener:(t:string,f:any)=>listeners.get(t)?.delete(f),
 dispatchEvent:(e:Event)=>{for(const f of listeners.get(e.type)??[])f(e);return !e.defaultPrevented;},
 confirm:()=>{asked++;return answers.shift()??false;},
}});
const {confirmLeaveWorkspace}=await import('../web/hooks/useUnsavedChanges.js');
const dirty=()=>{const prevent=(e:Event)=>e.preventDefault();window.addEventListener('power-zone:before-workspace-navigation',prevent);return()=>window.removeEventListener('power-zone:before-workspace-navigation',prevent);};
const nextTask=()=>new Promise(r=>setTimeout(r,0));

test('nothing unsaved: leaving needs no question',()=>{
 asked=0;assert.equal(confirmLeaveWorkspace(),true);assert.equal(asked,0);
});

test('unsaved: Stay keeps the page and asks again next time',async()=>{
 const clean=dirty();asked=0;answers=[false,false];
 assert.equal(confirmLeaveWorkspace(),false);assert.equal(confirmLeaveWorkspace(),false);assert.equal(asked,2);
 clean();await nextTask();
});

test('unsaved: after Leave, other handlers of the same Back press do not ask again; the next press asks',async()=>{
 const clean=dirty();asked=0;answers=[true,false];
 assert.equal(confirmLeaveWorkspace(),true);
 assert.equal(confirmLeaveWorkspace(),true,'same Back press');assert.equal(asked,1);
 await nextTask();
 assert.equal(confirmLeaveWorkspace(),false,'a later Back press asks again');assert.equal(asked,2);
 clean();
});
