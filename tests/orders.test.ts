import { test } from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "decimal.js";
import { allocateDiscount } from "../server/orders/allocation.js";
const lines = [
  {
    description: "Solar",
    qty: "10",
    unit: "No.",
    beforeTax: "100000",
    taxRate: "10",
    group: "solar",
  },
  {
    description: "Inverter",
    qty: "1",
    unit: "No.",
    beforeTax: "200000",
    taxRate: "18",
    group: "bess",
  },
  {
    description: "Battery",
    qty: "4",
    unit: "No.",
    beforeTax: "100000",
    taxRate: "18",
    group: "bess",
  },
];
test("after-tax discount is proportionally allocated only to 18% selling items", () => {
  const a = allocateDiscount(
    lines,
    "400000",
    "10000",
    "54000",
    "11800",
    "452200",
  );
  assert.equal(a.total, "452200.00");
  assert.equal(a.lines[0].allocatedDiscount, "0.00");
  assert.equal(a.lines[0].beforeTax, "100000.00");
  assert.equal(a.lines[1].beforeTaxReduction, "6666.67");
  assert.equal(a.lines[2].beforeTaxReduction, "3333.33");
  assert.equal(a.lines[1].allocatedDiscount, "7866.67");
  assert.equal(a.lines[2].allocatedDiscount, "3933.33");
  assert.equal(a.subtotal, "390000.00");
  assert.equal(a.tax, "62200.00");
});
test("allocation conserves every cent for zero, tiny, awkward and maximum discounts", () => {
  for (const discount of [
    "0",
    "0.01",
    "0.02",
    "17.39",
    "11800.01",
    "353999.99",
    "354000",
  ]) {
    const net = new Decimal("464000").minus(discount).toFixed(2);
    const a = allocateDiscount(
      lines,
      "400000",
      "10000",
      "54000",
      discount,
      net,
    );
    assert.equal(a.total, net);
    assert.equal(
      a.lines
        .reduce((v, l) => v.add(l.allocatedDiscount), new Decimal(0))
        .toFixed(2),
      new Decimal(discount).toFixed(2),
    );
    for (const l of a.lines) {
      assert.ok(new Decimal(l.beforeTax).gte(0));
      assert.ok(new Decimal(l.tax).gte(0));
      assert.equal(
        new Decimal(l.beforeTaxReduction).add(l.taxReduction).toFixed(2),
        l.allocatedDiscount,
      );
      assert.equal(new Decimal(l.beforeTax).add(l.tax).toFixed(2), l.total);
    }
  }
  assert.throws(
    () =>
      allocateDiscount(
        lines,
        "400000",
        "10000",
        "54000",
        "354000.01",
        "109999.99",
      ),
    /eligible/,
  );
});
test("other tax categories remain excluded and inconsistent source totals are rejected", () => {
  const mixed = [
    ...lines,
    {
      description: "Extra exempt",
      qty: "1",
      unit: "LS",
      beforeTax: "1000",
      taxRate: "0",
      group: "additional",
    },
    {
      description: "Extra 10%",
      qty: "1",
      unit: "LS",
      beforeTax: "1000",
      taxRate: "10",
      group: "additional",
    },
  ];
  const a = allocateDiscount(
    mixed,
    "402000",
    "10100",
    "54000",
    "11800",
    "454300",
  );
  assert.equal(a.lines[3].allocatedDiscount, "0.00");
  assert.equal(a.lines[4].allocatedDiscount, "0.00");
  assert.throws(
    () =>
      allocateDiscount(lines, "400000", "10000", "54000", "11800", "452201"),
    /reconcile/,
  );
  assert.throws(
    () => allocateDiscount([lines[0]], "100000", "10000", "0", "1", "109999"),
    /eligible/,
  );
});
