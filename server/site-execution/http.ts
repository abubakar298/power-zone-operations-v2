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
  STAGES,
  STAGE_LABELS,
  LATE_AFTER_DAYS,
  REGIONS,
  SITE_TYPES,
  CONNECTION_STATUSES,
} from "./schema.js";
import { SiteExecutionRepository } from "./repository.js";

export function siteExecutionHttp(repo: SiteExecutionRepository, requireSession: RequestHandler) {
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
  r.get("/", async (req, res) =>
    res.json({
      sites: await repo.list(req.authSession!.user.id),
      stages: STAGES.map((key) => ({ key, label: STAGE_LABELS[key] })),
      regions: REGIONS,
      siteTypes: SITE_TYPES,
      connectionStatuses: CONNECTION_STATUSES,
      lateAfterDays: LATE_AFTER_DAYS,
    }),
  );
  r.get("/:id", async (req, res) => res.json(await repo.get(req.authSession!.user.id, id(req.params.id))));
  r.post("/:id/stage", async (req, res) =>
    res.json(await repo.setStage(req.authSession!.user.id, id(req.params.id), parse(stageSchema, req.body))),
  );
  r.post("/:id/fields", async (req, res) =>
    res.json(await repo.updateFields(req.authSession!.user.id, id(req.params.id), parse(fieldsSchema, req.body))),
  );
  r.post("/:id/photo-checks", async (req, res) =>
    res.json(await repo.setPhotoCheck(req.authSession!.user.id, id(req.params.id), parse(photoCheckSchema, req.body))),
  );
  r.post("/:id/problems", async (req, res) =>
    res.status(201).json(await repo.addProblem(req.authSession!.user.id, id(req.params.id), parse(problemSchema, req.body))),
  );
  r.post("/:id/problems/:problemId/resolve", async (req, res) =>
    res.json(
      await repo.resolveProblem(
        req.authSession!.user.id,
        id(req.params.id),
        id(req.params.problemId, "problem"),
        parse(resolveSchema, req.body),
      ),
    ),
  );
  return r;
}
