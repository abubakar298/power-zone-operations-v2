import test from "node:test";
import assert from "node:assert/strict";
import { managementReview } from "../server/commercial/management-review.js";
import { Decimal } from "decimal.js";
const rows = [
  {
    description: "Panels",
    qty: "1",
    unit: "LS",
    beforeTax: "1000",
    taxRate: "10",
    group: "solar",
  },
  {
    description: "BESS",
    qty: "1",
    unit: "LS",
    beforeTax: "2000",
    taxRate: "18",
    group: "bess",
  },
];
const review = (v: any, cost = "2400") =>
  managementReview(rows, "3000", "100", "360", cost, "0", v);
test("margin excludes GST, lump discount clears back to original and preserves source", () => {
  const before = JSON.stringify(rows),
    a = review({ discount: "0" }),
    b = review({ discount: "118" });
  assert.equal(a.original.profit, "600.00");
  assert.equal(a.original.marginPercent, "20.00");
  assert.equal(b.proposed.revenue, "2900.00");
  assert.equal(b.proposed.profit, "500.00");
  assert.equal(b.proposed.payable, "3342.00");
  assert.equal(b.proposed.tax, "442.00");
  assert.deepEqual(review({ discount: "0" }).proposed, a.proposed);
  assert.equal(JSON.stringify(rows), before);
});
test("target margin derives precise payable and lump discount with approved allocation", () => {
  const r = review({ targetMargin: "10" });
  assert.equal(r.proposed.marginPercent, "10.00");
  assert.ok(new Decimal(r.proposed.revenue).gte(new Decimal(2400).div("0.9")));
  assert.deepEqual(review({ discount: r.discount }).proposed, r.proposed);
  assert.equal(review({ targetMargin: "20" }).discount, "0.00");
});
test("reject impossible targets, invalid values, zero cost and excessive discount", () => {
  for (const v of ["100", "-1", "NaN", "1e2", ""])
    assert.throws(() => review({ targetMargin: v }));
  assert.throws(() => review({ targetMargin: "21" }), /price increase/);
  assert.throws(() => review({ targetMargin: "10" }, "0"), /positive/);
  assert.throws(() => review({ targetMargin: "0" }, "100"), /eligible/);
  assert.throws(() => review({ discount: "2360.01" }), /exceeds/);
});
test("mixed tax categories retain maximum eligible discount and two-decimal results", () => {
  const r = review({ discount: "2360" });
  assert.equal(r.proposed.payable, "1100.00");
  assert.equal(r.proposed.revenue, "1000.00");
  assert.equal(r.maximumDiscount, "2360.00");
});
