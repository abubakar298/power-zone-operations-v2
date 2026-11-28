import test from "node:test";
import assert from "node:assert/strict";
import { currentCustomerPo } from "../shared/current-customer-po.js";

test("without an attached PO the list shows the PO saved at IPO issue", () => {
  assert.deepEqual(currentCustomerPo({ sharedPoReference: "POF262715099", sharedPoDate: "2026-11-12T00:00:00Z", latePo: null }),
    { reference: "POF262715099", date: "2026-11-12" });
  assert.deepEqual(currentCustomerPo(undefined), { reference: null, date: null });
});

test("an attached PO is the only PO shown; the earlier PO is not repeated", () => {
  assert.deepEqual(currentCustomerPo({ sharedPoReference: "POF262715099", sharedPoDate: "2026-11-12", latePo: { poNumber: "POF262715043", poDate: "2026-11-12" } }),
    { reference: "POF262715043", date: "2026-11-12" });
});
