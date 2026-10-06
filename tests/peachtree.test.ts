import { test } from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "decimal.js";
import { allocateDiscount } from "../server/orders/allocation.js";
import { peachtreeDivision } from "../server/orders/peachtree.js";
const source = [
  { group: "solar", beforeTax: "110", taxRate: "10" },
  { group: "structure", beforeTax: "120", taxRate: "18" },
  ...[1, 2, 3].map(() => ({ group: "bess", beforeTax: "133", taxRate: "18" })),
  { group: "earthing", beforeTax: "60", taxRate: "18" },
  { group: "balance", beforeTax: "375", taxRate: "18" },
].map((l, i) => ({ ...l, description: `Item ${i}`, qty: "1", unit: "LS" }));
const boq: any = {
  inverterConfig: { sku: "INV" },
  lines: [
    { key: "Solar PV Modules", total: "100" },
    { key: "Structure - Elevated", total: "100" },
    { key: "INV", total: "100" },
    { key: "BAT-HV-05 KW WO BMS", total: "100" },
    { key: "CH-BMS-HV", total: "100" },
    { key: "Earthing Bore", total: "50" },
    { key: "Labour", total: "300" },
  ],
};
const pricing = (presentation: string, taxMode: string): any => ({
  input: { presentation, taxMode },
  rows: [{ key: "balance", cost: "300" }],
});
test("Basic Breakup pools 33% BESS and 25% Balance into a 29% cost markup", () => {
  const a = allocateDiscount(source, "1064", "11", "171.72", "0", "1246.72");
  const d = peachtreeDivision(
    a,
    boq,
    pricing("Basic Breakup", "Show Sales Tax Separately"),
  );
  assert.equal(d.effectivePooledMarkup, "29.000000");
  assert.deepEqual(
    d.phases.map((p) => p.amount),
    ["110.00", "120.00", "129.00", "129.00", "129.00", "447.00"],
  );
  assert.equal(d.phaseTotal, "1064.00");
});
test("Full Breakup retains exact net item values and all formats reconcile after discount", () => {
  for (const discount of ["0", "0.01", "118"]) {
    const a = allocateDiscount(
      source,
      "1064",
      "11",
      "171.72",
      discount,
      new Decimal("1246.72").minus(discount).toFixed(2),
    );
    for (const presentation of [
      "No Breakup",
      "Basic Breakup",
      "Full Breakup",
    ]) {
      for (const mode of ["Tax Included", "Show Sales Tax Separately"]) {
        const d = peachtreeDivision(a, boq, pricing(presentation, mode));
        assert.equal(
          d.phaseTotal,
          mode === "Tax Included" ? a.total : a.subtotal,
        );
        assert.equal(
          d.phases.reduce((v, p) => v.add(p.amount), new Decimal(0)).toFixed(2),
          d.phaseTotal,
        );
        if (presentation === "Full Breakup")
          assert.equal(
            d.phases[2].amount,
            mode === "Tax Included" ? a.lines[2].total : a.lines[2].beforeTax,
          );
        if (presentation === "No Breakup")
          assert.equal(
            d.phases[0].amount,
            mode === "Tax Included" ? "121.00" : "110.00",
          );
      }
    }
  }
});
test("No Breakup rejects a payable value smaller than the fixed solar allocation", () => {
  const a = allocateDiscount(source, "1064", "11", "171.72", "0", "1246.72");
  assert.throws(
    () =>
      peachtreeDivision(
        { ...a, total: "100.00" },
        boq,
        pricing("No Breakup", "Tax Included"),
      ),
    /cannot be allocated/,
  );
});
