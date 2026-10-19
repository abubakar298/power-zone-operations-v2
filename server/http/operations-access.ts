import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

/**
 * The Operations login reaches only what its workflow needs (Moaz, 19 Oct 2026).
 * Everything else under /api answers 403 for that role, so a hidden menu item
 * cannot be reached by URL either. Extend this list on request; nothing else
 * in the app grants Operations access on its own.
 */
const OPERATIONS_ALLOWED: { method?: "GET"; pattern: RegExp; purpose: string }[] = [
  { pattern: /^\/api\/auth(\/|$)/, purpose: "own session, sign-out and password" },
  { pattern: /^\/api\/dashboard(\/|$)/, purpose: "signed-in user and shell" },
  { pattern: /^\/api\/notifications(\/|$)/, purpose: "notification bell" },
  { pattern: /^\/api\/site-execution(\/|$)/, purpose: "sites board, site details, stock, vendors, procurement, reports" },
  { method: "GET", pattern: /^\/api\/project-workflow\/advance-inbox$/, purpose: "advance BOQ search on BOQ to Operations" },
];

export function describeOperationsAccess() {
  return OPERATIONS_ALLOWED.map((rule) => ({ method: rule.method ?? "any", path: rule.pattern.source, purpose: rule.purpose }));
}

export const operationsAccess: RequestHandler = (req, _res, next) => {
  const session = req.authSession;
  if (!session || session.user.role !== "Operations") return next();
  const path = req.originalUrl.split("?")[0];
  const allowed = OPERATIONS_ALLOWED.some(
    (rule) => rule.pattern.test(path) && (!rule.method || req.method === rule.method),
  );
  if (allowed) return next();
  throw new HttpError(403, "This is not part of the Operations workspace.");
};
