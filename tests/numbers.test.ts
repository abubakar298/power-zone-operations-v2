import { test } from "node:test";
import assert from "node:assert/strict";
import { money } from "../web/numbers.js";
test("money display keeps large decimal amounts exact and rounds only presentation", () => {
  assert.equal(money("9999999999999999.99"), "9,999,999,999,999,999.99");
  assert.equal(money("4054562.701"), "4,054,562.70");
  assert.equal(money("1.005"), "1.01");
  assert.equal(money("-1234.56"), "-1,234.56");
});
test("money display distinguishes zero, missing and invalid data", () => {
  assert.equal(money("0"), "0.00");
  assert.equal(money(null), "Not entered");
  assert.equal(money(undefined), "Not entered");
  assert.equal(money(""), "Not entered");
  assert.equal(money("NaN"), "Not available");
  assert.equal(money("bad"), "Not available");
});
