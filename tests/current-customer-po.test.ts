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

test("the Store link check accepts the customer PO attached after the IPO was issued", async () => {
  const { checkMaterialSourceLink } = await import("../server/inventory/source-link-policy.js");
  const site = { id: "b1", ipo: "CHP-163 · 41/250", name: "OPF HOUSING SOCIETY BRANCH", customerPo: "POF262715043", stage: "received" };
  const ipo = { id: "i1", number: "CHP-163", orderNumber: "41/250", poNumber: "POF262715099", siteName: "OPF HOUSING SOCIETY BRANCH" };
  assert.equal(checkMaterialSourceLink(site, [ipo]).status, "po-mismatch");
  assert.equal(checkMaterialSourceLink(site, [{ ...ipo, attachedPoNumber: "POF262715043" }]).status, "eligible");
  // A board not yet updated (PO attached before this change) still matches the IPO's own PO.
  assert.equal(checkMaterialSourceLink({ ...site, customerPo: "POF262715099" }, [{ ...ipo, attachedPoNumber: "POF262715043" }]).status, "eligible");
  assert.equal(checkMaterialSourceLink({ ...site, customerPo: "OTHER-PO" }, [{ ...ipo, attachedPoNumber: "POF262715043" }]).status, "po-mismatch");
});
