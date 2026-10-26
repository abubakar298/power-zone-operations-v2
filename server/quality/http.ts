import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { QC_KINDS, kindLabel } from "./rules.js";
import type { QualityRepository } from "./repository.js";

const kind = z.enum(QC_KINDS);
const attachSchema = z
  .object({
    kind,
    filename: z.string().trim().min(1).max(200),
    mime: z.enum(["image/jpeg", "image/png", "application/pdf"]),
    base64: z.string().min(4).max(11_300_000).regex(/^[A-Za-z0-9+/]+=*$/, "The file could not be read."),
    originalSize: z.number().int().positive().max(200 * 1024 * 1024),
  })
  .strict();
const submitSchema = z.object({ kind, note: z.string().trim().max(1000).default("") }).strict();
const accessSchema = z
  .object({
    email: z.email("Enter the user's exact email.").max(254).transform((s) => s.trim().toLowerCase()),
    action: z.enum(["grant", "remove"]),
    reason: z.string().trim().min(3, "Write why (at least 3 characters).").max(500),
  })
  .strict();
const karachiMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

/** Quality Control site documents (Moaz, 26 Oct 2026). */
export function qualityHttp(repo: QualityRepository, requireSession: RequestHandler) {
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (req.method !== "GET" && !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)) throw new HttpError(403, "Refresh and try again.");
    next();
  });
  const id = (v: unknown, what: string) => {
    const p = z.uuid().safeParse(v);
    if (!p.success) throw new HttpError(400, `Invalid ${what} ID.`);
    return p.data;
  };
  const parse = <T,>(schema: z.ZodType<T>, body: unknown): T => {
    const p = schema.safeParse(body ?? {});
    if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? "Invalid input.");
    return p.data;
  };
  const actor = (req: { authSession?: { user: { id: string } } }) => req.authSession!.user.id;

  r.get("/me", async (req, res) => { const w = await repo.who(actor(req)); res.json({ upload: w.upload, view: w.view, manage: w.manage, kpi: w.kpi }); });
  r.get("/sites", async (req, res) => res.json(await repo.sites(actor(req))));
  r.get("/sites/:id", async (req, res) => res.json(await repo.site(actor(req), id(req.params.id, "site"))));
  r.post("/sites/:id/files", async (req, res) => res.json(await repo.attach(actor(req), id(req.params.id, "site"), parse(attachSchema, req.body), req)));
  r.post("/files/:fileId/remove", async (req, res) => res.json(await repo.removeDraft(actor(req), id(req.params.fileId, "file"))));
  r.post("/sites/:id/submit", async (req, res) => res.json(await repo.submit(actor(req), id(req.params.id, "site"), parse(submitSchema, req.body))));
  r.get("/files/:fileId", async (req, res) => {
    const f = await repo.file(actor(req), id(req.params.fileId, "file"));
    // File names follow the app's download naming through its downloadContext hook.
    res.locals.downloadContext = { documentType: `QC ${kindLabel(f.kind)}`.slice(0, 32), identity: `qc-file:${req.params.fileId}`, customer: f.customer, site: f.site, siteCode: f.siteCode };
    const safe = f.filename.replace(/[^A-Za-z0-9 ._-]+/g, " ").trim() || "document";
    res.type(f.mime).set("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${safe}"`).send(f.content);
  });
  r.get("/kpi", async (req, res) => {
    const month = typeof req.query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : karachiMonth();
    res.json(await repo.kpi(actor(req), month));
  });
  r.get("/access", async (req, res) => res.json(await repo.access(actor(req))));
  r.post("/access/change", async (req, res) => res.json(await repo.changeAccess(actor(req), parse(accessSchema, req.body), req)));
  return r;
}
