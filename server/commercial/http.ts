import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { pricingSchema, quotationSchema } from "./schema.js";
import { CommercialRepository } from "./repository.js";
import { buildQuotationPdf } from "./report.js";
export function commercialHttp(
  repo: CommercialRepository,
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
  const save = z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    requestKey: z.uuid(),
  });
  const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
    const v = schema.safeParse(value);
    if (!v.success) throw new HttpError(400, v.error.issues[0].message);
    return v.data;
  };
  const id = (value: unknown) => parse(z.uuid(), value);
  r.get("/pricing", async (req, res) =>
    res.json({ pricing: await repo.pricingList(req.authSession!.user.id) }),
  );
  r.post("/pricing/preview", async (req, res) =>
    res.json(
      await repo.pricingPreview(
        req.authSession!.user.id,
        parse(pricingSchema, req.body),
      ),
    ),
  );
  r.post("/pricing", async (req, res) => {
    const key = parse(save, req.body);
    res
      .status(201)
      .json(
        await repo.pricingSave(
          req.authSession!.user.id,
          parse(pricingSchema, req.body),
          key.fingerprint,
          key.requestKey,
        ),
      );
  });
  r.get("/pricing/:id", async (req, res) =>
    res.json(
      await repo.pricingGet(req.authSession!.user.id, id(req.params.id)),
    ),
  );
  r.get("/quotations", async (_req, res) =>
    res.json({ quotations: await repo.quotationList() }),
  );
  r.post("/quotations/preview", async (req, res) =>
    res.json(
      await repo.quotationPreview(
        req.authSession!.user.id,
        parse(quotationSchema, req.body),
      ),
    ),
  );
  r.post("/quotations", async (req, res) => {
    const key = parse(save, req.body);
    res
      .status(201)
      .json(
        await repo.quotationSave(
          req.authSession!.user.id,
          parse(quotationSchema, req.body),
          key.fingerprint,
          key.requestKey,
        ),
      );
  });
  r.post("/quotations/preview.pdf", async (req, res) => {
    const p = await repo.quotationPreview(
      req.authSession!.user.id,
      parse(quotationSchema, req.body),
    );
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="DRAFT-quotation.pdf"',
        "Cache-Control": "private, no-store",
      })
      .send(buildQuotationPdf(p.snapshot));
  });
  r.get("/quotations/:id/copy", async (req, res) => {
    const row = await repo.quotationGet(id(req.params.id));
    await repo.pricingGet(req.authSession!.user.id, row.pricing_id);
    res.json({
      pricingId: row.pricing_id,
      ...row.snapshot.input,
      discount: row.snapshot.footer.find((r: any) => r.label === "Special Discount")?.amount ?? "0",
      descriptions: row.snapshot.lines.map((l: any) => l.description),
    });
  });
  r.get("/quotations/:id/quotation.pdf", async (req, res) => {
    const q = await repo.quotationGet(id(req.params.id));
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${q.number}-quotation.pdf"`,
        "Cache-Control": "private, no-store",
      })
      .send(buildQuotationPdf(q.snapshot, q.number));
  });
  r.get("/quotations/:id", async (req, res) =>
    res.json(await repo.quotationGet(id(req.params.id))),
  );
  return r;
}
