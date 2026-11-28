import test from "node:test";
import assert from "node:assert/strict";
import { currentCustomerPo } from "../shared/current-customer-po.js";

test("without an attached PO the list shows the PO saved at IPO issue", () => {
  assert.deepEqual(currentCustomerPo({ sharedPoReference: "POF262715099", sharedPoDate: "2026-11-12T00:00:00Z", latePo: null }),
    { reference: "POF262715099", date: "2026-11-12", issuedReference: null, issuedDate: null });
  assert.deepEqual(currentCustomerPo(undefined), { reference: null, date: null, issuedReference: null, issuedDate: null });
});

test("an attached PO becomes the current PO; the PO at IPO issue stays visible underneath", () => {
  assert.deepEqual(currentCustomerPo({ sharedPoReference: "POF262715099", sharedPoDate: "2026-11-12", latePo: { poNumber: "POF262715043", poDate: "2026-11-12" } }),
    { reference: "POF262715043", date: "2026-11-12", issuedReference: "POF262715099", issuedDate: "2026-11-12" });
});

test("the same number attached again is not repeated as the PO at IPO issue", () => {
  assert.equal(currentCustomerPo({ sharedPoReference: "pof262715043", latePo: { poNumber: "POF262715043", poDate: "2026-11-20" } }).issuedReference, null);
});
