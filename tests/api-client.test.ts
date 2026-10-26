import { test } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError } from "../web/api.js";

test("API client rejects unexpected HTML and preserves safe support references", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<html>Unavailable</html>");
    await assert.rejects(
      api("/health"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.message.includes("unexpected response"),
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          message: "Temporarily unavailable",
          requestId: "safe-reference",
        }),
        { status: 503 },
      );
    await assert.rejects(
      api("/health"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 503 &&
        error.message.includes("Reference: safe-reference"),
    );
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.equal(await api("/health"), undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("API client reports a connection failure without retrying a mutation", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new Error("private network diagnostic");
    };
    await assert.rejects(
      api("/action", { body: {} }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 0 &&
        !error.message.includes("private"),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
