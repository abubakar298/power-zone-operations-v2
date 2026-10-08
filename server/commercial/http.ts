import { commercialPolicySchema } from "./active-policy.js";
import { managementOnly } from "../http/permissions.js";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { pricingSchema, quotationSchema } from "./schema.js";
import { CommercialRepository } from "./repository.js";
import { buildQuotationPdf, buildQuotationComparisonPdf } from "./report.js";
export function commercialHttp(
  repo: CommercialRepository,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (
      req.method !== "GET" &&
      ["Operations", "Inventory", "Accounts"].includes(
        req.authSession!.user.role,
      )
    )
      throw new HttpError(
        403,
        "Department accounts cannot change costing, quotations or IPO approvals.",
      );
    next();
  });
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
  r.get("/revision-requests", async (req, res) =>
    res.json({
      requests: await repo.revisionRequests(req.authSession!.user.id),
    }),
  );
  r.post("/revision-requests", async (req, res) => {
    const v = parse(
      z
        .object({
          sourceQuotationId: z.uuid(),
          origin: z.enum(["Internal management", "Customer"]),
          costingChange: z.boolean(),
          reason: z.string().trim().min(1).max(2000),
          requestedBy: z.string().trim().min(1).max(200),
          requestKey: z.uuid(),
        })
        .strict(),
      req.body,
    );
    res
      .status(201)
      .json(
        await repo.revisionStart(
          req.authSession!.user.id,
          v.sourceQuotationId,
          v.origin,
          v.costingChange,
          v.reason,
          v.requestedBy,
          v.requestKey,
        ),
      );
  });
  r.get("/revision-context/:id", async (req, res) =>
    res.json(
      await repo.revisionContext(req.authSession!.user.id, id(req.params.id)),
    ),
  );
  r.get("/standard-policy", async (req, res) =>
    res.json(await repo.standardPolicy(req.authSession!.user.id)),
  );
  r.post("/standard-policy", managementOnly, async (req, res) => {
    const v = parse(
      z
        .object({
          expectedVersion: z.number().int().positive(),
          policy: commercialPolicySchema,
        })
        .strict(),
      req.body,
    );
    res
      .status(201)
      .json(
        await repo.saveStandardPolicy(
          req.authSession!.user.id,
          v.policy,
          v.expectedVersion,
        ),
      );
  });
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
  r.get("/quotations", async (req, res) =>
    res.json({
      quotations: await repo.quotationList(req.authSession!.user.id),
    }),
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
  r.post("/quotations/:id/discount-review", async (req, res) => {
    const v = parse(
      z.union([
        z.object({ targetMarkup: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/) }).strict(),
        z
          .object({ discount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/) })
          .strict(),
        z
          .object({ targetMargin: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/) })
          .strict(),
      ]),
      req.body,
    );
    res.json(
      await repo.discountReview(req.authSession!.user.id, id(req.params.id), v),
    );
  });
  r.get("/quotations/:id/copy", async (req, res) => {
    const row = await repo.quotationGet(id(req.params.id));
    await repo.pricingGet(req.authSession!.user.id, row.pricing_id);
    res.json({
      pricingId: row.pricing_id,
      ...row.snapshot.input,
      discount:
        row.snapshot.footer.find((r: any) => r.label === "Special Discount")
          ?.amount ?? "0",
      additionalItem: await repo.additionalInput(
        req.authSession!.user.id,
        row.id,
      ),
      descriptions: row.snapshot.lines
        .slice(
          0,
          row.snapshot.scopeCount ??
            (row.snapshot.presentation === "Full Breakup" ? 16 : undefined),
        )
        .map((l: any) => l.description),
    });
  });
  r.get("/quotations/:id/comparison.pdf", async (req, res) => {
    const comparison = await repo.quotationVariants(
      req.authSession!.user.id,
      id(req.params.id),
    );
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${comparison.number}-all-formats.pdf"`,
        "Cache-Control": "private, no-store",
      })
      .send(
        buildQuotationComparisonPdf(comparison.variants, comparison.number),
      );
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
