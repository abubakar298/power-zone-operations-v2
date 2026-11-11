import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerSiteFields, siteAfterNameChange } from "../web/components/CustomerSiteFields.js";

const masters = {
  customers: [{ id: 3, name: "Sample Bank", short_code: "SB", contact_person: "", phone: "", status: "Active" }],
  sites: [],
};
const initial = { customerId: 3, siteName: "Original name", siteCode: "000", location: "Original location" };
const render = (props: { revision: boolean; siteDetailsEditable?: boolean }) =>
  renderToStaticMarkup(<CustomerSiteFields masters={masters} initial={initial} {...props} />);
const control = (html: string, marker: string) => {
  const found = html.match(new RegExp(`<input[^>]*${marker}[^>]*>`));
  assert.ok(found, `Missing control ${marker}`);
  return found[0];
};
const locked = (html: string, marker: string) => /\s(readOnly|disabled)=""/.test(control(html, marker));

test("a new BOQ leaves customer and site details open", () => {
  const html = render({ revision: false });
  assert.equal(locked(html, 'aria-label="Customer"'), false);
  assert.equal(locked(html, 'name="siteName"'), false);
  assert.equal(locked(html, 'name="siteCode"'), false);
  assert.equal(locked(html, 'name="location"'), false);
});

test("a locked revision or preparation keeps all four details closed", () => {
  const html = render({ revision: true });
  assert.equal(locked(html, 'aria-label="Customer"'), true);
  assert.equal(locked(html, 'name="siteName"'), true);
  assert.equal(locked(html, 'name="siteCode"'), true);
  assert.equal(locked(html, 'name="location"'), true);
});

test("a revision opens site name and location but keeps customer and site code closed", () => {
  const html = render({ revision: true, siteDetailsEditable: true });
  assert.equal(locked(html, 'aria-label="Customer"'), true);
  assert.equal(locked(html, 'name="siteName"'), false);
  assert.equal(locked(html, 'name="siteCode"'), true);
  assert.equal(locked(html, 'name="location"'), false);
  assert.match(control(html, 'name="siteCode"'), /value="000"/);
});

test("typing a site name keeps a revision's site code but still resets a new BOQ's code", () => {
  const site = { name: "Original name", code: "000", location: "Original location" };
  const known = [{ id: 7, name: "Known site", code: "K7", location: "Known location" }];
  assert.deepEqual(siteAfterNameChange(site, "Known site", known, true), {
    siteId: "",
    site: { name: "Known site", code: "000", location: "Original location" },
  });
  assert.deepEqual(siteAfterNameChange(site, "Known site", known, false), {
    siteId: "7",
    site: { name: "Known site", code: "K7", location: "Known location" },
  });
  assert.deepEqual(siteAfterNameChange(site, "Typed site", known, false), {
    siteId: "",
    site: { name: "Typed site", code: "", location: "Original location" },
  });
});
