import { test } from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "decimal.js";
import { allocateDiscount } from "../server/orders/allocation.js";
import { peachtreeDivision } from "../server/orders/peachtree.js";
import { ipoPresentation } from "../server/orders/presentation.js";
const source = [
  { group: "solar", beforeTax: "110", taxRate: "10" },
  { group: "structure", beforeTax: "120", taxRate: "18" },
  ...[1, 2, 3].map(() => ({ group: "bess", beforeTax: "133", taxRate: "18" })),
  { group: "earthing", beforeTax: "60", taxRate: "18" },
  { group: "balance", beforeTax: "375", taxRate: "18" },
].map((l, i) => ({ ...l, description: `Item ${i}`, qty: "1", unit: "LS" }));
test("all IPO formats retain accepted prices and discounted payable with matching quotation grouping", () => {
  for (const discount of ["0", "0.01", "118"]) {
    const a = allocateDiscount(
      source,
      "1064",
      "11",
      "171.72",
      discount,
      new Decimal("1246.72").minus(discount).toFixed(2),
    );
    for (const presentation of ["No Breakup", "Basic Breakup", "Full Breakup"])
      for (const taxMode of ["Tax Included", "Show Sales Tax Separately"]) {
        const p: any = { input: { presentation, taxMode } };
        const d = peachtreeDivision(a, {} as any, p);
        const included = taxMode === "Tax Included";
        assert.equal(d.phaseTotal, included ? a.total : a.subtotal);
        assert.equal(
          d.phases[2].amount,
          included ? a.lines[2].total : a.lines[2].beforeTax,
        );
        const v = ipoPresentation({ allocation: a, peachtree: d });
        assert.equal(
          v.rows.length,
          presentation === "No Breakup"
            ? 1
            : presentation === "Basic Breakup"
              ? 5
              : 7,
        );
        assert.equal(
          v.rows.reduce((t, r) => t.add(r.total), new Decimal(0)).toFixed(2),
          a.total,
        );
        assert.equal(
          v.rows.reduce((t, r) => t.add(r.amount), new Decimal(0)).toFixed(2),
          v.amount,
        );
        if (included) {
          assert.equal(v.tax, "0.00");
          assert.ok(v.rows.every((r) => r.tax === "0.00" && r.taxRate === "0"));
        }
        assert.equal(a.lines[0].allocatedDiscount, "0.00");
      }
  }
});
