import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { R2Store, sha256Hex, signV4 } from "../server/documents/r2-store.js";
import { readConfig } from "../server/config.js";
import { fileSources, fileType, objectKey } from "../server/documents/object-copies.js";

test("SigV4 signer matches Amazon's published S3 GET Object example", () => {
  // From the AWS S3 documentation, "Signature Calculations for the Authorization Header", Example: GET Object.
  const authorization = signV4({
    method: "GET",
    path: "/test.txt",
    headers: {
      Host: "examplebucket.s3.amazonaws.com",
      Range: "bytes=0-9",
      "x-amz-content-sha256": sha256Hex(""),
      "x-amz-date": "20130524T000000Z",
    },
    payloadHash: sha256Hex(""),
    amzDate: "20130524T000000Z",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  });
  assert.equal(
    authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

const baseEnv = {
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://user@localhost/db",
  ADMIN_SETUP_TOKEN: "x".repeat(40),
};
const r2Env = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_BUCKET: "powerzone-documents",
  R2_ACCESS_KEY_ID: "a".repeat(32),
  R2_SECRET_ACCESS_KEY: "b".repeat(64),
};

test("R2 switch is off by default, and a bad setting never stops the site from starting", () => {
  assert.equal(readConfig({ ...baseEnv }).documentStorage, "database");
  assert.equal(readConfig({ ...baseEnv, ...r2Env }).documentStorage, "database");
  assert.equal(readConfig({ ...baseEnv, ...r2Env }).r2, undefined);
  const on = readConfig({ ...baseEnv, ...r2Env, DOCUMENT_STORAGE: "r2" });
  assert.equal(on.documentStorage, "r2");
  assert.equal(on.r2?.bucket, "powerzone-documents");
  assert.equal(on.documentStorageProblem, undefined);
  const missing = readConfig({ ...baseEnv, ...r2Env, R2_ACCOUNT_ID: "", DOCUMENT_STORAGE: "r2" });
  assert.equal(missing.documentStorage, "database");
  assert.equal(missing.r2, undefined);
  assert.match(missing.documentStorageProblem!, /R2_ACCOUNT_ID/);
  const typo = readConfig({ ...baseEnv, ...r2Env, DOCUMENT_STORAGE: "cloudflare" });
  assert.equal(typo.documentStorage, "database");
  assert.match(typo.documentStorageProblem!, /DOCUMENT_STORAGE/);
  // Problems name the setting, never its value.
  const leaked = readConfig({ ...baseEnv, ...r2Env, R2_SECRET_ACCESS_KEY: "short!", DOCUMENT_STORAGE: "r2" });
  assert.doesNotMatch(leaked.documentStorageProblem!, /short!/);
});

test("object names follow folder/year/month/id and keep the real file type", () => {
  const qc = fileSources.find((s) => s.table === "operations_board_files")!;
  const created = new Date("2026-11-16T10:00:00Z");
  const { ext, type } = fileType(qc, "image/jpeg", "Site photo (2).JPG");
  assert.equal(objectKey(qc, "9f2c0000-0000-0000-0000-0000000000e1", created, ext), "qc-evidence/2026/11/9f2c0000-0000-0000-0000-0000000000e1.jpg");
  assert.equal(type, "image/jpeg");
  const ubl = fileSources.find((s) => s.table === "ubl_source_documents")!;
  assert.equal(objectKey(ubl, "config/../x y", undefined, fileType(ubl, null, "Book.xlsx").ext), "ubl/source-documents/config_.._x_y.xlsx");
  const pkg = fileSources.filter((s) => s.table === "ubl_survey_review_packages");
  assert.deepEqual(pkg.map((s) => objectKey(s, "p1", created, fileType(s).ext)), [
    "ubl/survey-packages/2026/11/p1-xlsx.xlsx",
    "ubl/survey-packages/2026/11/p1-report.pdf",
  ]);
  assert.equal(new Set(fileSources.map((s) => `${s.table}.${s.column}`)).size, fileSources.length);
});

test("R2 client signs requests, never overwrites, and reports missing files", async () => {
  const objects = new Map<string, Buffer>();
  const seen: IncomingMessage[] = [];
  const server = createServer(async (req, res) => {
    seen.push(req);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    if (!String(req.headers.authorization).startsWith("AWS4-HMAC-SHA256 Credential=" + r2Env.R2_ACCESS_KEY_ID + "/")) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === "PUT") {
      if (req.headers["x-amz-content-sha256"] !== sha256Hex(body)) return void res.writeHead(400).end();
      if (objects.has(req.url!) && req.headers["if-none-match"] === "*") return void res.writeHead(412).end();
      if (req.url!.includes("broken")) return void res.writeHead(500).end();
      objects.set(req.url!, body);
      return void res.writeHead(200).end();
    }
    const found = objects.get(req.url!);
    if (!found) return void res.writeHead(404).end();
    res.writeHead(200).end(found);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const store = new R2Store({
      accountId: r2Env.R2_ACCOUNT_ID,
      bucket: r2Env.R2_BUCKET,
      accessKeyId: r2Env.R2_ACCESS_KEY_ID,
      secretAccessKey: r2Env.R2_SECRET_ACCESS_KEY,
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    const file = Buffer.from("signed DO bytes");
    assert.equal(await store.put("qc-evidence/2026/11/a.pdf", file, "application/pdf"), "created");
    assert.equal(seen[0]!.url, "/powerzone-documents/qc-evidence/2026/11/a.pdf");
    assert.equal(seen[0]!.headers["content-type"], "application/pdf");
    assert.match(String(seen[0]!.headers.authorization), /SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date/);
    assert.equal(await store.put("qc-evidence/2026/11/a.pdf", Buffer.from("other"), "application/pdf"), "exists");
    assert.deepEqual(await store.get("qc-evidence/2026/11/a.pdf"), file);
    assert.equal(await store.get("qc-evidence/2026/11/missing.pdf"), undefined);
    await assert.rejects(store.put("broken/x.pdf", file, "application/pdf"), (error: Error) =>
      error.message === "R2 upload failed with status 500" && !error.message.includes(r2Env.R2_SECRET_ACCESS_KEY));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
