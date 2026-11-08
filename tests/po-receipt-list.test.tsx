import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerFollowupList } from "../web/components/CustomerFollowupList.js";
import { isCustomerFollowup } from "../web/workspaces/followup-groups.js";
import { coordinationBuckets, visibleCoordinationBuckets } from "../web/workspaces/project-routes.js";

test("Customer Follow-up keeps dispatched quotes and surveys together and hides finished stages", () => {
  const followup = coordinationBuckets[5];
  const records = [
    { id: "old", stage: "design_handed_off", coordinationBucket: followup, site: "Existing site", siteCode: "1", customer: "A", data: {}, quotation: { id: "quote", number: "Q1" } },
    { id: "survey", stage: "customer_tracking", coordinationBucket: followup, site: "Survey site", siteCode: "2", customer: "B", route: "survey-framework", data: { headsupReceived: true } },
    { id: "pending", stage: "technical_review", coordinationBucket: coordinationBuckets[1], site: "Not sent", data: {} },
    { id: "issued", stage: "issued", coordinationBucket: followup, site: "Issued sale", data: {} },
    { id: "declined", stage: "declined", coordinationBucket: followup, site: "Declined sale", data: {} },
  ];
  const legacy = { id: "legacy", site: "Legacy site", customer: "C", sourceQuotationId: "Q2", data: {}, legacyTask: { kind: "Sale confirmation", number: "Q2", boq_revision_id: "revision" } };
  const html = renderToStaticMarkup(<CustomerFollowupList records={[...records.filter(isCustomerFollowup), legacy]}
    groups={[]} onOpen={() => {}} onRevise={() => {}} onConfirmSale={() => {}}/>);
  assert.match(html, /Existing site/);
  assert.match(html, /Survey site/);
  assert.match(html, /Legacy site/);
  assert.doesNotMatch(html, /Not sent|Issued sale|Declined sale|Customer response/);
  assert.equal((html.match(/Heads-up Received/g) ?? []).length, 1);
  assert.equal((html.match(/Confirm Sale/g) ?? []).length, 3);
  assert.ok(!visibleCoordinationBuckets.includes(coordinationBuckets[6]));
});
