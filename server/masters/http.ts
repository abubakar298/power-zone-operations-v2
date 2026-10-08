import { canSeeBessCost, isBessEquipment } from "../http/cost-visibility.js";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { MastersRepository } from "./repository.js";
import { canWriteMaster } from "./permissions.js";

const text = z.string().trim().max(2000),
  name = text.min(1).max(200);
const status = z.enum(["Active", "Inactive"]);
const decimal = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,4})?$/,
    "Use a non-negative number with up to 4 decimals.",
  )
  .nullable();
const schemas = {
  customers: z
    .object({
      name,
      short_code: z.string().trim().min(1).max(30),
      contact_person: text,
      phone: text.max(100),
      email: z.union([z.literal(""), z.email().max(254)]),
      address: text,
      city: text.max(200).optional(),
      province: text.max(200).optional(),
      status,
      notes: text,
    })
    .strict(),
  sites: z
    .object({
      name,
      code: z.string().trim().min(1).max(30),
      location: text,
      status,
    })
    .strict(),
  brands: z.object({ status, notes: text }).strict(),
  rates: z
    .object({
      rate: decimal,
      status: z.enum(["Active", "Needs Rate", "Inactive"]),
      notes: text,
    })
    .strict(),
  rules: z
    .object({ value: decimal.refine((v) => v !== null), notes: text })
    .strict(),
  items: z
    .object({
      approved_specification: text,
      status: z.enum(["Need to enter", "Approved", "Needs review"]),
      notes: text,
    })
    .strict()
    .refine(
      (v) => v.status !== "Approved" || v.approved_specification.length > 0,
    ),
};
export function mastersHttp(
  repo: MastersRepository,
  requireSession: RequestHandler,
) {
  const router = Router();
  router.use(requireSession);
  router.get("/", async (_req, res) => res.json(await repo.list()));
  router.post("/customer-import/preview", async (req, res) => {
    if (
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    res.json(await repo.customerImport(req.authSession!.user.id, req.body));
  });
  router.post("/customer-import/commit", async (req, res) => {
    if (
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    const v = z
      .object({
        input: z.unknown(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        backupSaved: z.literal(true),
      })
      .strict()
      .safeParse(req.body);
    if (!v.success)
      throw new HttpError(
        400,
        "Confirm the downloaded backup and preview first.",
      );
    res.json(
      await repo.customerImport(
        req.authSession!.user.id,
        v.data.input,
        v.data.fingerprint,
        v.data.backupSaved,
      ),
    );
  });
  router.get("/:kind/history", async (req, res) => {
    const kind = z.enum(["rates", "rules", "items"]).safeParse(req.params.kind),
      key = z.string().min(1).max(200).safeParse(req.query.key);
    if (!kind.success || !key.success)
      throw new HttpError(400, "Choose a rate or rule to view history.");
    if(kind.data === "rates" && !canSeeBessCost(req.authSession!.user.role) && isBessEquipment({key:key.data}))throw new HttpError(403,"BESS equipment costs are restricted to Management.");
    res.json({ versions: await repo.history(kind.data, key.data) });
  });
  router.post("/:kind", async (req, res) => {
    const s = req.authSession!;
    if (!equalSecrets(req.get("X-CSRF-Token") ?? "", s.csrfToken))
      throw new HttpError(403, "Refresh the page and try again.");
    const kind = z
      .enum(["customers", "sites", "brands", "rates", "rules", "items"])
      .safeParse(req.params.kind);
    const request = z
      .object({
        id: z.string().min(1).max(200),
        version: z.number().int().min(0),
        values: z.unknown(),
      })
      .strict()
      .safeParse(req.body);
    if (!kind.success || !request.success)
      throw new HttpError(400, "Invalid master record.");
    if (kind.data === "rates" && isBessEquipment({key:request.data.id}) && !canSeeBessCost(s.user.role))throw new HttpError(403,"BESS equipment costs are restricted to Management.");
    if (!canWriteMaster(s.user.role, kind.data, request.data.id))
      throw new HttpError(
        403,
        "You do not have permission to change this master record.",
      );
    const input = schemas[kind.data].safeParse(request.data.values);
    if (!input.success)
      throw new HttpError(
        400,
        "Check required fields, email, status and numeric values.",
      );
    const { id, version } = request.data;
    if (
      ["customers", "sites", "brands"].includes(kind.data) &&
      !(kind.data === "customers" && id === "new") &&
      !/^\d+$/.test(id)
    )
      throw new HttpError(400, "Invalid record ID.");
    if (kind.data === "rules") {
      const value = Number((input.data as { value: string }).value);
      const integerKeys = [
        "engineering-4",
        "engineering-5",
        "engineering-7",
        "engineering-13",
        "engineering-14",
        "engineering-15",
        "engineering-16",
        "engineering-17",
        "engineering-18",
        "engineering-19",
        "engineering-20",
        "engineering-21",
        "engineering-22",
        "engineering-23",
        "engineering-24",
      ];
      const positiveKeys = [
        "engineering-4",
        "engineering-5",
        "engineering-6",
        "engineering-7",
        "engineering-8",
      ];
      if (
        (integerKeys.includes(id) && !Number.isInteger(value)) ||
        (positiveKeys.includes(id) && value === 0)
      )
        throw new HttpError(
          400,
          "This rule requires a positive size or whole quantity.",
        );
    }
    res.json(await repo.save(s.user.id, kind.data, id, version, input.data));
  });
  return router;
}
