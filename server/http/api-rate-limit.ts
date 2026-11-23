import type { Request, RequestHandler } from "express";
import { parse } from "cookie";
import { digest } from "../auth/crypto.js";

// A general limit on API requests (everything under /api), on top of the
// stricter sign-in, password and backup limits in server/auth and
// server/backups. It only stops floods: normal work stays far below it.
//
// Counts live in this server's memory for one minute. That costs no database
// write per request and is enough for one web service; a restart starts every
// count again. Set API_RATE_LIMIT_PER_MINUTE=0 on Render to switch it off.
export const defaultApiRequestsPerMinute = 600;
const windowMs = 60_000;
// Above this many people/computers in one minute, new unknown session cookies
// are counted by computer instead, so made-up cookies cannot fill the memory.
const maxBuckets = 20_000;

type Bucket = { count: number; resetAt: number };
type RateLimitedEntry = {
  event: "request.rate_limited";
  requestId?: string;
  method: string;
  /** First part of the path only (for example /api/accounts-workspace): no ids or query values. */
  area: string;
  /** Whether the count was for a signed-in session or for a computer without one. Never who. */
  by: "session" | "address";
  limit: number;
};

/** First path part after /api: enough to see which screen hit the limit, without record ids. */
function areaOf(req: Request) {
  const part = req.originalUrl.split("?")[0].split("/")[2] ?? "";
  return /^[a-z0-9-]{1,40}$/i.test(part) ? `/api/${part}` : "/api";
}

// Render's health check and the email provider's delivery reports are never limited.
function exempt(req: Request) {
  const path = req.originalUrl.split("?")[0];
  return path === "/api/health" || path.startsWith("/api/email-webhooks/");
}

export function apiRateLimit({
  limit,
  cookieName,
  now = () => Date.now(),
  log = (entry: RateLimitedEntry) => console.warn(JSON.stringify(entry)),
}: {
  /** Requests allowed per minute for one session (or one computer without a session). 0 = off. */
  limit: number;
  cookieName: string;
  now?: () => number;
  log?: (entry: RateLimitedEntry) => void;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let nextSweep = 0;
  return (req, res, next) => {
    if (limit <= 0 || exempt(req)) return next();
    const time = now();
    if (time >= nextSweep) {
      for (const [key, bucket] of buckets)
        if (bucket.resetAt <= time) buckets.delete(key);
      nextSweep = time + windowMs;
    }
    // Signed-in requests count per session (so a shared office address never
    // blocks colleagues); requests without a session count per computer.
    const token = parse(req.headers.cookie ?? "")[cookieName];
    const sessionKey =
      token && /^[A-Za-z0-9_-]{43}$/.test(token) ? `session:${digest(token)}` : undefined;
    const by =
      sessionKey && (buckets.has(sessionKey) || buckets.size < maxBuckets)
        ? "session"
        : "address";
    const key = by === "session" ? sessionKey! : `address:${req.ip ?? "unknown"}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= time) {
      bucket = { count: 0, resetAt: time + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count <= limit) return next();
    // One log line per minute per session/computer, not one per refused request.
    if (bucket.count === limit + 1)
      log({
        event: "request.rate_limited",
        requestId: res.locals.requestId,
        method: req.method,
        area: areaOf(req),
        by,
        limit,
      });
    res
      .status(429)
      .set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - time) / 1000))))
      .json({
        message: "Too many requests in one minute. Please wait a moment and try again.",
        requestId: res.locals.requestId,
      });
  };
}
