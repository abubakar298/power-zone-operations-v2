import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { HttpError } from "./errors.js";

/** Department boundaries apply to every method, including PDFs and downloads.
 * Financial records are available to Accounts only after an explicit handoff.
 * Shared customer/rate masters belong to the coordination workflow, not the
 * department delivery portals. Record ownership is checked separately.
 */
const commercialRoles = new Set(["Admin", "Management", "Coordinator"]);
export function workflowBoundary(pool: Pool): RequestHandler {
  return async (req, _res, next) => {
    const role = req.authSession!.user.role;
    const path = req.originalUrl.split("?")[0];
    if (commercialRoles.has(role)) return next();
    if (role === "Design" && path.startsWith("/api/survey-uploads"))
      return next();
    if (role === "Operations" && path.startsWith("/api/operations")) {
      // Source previews are coordinator tools before issuance. Operations works
      // exclusively from the frozen requirements it has actually received.
      if (
        !/^\/api\/operations\/sources(?:\/|$)/.test(path) &&
        !(path === "/api/operations" && req.method !== "GET") &&
        !(path === "/api/operations/" && req.method !== "GET")
      )
        return next();
    }
    if (
      role === "Inventory" &&
      /^\/api\/operations\/store\/[^/]+\/report\.pdf$/.test(path) &&
      req.method === "GET"
    )
      return next();
    if (
      (role === "Inventory" || role === "Accounts") &&
      path.startsWith(`/api/departments/${role}`)
    )
      return next();
    if (role === "Accounts" && req.method === "GET") {
      const match = path.match(
        /^\/api\/orders\/([0-9a-f-]{36})(?:\/(?:ipo|peachtree)\.pdf)?$/i,
      );
      if (match) {
        const handed = await pool.query(
          "SELECT 1 FROM ipo_accounts_handoffs WHERE ipo_id=$1",
          [match[1]],
        );
        if (handed.rowCount) return next();
      }
    }
    throw new HttpError(
      403,
      "Your department does not have access to this workflow.",
    );
  };
}

/** The coordinator owns a document through its originating BOQ/draft, even
 * when management creates the approved revision. UUIDs are never authority. */
