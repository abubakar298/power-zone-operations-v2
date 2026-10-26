import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmDiscountProposal } from '../web/confirm.js';
test('discount order requires exactly one explicit choice and cancellation does not choose', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: any[] = [];
  const make = (tag: string) => { const n: any = {tag, children: [], checked:false, disabled:false, append(...v:any[]){this.children.push(...v)}, setAttribute(k:string,v:string){this[k]=v}, addEventListener(k:string,f:any){this[k]=f}, showModal(){}, close(){}, remove(){}, focus(){}}; nodes.push(n); return n; };
  Object.defineProperty(globalThis,'document',{configurable:true,value:{activeElement:null,createElement:make,createTextNode:(s:string)=>s,body:{append(){}}}});
  try {
    const proposals: any = [{key:'discount',label:'Amount',discount:'100',payable:'900'},{key:'margin',label:'Margin',discount:'200',payable:'800'}];
    const pending = confirmDiscountProposal(proposals);
    const confirm = nodes.find(n=>n.textContent==='Send');
    assert.equal(confirm.disabled,true);
    const checks=nodes.filter(n=>n.type==='checkbox');
    assert.equal(checks.length,2);
    checks[0].checked=true; checks[0].onchange(); assert.equal(confirm.disabled,false);
    checks[1].checked=true; checks[1].onchange(); assert.equal(checks[0].checked,false);
    checks[1].checked=false; checks[1].onchange(); assert.equal(confirm.disabled,true);
    checks[1].checked=true; checks[1].onchange(); confirm.onclick(); assert.equal(await pending,'margin');
    nodes.length=0;
    const cancelled=confirmDiscountProposal(proposals); nodes.find(n=>n.textContent==='Cancel').onclick(); assert.equal(await cancelled,null);
  } finally { if(old) Object.defineProperty(globalThis,'document',old); else delete (globalThis as any).document; }
});
