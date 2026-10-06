import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import {
  issuanceSchema,
  deliveryPlanSchema,
  storeIssuanceSchema,
} from "./schema.js";
import { OperationsRepository } from "./repository.js";
import { buildOperationsPdf } from "./report.js";
export function operationsHttp(
  repo: OperationsRepository,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (
      req.method !== "GET" &&
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  const id = (v: unknown) => {
    const p = z.uuid().safeParse(v);
    if (!p.success) throw new HttpError(400, "Invalid issuance ID.");
    return p.data;
  };
  r.get("/portal", async (_req, res) => res.json(await repo.portal()));
  r.post("/:id/send-to-store", async (req, res) => {
    const p = storeIssuanceSchema.safeParse(req.body);
    if (!p.success)
      throw new HttpError(
        400,
        "Review the delivery plan before issuing to Store.",
      );
    res
      .status(201)
      .json(
        await repo.sendToStore(
          req.authSession!.user.id,
          id(req.params.id),
          p.data.deliveryPlanId,
          p.data.requestKey,
        ),
      );
  });
  r.get("/store/:id/report.pdf", async (req, res) => {
    const row = await repo.storeIssuance(id(req.params.id));
    res
      .type("application/pdf")
      .set("Content-Disposition", `attachment; filename="${row.number}.pdf"`)
      .send(buildOperationsPdf(row));
  });
  r.get("/", async (_req, res) => res.json({ issuances: await repo.list() }));
  r.post("/", async (req, res) => {
    const p = issuanceSchema.safeParse(req.body);
    if (!p.success) throw new HttpError(400, p.error.issues[0].message);
    res.status(201).json(await repo.issue(req.authSession!.user.id, p.data));
  });
  r.get("/sources/:id", async (req, res) =>
    res.json({ snapshot: await repo.source(id(req.params.id)) }),
  );
  r.get("/:id/delivery-plan", async (req, res) =>
    res.json({ plan: await repo.deliveryPlan(id(req.params.id)) }),
  );
  r.post("/:id/delivery-plan", async (req, res) => {
    const p = deliveryPlanSchema.safeParse(req.body);
    if (!p.success) throw new HttpError(400, p.error.issues[0].message);
    res
      .status(201)
      .json(
        await repo.planDelivery(
          req.authSession!.user.id,
          id(req.params.id),
          p.data,
        ),
      );
  });
  r.get("/:id/report.pdf", async (req, res) => {
    const row = await repo.get(id(req.params.id));
    res
      .type("application/pdf")
      .set("Content-Disposition", `attachment; filename="${row.number}.pdf"`)
      .send(buildOperationsPdf(row));
  });
  r.get("/:id", async (req, res) =>
    res.json(await repo.get(id(req.params.id))),
  );
  return r;
}
