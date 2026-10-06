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
  return r;
}