export const resourceOwnership = {
  cni: "SELECT 1 FROM cni_proposals WHERE id=$1 AND created_by=$2",
  boq: "SELECT 1 FROM boq_revisions r JOIN boqs b ON b.id=r.boq_id JOIN survey_drafts d ON d.id=b.draft_id WHERE r.id=$1 AND (b.created_by=$2 OR d.owner_id=$2 OR r.created_by=$2)",
  pricing:
    "SELECT 1 FROM commercial_pricing_versions p JOIN boq_revisions r ON r.id=p.boq_revision_id JOIN boqs b ON b.id=r.boq_id JOIN survey_drafts d ON d.id=b.draft_id WHERE p.id=$1 AND (p.created_by=$2 OR b.created_by=$2 OR d.owner_id=$2)",
  quotation:
    "SELECT 1 FROM quotation_versions q JOIN boq_revisions r ON r.id=q.boq_revision_id JOIN boqs b ON b.id=r.boq_id JOIN survey_drafts d ON d.id=b.draft_id WHERE q.id=$1 AND (q.created_by=$2 OR b.created_by=$2 OR d.owner_id=$2)",
  ipo: "SELECT 1 FROM internal_purchase_orders i LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE i.id=$1 AND (i.created_by=$2 OR s.created_by=$2)",
  revisionRequest:
    "SELECT 1 FROM quotation_revision_requests WHERE id=$1 AND created_by=$2",
  draft: "SELECT 1 FROM survey_drafts WHERE id=$1 AND owner_id=$2",
  submission: "SELECT 1 FROM ipo_submissions WHERE id=$1 AND created_by=$2",
  review:
    "SELECT 1 FROM boq_review_submissions s JOIN survey_drafts d ON d.id=s.draft_id WHERE s.id=$1 AND d.owner_id=$2",
  store:
    "SELECT 1 FROM store_boq_issuances st JOIN operations_boq_issuances o ON o.id=st.issuance_id JOIN internal_purchase_orders i ON i.id=o.ipo_id LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE st.id=$1 AND (o.created_by=$2 OR i.created_by=$2 OR s.created_by=$2)",
  issuance:
    "SELECT 1 FROM operations_boq_issuances o JOIN internal_purchase_orders i ON i.id=o.ipo_id LEFT JOIN ipo_submissions s ON s.id=i.submission_id WHERE o.id=$1 AND (o.created_by=$2 OR i.created_by=$2 OR s.created_by=$2)",
} as const;
export type Resource = keyof typeof resourceOwnership;
export async function requireOwnedResource(
  pool: Pool,
  actor: string,
  resource: Resource,
  id: unknown,
) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return; // route schemas report malformed IDs
  const result = await pool.query(resourceOwnership[resource], [id, actor]);
  if (!result.rowCount)
    throw new HttpError(
      404,
      "Document not found or unavailable to your account.",
    );
}
export function coordinatorRecords(pool: Pool): RequestHandler {
  return async (req, _res, next) => {
    if (req.authSession!.user.role !== "Coordinator") return next();
    const actor = req.authSession!.user.id;
    const path = req.originalUrl.split("?")[0];
    const routes: [RegExp, Resource][] = [
      [/^\/api\/operations\/store\/([0-9a-f-]{36})(?:\/|$)/i, "store"],
      [/^\/api\/boqs\/reviews\/([0-9a-f-]{36})(?:\/|$)/i, "review"],
      [/^\/api\/boqs\/drafts\/([0-9a-f-]{36})(?:\/|$)/i, "draft"],
      [/^\/api\/boqs\/([0-9a-f-]{36})(?:\/|$)/i, "boq"],
      [/^\/api\/commercial\/pricing\/([0-9a-f-]{36})(?:\/|$)/i, "pricing"],
      [/^\/api\/commercial\/quotations\/([0-9a-f-]{36})(?:\/|$)/i, "quotation"],
      [/^\/api\/commercial\/revision-context\/([0-9a-f-]{36})(?:\/|$)/i, "boq"],
      [
        /^\/api\/orders\/quotation-defaults\/([0-9a-f-]{36})(?:\/|$)/i,
        "quotation",
      ],
      [/^\/api\/orders\/submissions\/([0-9a-f-]{36})(?:\/|$)/i, "submission"],
      [/^\/api\/orders\/([0-9a-f-]{36})(?:\/|$)/i, "ipo"],
      [/^\/api\/operations\/sources\/([0-9a-f-]{36})(?:\/|$)/i, "ipo"],
      [/^\/api\/operations\/([0-9a-f-]{36})(?:\/|$)/i, "issuance"],
      [
        /^\/api\/coordinator\/quotations\/([0-9a-f-]{36})(?:\/|$)/i,
        "quotation",
      ],
    ];
    for (const [pattern, resource] of routes) {
      const match = path.match(pattern);
      if (match) await requireOwnedResource(pool, actor, resource, match[1]);
    }
    const body = req.body;
    if (body && typeof body === "object") {
      const unsavedQuotationPreview=req.method==='POST'&&/^\/api\/commercial\/quotations\/preview(?:\.pdf|-download)?\/?$/.test(path)&&body.previewPricing&&typeof body.previewPricing==='object';
      const references: Record<string, Resource> = {
        boqRevisionId: "boq",
        baseRevisionId: "boq",
        pricingId: "pricing",
        quotationId: "quotation",
        sourceQuotationId: "quotation",
        revisionRequestId: "revisionRequest",
        draftId: "draft",
        ipoId: "ipo",
      };
      for (const source of [body, body.input,...(unsavedQuotationPreview?[body.previewPricing]:[])]) {
        if (!source || typeof source !== "object") continue;
        for (const [key, resource] of Object.entries(references))
          if (source[key]&&!(unsavedQuotationPreview&&source===body&&key==='pricingId'))
            await requireOwnedResource(pool, actor, resource, source[key]);
      }
      if (path === "/api/boqs/drafts" && body.id)
        await requireOwnedResource(pool, actor, "draft", body.id);
    }
    next();
  };
}

/** SQL fragments contain only fixed, developer-supplied identifiers. Actor
 * values remain bound parameters. Apply before LIMIT so other owners cannot
 * crowd a coordinator's own records out of a queue. */
export function ownedCondition(
  resource: Resource,
  idExpression: string,
  actorParameter: string,
) {
  return `(EXISTS(SELECT 1 FROM users WHERE id=${actorParameter} AND active AND role IN('Admin','Management')) OR EXISTS(${resourceOwnership[
    resource
  ]
    .replace(/\b(r|b|d|p|q|i|s|o)\b/g, "acl_$1")
    .replaceAll("$1", idExpression)
    .replaceAll("$2", actorParameter)}))`;
}

export const managementOnly: RequestHandler = (req, _res, next) => {
  if (!["Admin", "Management"].includes(req.authSession!.user.role))
    throw new HttpError(403, "Management access required.");
  next();
};
