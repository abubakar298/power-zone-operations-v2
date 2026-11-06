import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import {
  additionalItemSchema, assignVendorSchema, cableSchema, fieldsSchema, moveSchema, picturesSchema, problemSchema, reasonSchema,
  resolveSchema, vendorSchema, CONNECTION_STATUSES, LATE_AFTER_DAYS, REGIONS, SCOPES, SCOPE_LABELS, SITE_TYPES, STAGES, STAGE_LABELS, VENDOR_CATEGORIES,
} from "./schema.js";
import type { SiteWorkflowRepository } from "./repository.js";

export function siteWorkflowHttp(sites: SiteWorkflowRepository, requireSession: RequestHandler) {
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (req.method !== "GET" && !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken))
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  const id = (v: unknown, what = "site") => {
    const p = z.uuid().safeParse(v);
    if (!p.success) throw new HttpError(400, `Invalid ${what} ID.`);
    return p.data;
  };
  const parse = <T,>(schema: z.ZodType<T>, body: unknown): T => {
    const p = schema.safeParse(body);
    if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? "Invalid input.");
    return p.data;
  };
  const actor = (req: { authSession?: { user: { id: string } } }) => req.authSession!.user.id;

  r.get("/", async (req, res) =>
    res.json({
      sites: await sites.list(actor(req)),
      stages: STAGES.map((key) => ({ key, label: STAGE_LABELS[key] })),
      scopes: SCOPES.map((key) => ({ key, label: SCOPE_LABELS[key] })),
      regions: REGIONS,
      siteTypes: SITE_TYPES,
      connectionStatuses: CONNECTION_STATUSES,
      vendorCategories: VENDOR_CATEGORIES,
      lateAfterDays: LATE_AFTER_DAYS,
    }),
  );
  r.get("/vendors", async (req, res) => res.json(await sites.vendors(actor(req))));
  r.post("/vendors", async (req, res) => res.json(await sites.saveVendor(actor(req), parse(vendorSchema, req.body))));
  r.get("/report", async (req, res) => res.json(await sites.report(actor(req))));

  r.get("/:id", async (req, res) => res.json(await sites.get(actor(req), id(req.params.id))));
  r.post("/:id/forward", async (req, res) => res.json(await sites.forward(actor(req), id(req.params.id), parse(moveSchema, req.body))));
  r.post("/:id/back", async (req, res) => res.json(await sites.back(actor(req), id(req.params.id), parse(moveSchema, req.body))));
  r.post("/:id/update", async (req, res) => res.json(await sites.update(actor(req), id(req.params.id), parse(fieldsSchema, req.body))));
  r.post("/:id/pictures", async (req, res) => res.json(await sites.setPictures(actor(req), id(req.params.id), parse(picturesSchema, req.body))));
  r.post("/:id/problems", async (req, res) => res.json(await sites.addProblem(actor(req), id(req.params.id), parse(problemSchema, req.body))));
  r.post("/:id/problems/:problemId/resolve", async (req, res) =>
    res.json(await sites.resolveProblem(actor(req), id(req.params.id), id(req.params.problemId, "problem"), parse(resolveSchema, req.body))),
  );
  r.post("/:id/vendors", async (req, res) => res.json(await sites.assignVendor(actor(req), id(req.params.id), parse(assignVendorSchema, req.body))));
  r.post("/:id/vendors/:assignmentId/remove", async (req, res) =>
    res.json(await sites.removeVendor(actor(req), id(req.params.id), id(req.params.assignmentId, "assignment"), parse(reasonSchema, req.body))),
  );
  r.post("/:id/cables", async (req, res) => res.json(await sites.setCable(actor(req), id(req.params.id), parse(cableSchema, req.body))));
  r.post("/:id/additional-items", async (req, res) => res.json(await sites.addAdditionalItem(actor(req), id(req.params.id), parse(additionalItemSchema, req.body))));
  r.post("/:id/additional-items/:itemId/remove", async (req, res) =>
    res.json(await sites.withdrawAdditionalItem(actor(req), id(req.params.id), id(req.params.itemId, "item"), parse(reasonSchema, req.body))),
  );
  return r;
}
