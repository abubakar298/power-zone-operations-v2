import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { DesignRepository } from "./repository.js";
import { designDraftSchema } from "./schema.js";
export function designHttp(repo: DesignRepository, session: RequestHandler) {
  const r = Router();
  r.use(session);
  r.use((req, _res, next) => {
    if (
      req.method !== "GET" &&
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  const parse = <T>(schema: z.ZodType<T>, v: unknown) => {
    const p = schema.safeParse(v);
    if (!p.success) throw new HttpError(400, p.error.issues[0].message);
    return p.data;
  };
  r.get("/", async (req, res) =>
    res.json({ surveys: await repo.list(req.authSession!.user.id) }),
  );
  r.get("/references", async (req, res) =>
    res.json(await repo.references(req.authSession!.user.id)),
  );
  r.post("/", async (req, res) => {
    const v = parse(
      z
        .object({
          id: z.uuid().optional(),
          version: z.number().int().min(0),
          inputs: designDraftSchema,
        })
        .strict(),
      req.body,
    );
    res
      .status(201)
      .json(
        await repo.save(req.authSession!.user.id, v.id, v.version, v.inputs),
      );
  });
  r.post("/:id/send", async (req, res) => {
    const v = parse(
      z
        .object({
          version: z.number().int().positive(),
          coordinatorId: z.uuid(),
          verified: z.literal(true),
        })
        .strict(),
      req.body,
    );
    res
      .status(201)
      .json(
        await repo.send(
          req.authSession!.user.id,
          parse(z.uuid(), req.params.id),
          v.version,
          v.coordinatorId,
        ),
      );
  });
  r.get("/uploads/:id", async (req, res) => {
    const a = await repo.attachment(
      req.authSession!.user.id,
      parse(z.uuid(), req.params.id),
    );
    res
      .set({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      })
      .send(a.content);
  });
  return r;
}
