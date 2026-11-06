import { test } from "node:test";
import assert from "node:assert/strict";
import { readBackupResponse } from "../web/backup-response.js";

test("backup download handles HTML gateway errors and refuses HTML success pages", async () => {
  await assert.rejects(readBackupResponse(new Response("<!DOCTYPE html><html>Unavailable</html>", { status: 502, headers: { "Content-Type": "text/html" } })), /interrupted \(HTTP 502\).*No backup file/);
  await assert.rejects(readBackupResponse(new Response("<!DOCTYPE html><html>Loading</html>", { status: 200 })), /valid encrypted backup/);
  await assert.rejects(readBackupResponse(new Response('{"message":"Current administrator password is incorrect."}', { status: 403, headers: { "Content-Type": "application/json" } })), /password is incorrect/);
  await assert.rejects(readBackupResponse(new Response("broken", { status: 503, headers: { "Content-Type": "application/json" } })), /HTTP 503/);
  const file = await readBackupResponse(new Response("PZBACK01encrypted fixture bytes"));
  assert.equal(await file.text(), "PZBACK01encrypted fixture bytes");
});
