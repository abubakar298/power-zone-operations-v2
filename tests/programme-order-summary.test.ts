import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectManagementProgrammes} from '../server/director/management-programmes.js';

const ups=(key:string,extra:any={})=>({key:'UBL:UPS:'+key,kind:'UPS',program:'UPS 250',ipo:'CHP-163',orderNumber:key,site:'Fictional '+key,customer:'UBL',grossContract:'900000',singleInvoiceSubmitted:false,singlePaymentReceived:false,delivered:false,installed:false,invoiceReferences:[],accountsReferences:[],...extra});
const snapshot=(rows:any[])=>({registers:[{rows}],cables:{rows:[]},internet:{rows:[]}});

// Atif's documentation standard: the IPO target, the running order count and the valid orders are
// different numbers. Cancelled orders stay in history and are counted, never reused or hidden.
test('each programme counts target, orders issued, cancelled, valid, completed, pending and remaining sites',()=>{
 const rows=[
  ...Array.from({length:6},(_,i)=>ups(`${i+1}/250`,{delivered:true,installed:true})),
  ...Array.from({length:3},(_,i)=>ups(`${i+7}/250`,{delivered:true})),
  ups('10/250'),
  ups('11/250',{cancelled:true,cancellationOutcome:'Cancelled by the bank; no replacement PO.'}),
  ups('12/250',{cancelled:true,cancellationOutcome:'Cancelled and reissued under 13/250'}),
  ups('13/250'),
 ];
 const p=projectManagementProgrammes(snapshot(rows),'2026-11-20',5).programmes.find(p=>p.key==='ubl-ups-250')!;
 assert.deepEqual(p.orders,{target:250,issued:13,cancelled:2,transferred:0,valid:11,completed:6,pending:5,remaining:239});
 assert.equal(p.orders.issued,p.orders.valid+p.orders.cancelled+p.orders.transferred,'every order received is accounted for');
 assert.equal(p.cancelled.length,2,'cancelled orders stay listed');
});

test('valid orders above the target never show negative remaining sites',()=>{
 const rows=Array.from({length:22},(_,i)=>({...ups(`${i+1}/20`),key:'MBL:UPS:'+(i+1),customer:'MBL',program:'MBL UPS 20'}));
 const p=projectManagementProgrammes(snapshot(rows),'2026-11-20',5).programmes.find(p=>p.key==='mbl-ups-20')!;
 assert.equal(p.orders.target,20);assert.equal(p.orders.valid,22);assert.equal(p.orders.remaining,0);
});

test('the Bank programmes page shows the counts side by side, never as 257/250',async()=>{
 const React=(await import('react')).default,{renderToStaticMarkup}=await import('react-dom/server'),{registerHooks}=await import('node:module');
 registerHooks({load:(url,context,next)=>(url.endsWith('.css')||url.endsWith('?url'))?{format:'module',source:"export default ''",shortCircuit:true}:next(url,context)});
 const {OrderCounts}=await import('../web/components/ProgrammeDashboard.js');
 const html=renderToStaticMarkup(React.createElement(OrderCounts,{orders:{target:250,issued:257,cancelled:7,transferred:0,valid:250,completed:220,pending:30,remaining:0}}));
 for(const [label,value] of <[string,number][]>[['Target sites',250],['Orders issued',257],['Cancelled',7],['Valid orders',250],['Completed',220],['Pending',30],['Remaining sites',0]])
  assert.match(html,new RegExp(`<dt>${label}</dt><dd>${value}</dd>`),String(label));
 assert.doesNotMatch(html,/257\/250|Transferred/,'no fraction; Transferred appears only when there are transfers');
});
