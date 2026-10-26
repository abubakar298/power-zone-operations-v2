import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { verifyWebhook } from "../server/notifications/webhook.js";
test("provider signatures: published Svix vector, tampering, stale timestamps and key rotation signatures", () => {
  const body = Buffer.from('{"event_type":"ping","data":{"success":true}}');
  assert.equal(
    verifyWebhook(
      body,
      "msg_loFOjxBNrRLzqYUf",
      "1731705121",
      "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
      "whsec_plJ3nmyCDGBKInavdOK15jsl",
      1731705121000,
    ),
    true,
  );
  const key = randomBytes(32),
    secret = "whsec_" + key.toString("base64"),
    timestamp = String(Math.floor(Date.now() / 1000));
  const sign = createHmac("sha256", key)
    .update(`event.${timestamp}.`)
    .update(body)
    .digest("base64");
  assert.ok(
    verifyWebhook(body, "event", timestamp, `v1,bad v1,${sign}`, secret),
  );
  assert.equal(
    verifyWebhook(
      Buffer.from("changed"),
      "event",
      timestamp,
      `v1,${sign}`,
      secret,
    ),
    false,
  );
  assert.equal(
    verifyWebhook(
      body,
      "event",
      timestamp,
      `v1,${sign}`,
      secret,
      Date.now() + 600000,
    ),
    false,
  );
});
