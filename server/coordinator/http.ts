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
  r.get("/", async (req, res) => {
    const scope = req.query.scope ?? "mine";
    if (scope !== "mine" && scope !== "team")
      throw new HttpError(400, "Choose My work or Team work.");
    if (
      scope === "team" &&
      !["Admin", "Management"].includes(req.authSession!.user.role)
    )
      throw new HttpError(403, "Team overview requires management access.");
    res.json(await repo.overview(req.authSession!.user.id, scope === "team"));
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
        ),
      );
  });
  return r;
}
