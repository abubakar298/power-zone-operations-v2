import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../server/config.js";
import { ResendDelivery } from "../server/email/delivery.js";
const env = {
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://localhost/test",
  ADMIN_SETUP_TOKEN: "test-setup-token-with-32-characters",
  RESEND_API_KEY: "test-provider-key",
  EMAIL_FROM: "e-desk@powerzone.systems",
  EMAIL_FROM_NAME: "Rafiq · Power Zone Systems",
  EMAIL_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
};
test("email delivery uses the selected sender name and address without changing recipients", async () => {
  const previous = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ id: "test-email" }), { status: 200 });
  };
  try {
    await new ResendDelivery(readConfig(env)).send(
      { to: "recipient@example.test", subject: "Test", text: "Test" },
      "test-id",
    );
    assert.equal(
      body.from,
      "Rafiq · Power Zone Systems <e-desk@powerzone.systems>",
    );
    assert.deepEqual(body.to, ["recipient@example.test"]);
    assert.throws(() =>
      readConfig({
        ...env,
        EMAIL_FROM_NAME: "Rafiq\r\nBcc: other@example.test",
      }),
    );
  } finally {
    globalThis.fetch = previous;
  }
});
