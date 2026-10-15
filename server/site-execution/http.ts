import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import {
  fieldsSchema,
  photoCheckSchema,
  problemSchema,
  resolveSchema,
  stageSchema,
  stockCountSchema,
  reservationSchema,
  releaseSchema,
  vendorSchema,
  vendorAssignSchema,
  procurementCreateSchema,
  procurementUpdateSchema,
  cableUsageSchema,
  additionalItemSchema,
  removalSchema,
  STAGES,
  STAGE_LABELS,
  LATE_AFTER_DAYS,
  REGIONS,
  SITE_TYPES,
  CONNECTION_STATUSES,
} from "./schema.js";
import { SiteExecutionRepository } from "./repository.js";
import { StockRepository } from "./stock.js";
import { VendorsRepository, VENDOR_CATEGORIES } from "./vendors.js";
import { ProcurementRepository, PROCUREMENT_STATUSES } from "./procurement.js";
import { ClosureRepository } from "./closure.js";

export interface SiteExecutionRepositories {
  sites: SiteExecutionRepository;
  stock: StockRepository;
  vendors: VendorsRepository;
  procurement: ProcurementRepository;
  closure: ClosureRepository;
}

export function siteExecutionHttp(repos: SiteExecutionRepositories, requireSession: RequestHandler) {
  const { sites, stock, vendors, procurement, closure } = repos;
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (req.method !== "GET" && !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken))
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  const id = (v: unknown, what = "site record") => {
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

  // Overview and reference lists.
  r.get("/", async (req, res) =>
    res.json({
      sites: await sites.list(actor(req)),
      stages: STAGES.map((key) => ({ key, label: STAGE_LABELS[key] })),
      regions: REGIONS,
      siteTypes: SITE_TYPES,
      connectionStatuses: CONNECTION_STATUSES,
      vendorCategories: VENDOR_CATEGORIES,
      procurementStatuses: PROCUREMENT_STATUSES,
      lateAfterDays: LATE_AFTER_DAYS,
    }),
  );

  // Stock: shortage overview, Store counts, per-site reservations. Registered before /:id.
  r.get("/stock", async (req, res) => res.json(await stock.overview(actor(req))));
  r.post("/stock/counts", async (req, res) => {
    await stock.setCount(actor(req), parse(stockCountSchema, req.body));
    res.json(await stock.overview(actor(req)));
  });

  // Vendors master.
  r.get("/vendors", async (req, res) => res.json({ vendors: await vendors.list(actor(req)), categories: VENDOR_CATEGORIES, regions: REGIONS }));
  r.post("/vendors", async (req, res) => res.status(201).json(await vendors.save(actor(req), parse(vendorSchema, req.body))));

  // Procurement requests.
  r.get("/procurement", async (req, res) => {
    const site = typeof req.query.site === "string" ? id(req.query.site) : undefined;
    res.json({ requests: await procurement.list(actor(req), site), statuses: PROCUREMENT_STATUSES, categories: VENDOR_CATEGORIES });
  });
  r.post("/procurement", async (req, res) => {
    const requestId = await procurement.create(actor(req), parse(procurementCreateSchema, req.body));
    res.status(201).json({ id: requestId, requests: await procurement.list(actor(req)) });
  });
  r.post("/procurement/:pid", async (req, res) => {
    await procurement.update(actor(req), id(req.params.pid, "procurement request"), parse(procurementUpdateSchema, req.body));
    res.json({ requests: await procurement.list(actor(req)) });
  });

  // Reports across sites. Registered before /:id.
  r.get("/reports/cable-variance", async (req, res) => res.json(await closure.cableVarianceReport(actor(req))));
  r.get("/reports/additional-items", async (req, res) => res.json({ items: await closure.additionalItemsReport(actor(req)) }));

  // One site.
  r.get("/:id", async (req, res) => res.json(await sites.get(actor(req), id(req.params.id))));
  r.get("/:id/materials", async (req, res) => res.json(await stock.siteMaterials(actor(req), id(req.params.id))));
  r.post("/:id/stage", async (req, res) => res.json(await sites.setStage(actor(req), id(req.params.id), parse(stageSchema, req.body))));
  r.post("/:id/fields", async (req, res) => res.json(await sites.updateFields(actor(req), id(req.params.id), parse(fieldsSchema, req.body))));
  r.post("/:id/photo-checks", async (req, res) => res.json(await sites.setPhotoCheck(actor(req), id(req.params.id), parse(photoCheckSchema, req.body))));
  r.post("/:id/problems", async (req, res) => res.status(201).json(await sites.addProblem(actor(req), id(req.params.id), parse(problemSchema, req.body))));
  r.post("/:id/problems/:problemId/resolve", async (req, res) =>
    res.json(await sites.resolveProblem(actor(req), id(req.params.id), id(req.params.problemId, "problem"), parse(resolveSchema, req.body))),
  );
  r.post("/:id/reservations", async (req, res) => {
    const siteId = id(req.params.id);
    await stock.reserve(actor(req), siteId, parse(reservationSchema, req.body));
    res.status(201).json(await stock.siteMaterials(actor(req), siteId));
  });
  r.post("/:id/reservations/:rid/release", async (req, res) => {
    const siteId = id(req.params.id);
    await stock.release(actor(req), siteId, id(req.params.rid, "reservation"), parse(releaseSchema, req.body));
    res.json(await stock.siteMaterials(actor(req), siteId));
  });
  r.post("/:id/vendors", async (req, res) => {
    const siteId = id(req.params.id);
    await vendors.assign(actor(req), siteId, parse(vendorAssignSchema, req.body));
    res.status(201).json(await sites.get(actor(req), siteId));
  });
  r.post("/:id/vendors/:aid/remove", async (req, res) => {
    const siteId = id(req.params.id);
    await vendors.unassign(actor(req), siteId, id(req.params.aid, "vendor assignment"));
    res.json(await sites.get(actor(req), siteId));
  });
  r.get("/:id/cables", async (req, res) => res.json({ cables: await closure.cables(actor(req), id(req.params.id)) }));
  r.post("/:id/cables", async (req, res) => {
    const siteId = id(req.params.id);
    await closure.setCableUsage(actor(req), siteId, parse(cableUsageSchema, req.body));
    res.json({ cables: await closure.cables(actor(req), siteId) });
  });
  r.get("/:id/additional-items", async (req, res) => res.json({ items: await closure.additionalItems(actor(req), id(req.params.id)) }));
  r.post("/:id/additional-items", async (req, res) => {
    const siteId = id(req.params.id);
    await closure.addAdditionalItem(actor(req), siteId, parse(additionalItemSchema, req.body));
    res.status(201).json({ items: await closure.additionalItems(actor(req), siteId) });
  });
  r.post("/:id/additional-items/:aid/remove", async (req, res) => {
    const siteId = id(req.params.id);
    await closure.removeAdditionalItem(actor(req), siteId, id(req.params.aid, "additional item"), parse(removalSchema, req.body));
    res.json({ items: await closure.additionalItems(actor(req), siteId) });
  });
  return r;
}
