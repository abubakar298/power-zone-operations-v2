import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { AccountsRepository, closureSchema } from "./repository.js";
export function accountsHttp(
  repo: AccountsRepository,
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
  const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
    const p = schema.safeParse(value);
    if (!p.success)
      throw new HttpError(
        400,
        "Check the Accounts fields and required references.",
      );
    return p.data;
  };
  r.get("/", async (req, res) =>
    res.json(await repo.overview(req.authSession!.user.id)),
  );
  r.get("/ipos/:id", async (req, res) =>
    res.json(
      await repo.comparison(
        req.authSession!.user.id,
        parse(z.uuid(), req.params.id),
      ),
    ),
  );
  r.post("/ipo-reviews", async (req, res) =>
    res.json(
      await repo.review(
        req.authSession!.user.id,
        parse(
          z
            .object({
              id: z.uuid(),
              version: z.number().int().nonnegative(),
              decision: z.enum(["Verified", "Returned for Revision"]),
              notes: z.string().trim().min(1).max(2000),
              requestKey: z.uuid(),
            })
            .strict(),
          req.body,
        ),
      ),
    ),
  );
  r.get("/job", async (req, res) =>
    res.json(
      await repo.job(req.authSession!.user.id, String(req.query.key ?? "")),
    ),
  );
  r.post("/return-report", async (req, res) =>
    res.json(
      await repo.returnReport(
        req.authSession!.user.id,
        parse(
          z
            .object({
              id: z.uuid(),
              version: z.number().int().positive(),
              notes: z.string().trim().min(1).max(2000),
              requestKey: z.uuid(),
            })
            .strict(),
          req.body,
        ),
      ),
    ),
  );
  r.post("/closures", async (req, res) =>
    res.json(
      await repo.saveClosure(
        req.authSession!.user.id,
        parse(closureSchema, req.body),
      ),
    ),
  );
  r.post("/closure-decisions", async (req, res) =>
    res.json(
      await repo.decision(
        req.authSession!.user.id,
        parse(
          z
            .object({
              id: z.uuid(),
              version: z.number().int().positive(),
              decision: z.enum(["Closed", "Returned for Revision"]),
              notes: z.string().trim().min(1).max(2000),
              requestKey: z.uuid(),
            })
            .strict(),
          req.body,
        ),
      ),
    ),
  );
  return r;
}
