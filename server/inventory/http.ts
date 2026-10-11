import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { InventoryRepository } from "./repository.js";
import { entrySchema } from "./reconciliation.js";
export function inventoryHttp(
  repo: InventoryRepository,
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
    const parsed = z.uuid().safeParse(v);
    if (!parsed.success) throw new HttpError(400, "Invalid report identifier.");
    return parsed.data;
  };
  r.get("/jobs", async (req, res) =>
    res.json({ jobs: await repo.jobs(req.authSession!.user.id) }),
  );
  r.get("/job", async (req, res) =>
    res.json(
      await repo.job(req.authSession!.user.id, String(req.query.key ?? "")),
    ),
  );
  r.get("/reports", async (req, res) =>
    res.json({ reports: await repo.list(req.authSession!.user.id) }),
  );
  r.get("/reports/:id", async (req, res) =>
    res.json(await repo.detail(req.authSession!.user.id, id(req.params.id))),
  );
  r.post("/bulk-received", async(req,res)=>res.json(await repo.receiveBulk(req.authSession!.user.id)));
  r.post("/reports", async (req, res) => {
    const input = z
      .object({
        jobKey: z.string().max(100),
        version: z.number().int().min(0),
        stage: z.enum([
          "IRR Received",
          "Draft Reconciliation",
          "Sent to Accounts",
        ]),
        entry: entrySchema,
        requestKey: z.uuid(),
      })
      .strict()
      .safeParse(req.body);
    if (!input.success)
      throw new HttpError(400, "Check the installation report fields.");
    res.json(await repo.save(req.authSession!.user.id, input.data));
  });
  r.post("/reports/:id/files", async (req, res) => {
    const input = z
      .object({
        filename: z.string().trim().min(1).max(200),
        mediaType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
        base64: z.string().max(11200000),
      })
      .strict()
      .safeParse(req.body);
    if (!input.success)
      throw new HttpError(400, "Select a supported report attachment.");
    res.json(
      await repo.upload(
        req.authSession!.user.id,
        id(req.params.id),
        input.data.filename,
        input.data.mediaType,
        input.data.base64,
      ),
    );
  });
  r.get("/files/:id", async (req, res) => {
    const file = await repo.file(req.authSession!.user.id, id(req.params.id));
    res
      .set({
        "Content-Type": file.media_type,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "X-Content-Type-Options": "nosniff",
      })
      .send(file.content);
  });
  return r;
}
