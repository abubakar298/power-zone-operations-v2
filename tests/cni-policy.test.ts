import test from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "decimal.js";
import { priceCni, cniCustomerAmounts } from "../server/commercial/cni-policy.js";
test("C&I quantity pricing preserves inclusive total in both presentations", () => {
  for (const quantity of [1,3,1000]) {
    const a=priceCni({ quantity, taxRate:"18", presentation:"Inclusive" });
    const b=priceCni({ quantity, taxRate:"18", presentation:"Separate" });
    assert.equal(a.payable,new Decimal("17250000").mul(quantity).toFixed(2));
    assert.equal(a.payable,b.payable);
    assert.equal(new Decimal(b.beforeTax).plus(b.tax).toFixed(2),b.payable);
    assert.deepEqual(cniCustomerAmounts(a),{payable:a.payable});
    assert.equal(a.requiresDiscountApproval,false);
  }
});
test("C&I discounts require approval and enforce per-cabinet floor", () => {
  const atFloor=priceCni({quantity:2,discount:"3500000",taxRate:"18",presentation:"Separate"});
  assert.equal(atFloor.payable,"31000000.00");
  assert.equal(atFloor.requiresDiscountApproval,true);
  assert.throws(()=>priceCni({quantity:2,discount:"3500000.01",taxRate:"18",presentation:"Inclusive"}));
  for (const quantity of [0,-1,1.5,1001]) assert.throws(()=>priceCni({quantity,taxRate:"18",presentation:"Inclusive"}));
  assert.throws(()=>priceCni({quantity:1,discount:"-1",taxRate:"18",presentation:"Inclusive"}));
  assert.throws(()=>priceCni({quantity:1,unitPayable:"1",taxRate:"18",presentation:"Inclusive"}));
});

import { snapshotCniCost, reviewCni } from "../server/commercial/cni-costing.js";
test("C&I internal pre-GST cost and cost-based target markup reconcile",()=>{
 const p=priceCni({quantity:1,taxRate:"18",presentation:"Inclusive"});
 const r=reviewCni(p,snapshotCniCost(1),{targetMarkup:"30"});
 assert.equal(r.original.cost,"11000000.00");assert.equal(r.original.profit,"3618644.07");
 assert.equal(r.proposed.profit,"3300000.00");assert.equal(r.proposed.markup,"30.00");
 assert.equal(r.proposed.payable,"16874000.00");assert.equal(r.recommendedDiscount,"376000.00");
 assert.throws(()=>reviewCni(p,snapshotCniCost(1),{targetMarkup:"15"}));
 assert.throws(()=>reviewCni(p,snapshotCniCost(1),{targetMarkup:"99"}));
});
