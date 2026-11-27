import { createHash, createHmac } from "node:crypto";

// A small S3-compatible client for Cloudflare R2: PUT and GET only, signed
// with AWS Signature Version 4. Built on Node's own fetch and crypto so no
// extra npm package is needed. Error messages carry status codes only,
// never keys or signatures.

export interface ObjectStore {
  /** Store bytes under a key. Never overwrites: "exists" when the key is already taken. */
  put(key: string, body: Buffer, contentType: string): Promise<"created" | "exists">;
  /** Read bytes back, or undefined when the key does not exist. */
  get(key: string): Promise<Buffer | undefined>;
}

export interface R2Settings {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Only for tests: defaults to https://<accountId>.r2.cloudflarestorage.com */
  endpoint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const sha256Hex = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();

// RFC 3986 encoding as required by SigV4 (each path segment, "/" kept).
const encodeSegment = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
export const encodePath = (path: string) =>
  path.split("/").map(encodeSegment).join("/");

export interface SignInput {
  method: string;
  /** Already-encoded path, starting with "/". */
  path: string;
  query?: string;
  headers: Record<string, string>;
  payloadHash: string;
  amzDate: string; // YYYYMMDDTHHMMSSZ
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Returns the Authorization header value for an AWS SigV4 request. */
export function signV4(input: SignInput) {
  const service = input.service ?? "s3";
  const date = input.amzDate.slice(0, 8);
  const names = Object.keys(input.headers)
    .map((n) => n.toLowerCase())
    .sort();
  const lower = Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const canonicalHeaders = names
    .map((n) => `${n}:${String(lower[n]).trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    input.query ?? "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const key = hmac(
    hmac(hmac(hmac("AWS4" + input.secretAccessKey, date), input.region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

const amzDateNow = () =>
  new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export class R2Store implements ObjectStore {
  private readonly endpoint: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly settings: R2Settings) {
    this.endpoint = new URL(
      settings.endpoint ?? `https://${settings.accountId}.r2.cloudflarestorage.com`,
    );
    this.fetcher = settings.fetch ?? fetch;
  }

  private async send(
    method: "PUT" | "GET",
    key: string,
    body?: Buffer,
    extra: Record<string, string> = {},
  ) {
    const path = "/" + encodePath(this.settings.bucket) + "/" + encodePath(key);
    const payloadHash = sha256Hex(body ?? "");
    const headers: Record<string, string> = {
      host: this.endpoint.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDateNow(),
      ...extra,
    };
    headers.authorization = signV4({
      method,
      path,
      headers,
      payloadHash,
      amzDate: headers["x-amz-date"]!,
      region: "auto",
      accessKeyId: this.settings.accessKeyId,
      secretAccessKey: this.settings.secretAccessKey,
    });
    const { host: _host, ...sent } = headers;
    return this.fetcher(new URL(path, this.endpoint), {
      method,
      headers: sent,
      // A view over the same memory, not a copy (files can be up to 25 MB).
      body: body ? (new Uint8Array(body.buffer, body.byteOffset, body.length) as Uint8Array<ArrayBuffer>) : undefined,
      signal: AbortSignal.timeout(this.settings.timeoutMs ?? 60000),
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    // If-None-Match: * asks R2 to refuse rather than overwrite an existing key.
    // R2 also checks the body against x-amz-content-sha256.
    const response = await this.send("PUT", key, body, {
      "content-type": contentType,
      "if-none-match": "*",
    });
    await response.arrayBuffer().catch(() => undefined);
    if (response.ok) return "created" as const;
    if (response.status === 412) return "exists" as const;
    throw new Error(`R2 upload failed with status ${response.status}`);
  }

  async get(key: string) {
    const response = await this.send("GET", key);
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      return undefined;
    }
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      throw new Error(`R2 download failed with status ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
