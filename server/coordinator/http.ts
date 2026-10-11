import { externalEvidenceSchema } from "../approvals/external.js";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { Router, type RequestHandler } from "express";
import { HttpError } from "../http/errors.js";
import { CoordinatorRepository } from "./repository.js";
export function coordinatorHttp(
  repo: CoordinatorRepository,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (
      req.method !== "GET" &&
      ["Operations", "Inventory", "Accounts"].includes(
        req.authSession!.user.role,
      )
    )
      throw new HttpError(
        403,
        "Department accounts cannot change commercial workflow.",
      );
    next();
  });
  r.get("/projects", async (req, res) =>
    res.json(await repo.projects(req.authSession!.user.id)),
  );
  r.get("/project", async (req, res) => {
    const key = z.string().min(1).max(500).safeParse(req.query.key);
    if (!key.success) throw new HttpError(400, "Select a project.");
    res.json(await repo.project(req.authSession!.user.id, key.data));
  });
  r.get("/", async (req, res) => {
    const scope = req.query.scope ?? "mine";
    if (scope !== "mine" && scope !== "team")
      throw new HttpError(400, "Choose My work or Team work.");
    if (
      scope === "team" &&
      !["Admin", "Management"].includes(req.authSession!.user.role)
    )
      throw new HttpError(403, "Team overview requires management access.");
    res.json(
      await repo.overview(
        req.authSession!.user.id,
        scope === "team",
        req.query.includeTraining === "true",
      ),
    );
  });
  r.post("/quotations/:id/external-approval", async (req, res) => {
    if (
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    const v = externalEvidenceSchema.safeParse(req.body);
    if (!v.success || !z.uuid().safeParse(req.params.id).success)
      throw new HttpError(
        400,
        "Attach approval screenshots, approver and confirmation.",
      );
    res
      .status(201)
      .json(
        await repo.event(
          req.authSession!.user.id,
          String(req.params.id),
          "Approved",
          v.data.comments,
          v.data,
        ),
      );
  });
  r.get("/dispatch", async (req, res) => {
    const v = z
      .object({
        quotationId: z.uuid().optional(),
        cniVersionId: z.uuid().optional(),
      })
      .strict()
      .refine((v) => !!v.quotationId !== !!v.cniVersionId)
      .safeParse(req.query);
    if (!v.success) throw new HttpError(400, "Select a quotation.");
    res.json({
      record: await repo.dispatchRecord(req.authSession!.user.id, v.data),
    });
  });
  r.post("/dispatch", async (req, res) => {
    if (
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    const v = z
      .object({
        quotationId: z.uuid().optional(),
        cniVersionId: z.uuid().optional(),
        recipient: z.enum(["Customer", "Salesperson"]),
        notes: z.string().trim().min(1).max(2000),
        confirmed: z.literal(true),
      })
      .strict()
      .refine((v) => !!v.quotationId !== !!v.cniVersionId)
      .safeParse(req.body);
    if (!v.success)
      throw new HttpError(
        400,
        "Confirm delivery and enter the recipient details.",
      );
    res.status(201).json(await repo.dispatch(req.authSession!.user.id, v.data));
  });
  r.post("/events", async (req, res) => {
    if (
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    const v = z
      .object({
        quotationId: z.uuid(),
        kind: z.enum([
          "Submitted",
          "Approved",
          "Changes requested",
          "PO received",
        ]),
        notes: z.string().trim().max(2000).default(""),
        acknowledgePriceChange: z.boolean().optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!v.success) throw new HttpError(400, "Check the document and action.");
    if (v.data.kind === "Changes requested" && !v.data.notes)
      throw new HttpError(400, "Enter revision feedback.");
    res
      .status(201)
      .json(
        await repo.event(
          req.authSession!.user.id,
          v.data.quotationId,
          v.data.kind,
          v.data.notes,
          undefined,
          v.data.acknowledgePriceChange,
        ),
      );
  });
  return r;
}
