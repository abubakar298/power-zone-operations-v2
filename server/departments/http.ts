import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import {
  DepartmentRepository,
  departmentSchema,
  checkpointSchema,
} from "./repository.js";
export function departmentsHttp(
  repo: DepartmentRepository,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.use(requireSession);
  const department = (v: unknown) => {
    const p = departmentSchema.safeParse(v);
    if (!p.success) throw new HttpError(400, "Choose a department.");
    return p.data;
  };
  r.get("/:department", async (req, res) =>
    res.json(
      await repo.portal(
        req.authSession!.user.id,
        department(req.params.department),
      ),
    ),
  );
  r.get("/:department/:id/history", async (req, res) => {
    const p = z.uuid().safeParse(req.params.id);
    if (!p.success) throw new HttpError(400, "Invalid document.");
    res.json({
      history: await repo.history(
        req.authSession!.user.id,
        department(req.params.department),
        p.data,
      ),
    });
  });
  r.post("/:department/checkpoints", async (req, res) => {
    if (
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    const p = checkpointSchema.safeParse(req.body);
    if (!p.success)
      throw new HttpError(
        400,
        "Select a stage and enter a progress note or document reference.",
      );
    res
      .status(201)
      .json(
        await repo.checkpoint(
          req.authSession!.user.id,
          department(req.params.department),
          p.data,
        ),
      );
  });
  return r;
}
