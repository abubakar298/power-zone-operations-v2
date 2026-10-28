import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { HttpError } from "./errors.js";

type Rule = { method?: "GET" | "POST"; pattern: RegExp; purpose: string };
/**
 * The Operations login reaches only what its workflow needs (Moaz, 19 Oct 2026).
 * Everything else under /api answers 403 for that role, so a hidden menu item
 * cannot be reached by URL either. Extend this list on request; nothing else
 * in the app grants Operations access on its own.
 */
const OPERATIONS_ALLOWED: Rule[] = [
  { method: "GET", pattern: /^\/api\/material-dispatches\/qc\/sites\/[^/]+\/(?:material-usage|evidence\/[0-9a-f-]{36})$/, purpose: "assigned-site material evidence; no warehouse access" },
  { method: "POST", pattern: /^\/api\/material-dispatches\/site-usage$/, purpose: "assigned QC site measurements; repository checks team and exact source" },
  { method: "GET", pattern: /^\/api\/material-dispatches\/drafts\/[0-9a-f-]{36}\/sites\/[0-9a-f-]{36}\/documents\/(?:customer-signoff|irr)\.pdf$/, purpose: "assigned-site printable sign-off only" },

  { pattern: /^\/api\/operations-board(\/|$)/, purpose: "assigned Operations board; server-side team and QC scopes" },
  { pattern: /^\/api\/auth(\/|$)/, purpose: "own session, sign-out and password" },
  { pattern: /^\/api\/dashboard(\/|$)/, purpose: "signed-in user and shell" },
  { pattern: /^\/api\/notifications(\/|$)/, purpose: "notification bell" },
  { pattern: /^\/api\/site-workflow(\/|$)/, purpose: "the site workflow after IPO: board, site pages, vendors, report" },
  { method: "GET", pattern: /^\/api\/project-workflow\/advance-inbox$/, purpose: "advance BOQ search on BOQ to Operations" },
  { method: "GET", pattern: /^\/api\/procurement\/me$/, purpose: "which workspace this login opens" },
];
/**
 * The Procurement buyer (an Operations-role account with the buyer capability, Moaz, 20 Oct 2026)
 * gets Procurement only unless separately assigned an Operations board role.
 */
const PROCUREMENT_ALLOWED: Rule[] = [
  { pattern: /^\/api\/auth(\/|$)/, purpose: "own session, sign-out and password" },
  { pattern: /^\/api\/dashboard(\/|$)/, purpose: "signed-in user and shell" },
  { pattern: /^\/api\/notifications(\/|$)/, purpose: "notification bell" },
  { pattern: /^\/api\/procurement(\/|$)/, purpose: "POs received, upcoming POs, inventory status, purchase requests" },
];

const describe = (rules: Rule[]) => rules.map((rule) => ({ method: rule.method ?? "any", path: rule.pattern.source, purpose: rule.purpose }));
export const describeOperationsAccess = () => describe(OPERATIONS_ALLOWED);
export const describeProcurementAccess = () => describe(PROCUREMENT_ALLOWED);

/** Applied after the session check on every workspace route. Other roles pass straight through. */
export function operationsAccess(pool: Pool): RequestHandler {
  return (req, _res, next) => {
    const session = req.authSession;
    if (!session || session.user.role !== "Operations") return next();
    const path = req.originalUrl.split("?")[0];
    pool
      .query("SELECT EXISTS(SELECT 1 FROM procurement_access WHERE user_id=$1 AND capability='buyer') AS buyer,(SELECT kind FROM operations_board_access WHERE user_id=$1) AS board_kind", [session.user.id])
      .then((r) => {
        const buyer = r.rows[0]?.buyer === true;
        const boardAssigned = Boolean(r.rows[0]?.board_kind);
        // Capabilities are independent: a buyer explicitly assigned to Operations
        // retains both jobs. Board repositories still enforce team/action scopes.
        const rules = buyer
          ? boardAssigned ? [...PROCUREMENT_ALLOWED, ...OPERATIONS_ALLOWED] : PROCUREMENT_ALLOWED
          : OPERATIONS_ALLOWED;
        // Fine-grained board staff must not bypass their team/QC scope through
        // the older all-sites workflow or advance-inbox API.
        if (boardAssigned && (/^\/api\/site-workflow(?:\/|$)/.test(path) || path === '/api/project-workflow/advance-inbox'))
          throw new HttpError(403, 'Use your assigned Operations board.');
        const allowed = rules.some((rule) => rule.pattern.test(path) && (!rule.method || req.method === rule.method));
        if (allowed) next();
        else next(new HttpError(403, buyer ? "This is not part of the Procurement workspace." : "This is not part of the Operations workspace."));
      })
      .catch(next);
  };
}
