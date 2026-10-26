import{test}from'node:test';
import assert from'node:assert/strict';
import{Decimal}from'decimal.js';
import{allocateApprovedDiscount,discountForRoundedPayable,DISCOUNT_POLICY,type DiscountStrategy}from'../server/commercial/discount-strategy.js';
import{managementReviewV5}from'../server/commercial/management-review-v5.js';
const strategy:DiscountStrategy={version:DISCOUNT_POLICY,items:[
 {key:'panel',group:'solar',category:'solar',cost:'100000',beforeTax:'115000',taxRate:'10',approvedAllowance:'5000'},
 {key:'structure',group:'structure',category:'structure',cost:'100000',beforeTax:'115000',taxRate:'18',approvedAllowance:'5000'},
 {key:'earth',group:'earthing',category:'earthing',cost:'100000',beforeTax:'115000',taxRate:'18',approvedAllowance:'5000'},
 {key:'inverter',group:'bess',category:'bess',cost:'100000',beforeTax:'135000',taxRate:'18',approvedAllowance:'5000'},
 {key:'epc',group:'balance',category:'other',cost:'100000',beforeTax:'130000',taxRate:'18',approvedAllowance:'5000'}]};
test('approved allowance removes each own cost uplift; special discount protects solar, structure and earthing',()=>{
 const saved=JSON.stringify(strategy),approved=allocateApprovedDiscount(strategy,'25000'),special=allocateApprovedDiscount(strategy,'65000');
 assert.deepEqual(approved.lines.map(l=>l.beforeTax),['110000.00','110000.00','110000.00','130000.00','125000.00']);
 assert.deepEqual(special.lines.slice(0,3).map(l=>l.managementSpecialDiscount),['0.00','0.00','0.00']);
 assert.equal(special.lines.reduce((s,l)=>s.add(l.approvedDiscount),new Decimal(0)).toFixed(2),'25000.00');
 assert.equal(special.lines.reduce((s,l)=>s.add(l.managementSpecialDiscount),new Decimal(0)).toFixed(2),'40000.00');
 assert.equal(special.lines.reduce((s,l)=>s.add(l.total),new Decimal(0)).toFixed(2),special.total);
 assert.equal(JSON.stringify(strategy),saved);
 const partial=allocateApprovedDiscount(strategy,'10000');assert.ok(partial.lines.every(l=>l.approvedDiscount==='2000.00'&&l.managementSpecialDiscount==='0.00'));
});
test('rounded payable uses changed GST buckets and round-trips to the chosen total',()=>{
 for(const discount of ['0','10000','25000','65000','254999.99']){
  const accepted=allocateApprovedDiscount(strategy,discount),target=new Decimal(accepted.total).div(1000).ceil().mul(1000).toFixed(2);
  if(new Decimal(target).lte(allocateApprovedDiscount(strategy,'0').total)){
   const solved=discountForRoundedPayable(strategy,target),result=allocateApprovedDiscount(strategy,solved,target);assert.equal(result.total,target);
  }
 }
 assert.throws(()=>allocateApprovedDiscount(strategy,'300000'),/exceeds eligible/);
 assert.throws(()=>allocateApprovedDiscount(strategy,'-1'),/nonnegative/);
 assert.throws(()=>discountForRoundedPayable(strategy,'900000'),/cannot exceed/);
});
test('cash without GST and retained-GST selling both reconcile without manufacturing a tax liability',()=>{
 for(const retained of [false,true]){
  const items=strategy.items.map(i=>{const factor=retained?new Decimal(i.taxRate).div(100).add(1):new Decimal(1);return {...i,beforeTax:new Decimal(i.beforeTax).mul(factor).toFixed(2),approvedAllowance:new Decimal(i.approvedAllowance).mul(factor).toFixed(2),taxRate:'0'};});
  const result=allocateApprovedDiscount({version:DISCOUNT_POLICY,items},items.reduce((s,i)=>s.add(i.approvedAllowance),new Decimal(0)).add(40000).toFixed(2));
  assert.equal(result.tax,'0.00');assert.equal(result.subtotal,result.total);assert.ok(result.lines.slice(0,3).every(i=>i.managementSpecialDiscount==='0.00'));
 }
});
test('Management discount, markup and margin targets use the identical two-layer allocation',()=>{
 const amount=managementReviewV5(strategy,'500000','25000',{discount:'65000'});
 assert.equal(amount.proposed.revenue,'545000.00');
 assert.equal(amount.proposed.profit,'45000.00');
 assert.ok(amount.proposed.allocation.lines.slice(0,3).every(l=>l.managementSpecialDiscount==='0.00'));
 const target=managementReviewV5(strategy,'500000','25000',{targetMarkup:'9'});
 assert.equal(target.discount,'65000.00');assert.equal(target.proposed.payable,amount.proposed.payable);
 const margin=managementReviewV5(strategy,'500000','25000',{targetMargin:'10'});assert.ok(new Decimal(margin.proposed.revenue).gte(new Decimal(500000).div('.9')));
});
