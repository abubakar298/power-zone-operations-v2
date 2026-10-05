import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { surveySchema, surveyDraftSchema } from "./schema.js";
import { BoqRepository } from "./repository.js";
export function boqHttp(repo: BoqRepository, requireSession: RequestHandler) {
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
  r.get("/drafts", async (req, res) =>
    res.json({ drafts: await repo.drafts(req.authSession!.user.id) }),
  );
  r.get("/", async (_req, res) => res.json({ boqs: await repo.list() }));
  r.post("/drafts", async (req, res) => {
    const v = z
      .object({
        id: z.uuid().optional(),
        version: z.number().int().min(0),
        inputs: surveyDraftSchema,
      })
      .strict()
      .safeParse(req.body);
    if (!v.success)
      throw new HttpError(
        400,
        "Check customer, site, survey quantities, brands and prepared-by fields.",
      );
    res.json(
      await repo.draft(
        req.authSession!.user.id,
        v.data.id,
        v.data.version,
        v.data.inputs,
      ),
    );
  });
  r.post("/preview", async (req, res) => {
    const v = surveySchema.safeParse(req.body);
    if (!v.success)
      throw new HttpError(
        400,
        "Check all required survey fields and non-negative quantities.",
      );
    res.json(await repo.preview(v.data));
  });
  r.post("/save", async (req, res) => {
    const v = z
      .object({
        draftId: z.uuid(),
        version: z.number().int().positive(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .safeParse(req.body);
    if (!v.success)
      throw new HttpError(400, "Review your draft and costing before saving.");
    res
      .status(201)
      .json(
        await repo.save(
          req.authSession!.user.id,
          v.data.draftId,
          v.data.version,
          v.data.fingerprint,
        ),
      );
  });
  r.get("/uploads/:id", async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success)
      throw new HttpError(400, "Invalid attachment.");
    const a = await repo.attachment(
      req.authSession!.user.id,
      String(req.params.id),
    );
    res
      .set({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      })
      .send(a.content);
  });
  r.get("/:id", async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success)
      throw new HttpError(400, "Invalid BOQ.");
    res.json(await repo.get(String(req.params.id)));
  });
  return r;
}
export function uploadHttp(
  repo: BoqRepository,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.use(requireSession);
  r.post("/", async (req, res) => {
    if (
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    const v = z
      .object({
        filename: z
          .string()
          .min(1)
          .max(200)
          .refine((s) => !/[\x00-\x1f/\\]/.test(s)),
        mime: z.enum([
          "image/png",
          "image/jpeg",
          "application/pdf",
          "text/plain",
        ]),
        base64: z
          .string()
          .min(1)
          .max(11184812)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .safeParse(req.body);
    if (!v.success)
      throw new HttpError(
        400,
        "Upload a PNG, JPEG, PDF or text file up to 8 MB.",
      );
    const { filename, mime, base64 } = v.data,
      bytes = Buffer.from(base64, "base64");
    if (bytes.length > 8388608 || !bytes.length)
      throw new HttpError(413, "File must be 8 MB or smaller.");
    const valid =
      mime === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : mime === "application/pdf"
            ? bytes.subarray(0, 5).toString() === "%PDF-"
            : !bytes.includes(0);
    if (!valid)
      throw new HttpError(
        400,
        "The file content does not match its declared type.",
      );
    res
      .status(201)
      .json(await repo.upload(req.authSession!.user.id, filename, mime, bytes));
  });
  return r;
}
