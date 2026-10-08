import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotationWorkflow } from "../web/pages/QuotationWorkflow.js";
const session: any = {
  user: { id: "manager", role: "Management" },
  csrfToken: "test",
};
const q: any = {
  id: "sample",
  number: "Q-SAMPLE",
  created_by: "coordinator",
  created_at: "2026-10-08",
  workflow_status: "Submitted",
  snapshot: {
    input: { discount: "0" },
    footer: [
      { label: "Total", amount: "3460" },
      { label: "Special Discount", amount: "0" },
      { label: "Net Total", amount: "3460" },
    ],
  },
};
function html(role = "Management", separate = false) {
  return renderToStaticMarkup(
    <QuotationWorkflow
      session={{ ...session, user: { ...session.user, role } }}
      quotation={{
        ...q,
        snapshot: {
          ...q.snapshot,
          footer: separate
            ? [
                { label: "Subtotal Before Tax", amount: "3000" },
                ...q.snapshot.footer,
              ]
            : q.snapshot.footer,
        },
      }}
      onChange={() => {}}
      renderPreview={() => <p>PDF preview marker</p>}
    />,
  );
}
test("management controls follow history before PDF and expose both adjustment methods", () => {
  const s = html();
  assert.match(s, /Document workflow history/);
  assert.ok(
    s.indexOf("Document workflow history") <
      s.indexOf("Management pricing controls"),
  );
  assert.ok(
    s.indexOf("Management pricing controls") < s.indexOf("PDF preview marker"),
  );
  assert.match(s, /Tax-inclusive quotation/);
  assert.match(s, /Discount amount/);
  assert.match(s, /Discount percentage/);
  assert.match(s, /Management discount amount/);
  assert.match(s, /aria-label="Discount \(%\)"/);
  assert.match(s, /Discount amount comparison/);
  assert.match(s, /Discount percentage comparison/);
  assert.doesNotMatch(s, /<select/);
  assert.doesNotMatch(s, /type="radio"|type="checkbox"/);
  assert.match(s, /Send for revision/);

  assert.match(html("Management", true), /GST shown separately/);
});
test("coordinator does not receive management discount or target controls", () => {
  const s = html("Coordinator");
  assert.doesNotMatch(
    s,
    /Management pricing controls|Discount percentage|Management discount amount/,
  );
});
