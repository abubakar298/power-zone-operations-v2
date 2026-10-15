import {manualIpoSchema} from "../documents/manual-ipo.js";
import { z } from "zod";
import { surveySchema } from "../boq/schema.js";
export const workflowRoutes = [
  "survey-quote",
  "quick-quote",
  "survey-framework",
  "direct-framework",
] as const;
const text = z.string().trim().max(4000),
  short = z.string().trim().max(200);
export const createSchema = z
  .object({
    requestKey: z.uuid(),
    customerId: z.number().int().nonnegative(),
    siteId: z.number().int().positive().optional(),
    siteVersion: z.number().int().positive().optional(),
    confirmSiteChange: z.boolean().default(false),
    customerAddedHere: z.boolean().default(false),
    siteName: short.min(1),
    siteCode: short
      .min(1)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/),
    region: short.default(""),
    siteAddress: text.default(""),
    siteContact: short.default(""),
    sitePhone: short.max(100).default(""),
    route: z.enum(workflowRoutes),
    frameworkId: z.uuid().optional(),
    planningOwnerId: z.uuid().optional(),
    coordinatorId: z.uuid().optional(),
    notes: text.min(1),
    headsup: z.boolean().default(false),
  })
  .strict();
export const designReviewSchema = z
  .object({
    survey: surveySchema.omit({
      uploadIds: true,
      ocrText: true,
      ocrReviewed: true,
    }),
    frameworkId: z.uuid().optional(),
    profileKey: short.min(1),
    profileVersion: z.number().int().positive(),
    itemSelections: z
      .record(z.string().max(200), z.string().max(200))
      .default({}),
    markups: z
      .record(z.string().max(200), z.string().regex(/^\d{1,3}(\.\d{1,4})?$/))
      .default({}),
    notes: text.default(""),
  })
  .strict();
export const comparisonSchema = z
  .object({
    materials: z
      .array(
        z
          .object({
            lineId: short.min(1),
            itemId: short,
            description: z.string().max(2000),
            qty: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/),
            unit: short,
            brand: short,
            specification: z.string().max(2000),
          })
          .strict(),
      )
      .max(300),
    billing: z
      .array(
        z
          .object({
            lineId: short.min(1),
            description: z.string().max(2000),
            qty: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/),
            unit: short,
            rate: z.string().regex(/^\d{1,14}(\.\d{1,8})?$/),
            amount: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/),
            taxRate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/),
          })
          .strict(),
      )
      .max(300),
    subtotal: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/),
    tax: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/),
    total: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/),
    discount: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/),
    saleType: z.enum(["Tax Deal", "Cash Deal"]),
    cashGstTreatment: short,
    invoiceCompany: short.min(1),
    terms: z.record(z.string().max(100), z.string().max(2000)),
  })
  .strict();
export const receiptSchema = z
  .object({
    reference: short.min(1),
    date: z.iso.date(),
    evidenceId: z.uuid(),
    basisType: z.enum(["quotation", "framework"]),
    quotationId: z.uuid().optional(),
    frameworkId: z.uuid().optional(),
    actual: comparisonSchema.optional(),
    ipoNumber:manualIpoSchema.optional(),
    confirmationType:z.enum(["Customer PO","WhatsApp approval"]).default("Customer PO"),
    saleDetails:z.record(z.string(),z.string().max(2000)).optional(),
    reviewed: z.literal(true),
    customerNtn: short.default(""),
    customerStrn: short.default(""),
    notes: text.min(1),
  })
  .strict().superRefine((v,c)=>{if(v.confirmationType==='Customer PO'&&!v.actual)c.addIssue({code:'custom',message:'Compare the uploaded PO with its approved commercial basis.'});});
export const actionSchema = z
  .object({
    version: z.number().int().positive(),
    requestKey: z.uuid(),
    action: z.enum([
      "send-design",
      "edit-request",
      "assign",
      "start-survey",
      "save-site-picture-link",
      "save-survey-inputs",
      "review-survey-inputs",
      "save-survey-completion",
      "save-customer-survey",
      "save-customer-survey-draft",
      "import-survey-reading",
      "report",
      "begin-review",
      "review",
      "submit-technical-review",
      "no-feasible-solution",
      "review-survey-handoff",
      "handoff",
      "technical-return",
      "commercial-return",
      "dispatch",
      "decision",
      "headsup",
      "advance",
      "receipt",
      "resolve",
      "link-quote",
      "resume",
      "undo",
      "request-return",
    ]),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();
export const fileSchema = z
  .object({
    kind: z.enum([
      "Request evidence",
      "Survey report",
      "Survey photo",
      "Recommendation sending evidence",
      "PO / confirmation",
      "Heads-up evidence",
      "Revision evidence",
    ]),
    filename: short.min(1),
    mime: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    base64: z.string().min(1).max(12000000),
  })
  .strict();
