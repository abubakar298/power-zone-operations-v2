import { z } from "zod";

export const REQUEST_STATUSES = ["draft", "pending_approval", "approved", "rejected", "ordered", "received", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  pending_approval: "With Abu Bakar",
  approved: "Approved",
  rejected: "Rejected",
  ordered: "Ordered",
  received: "Received into Store",
  cancelled: "Cancelled",
};

const isoDate = z.iso.date();
const amount = z.string().trim().regex(/^\d{1,14}(\.\d{1,4})?$/, "Enter a number, up to four decimals.");
const positive = amount.refine((v) => Number(v) > 0, "Quantity must be more than zero.");

export const requestSchema = z
  .object({
    title: z.string().trim().min(1, "Give the request a title.").max(200),
    purpose: z.string().trim().max(2000).default(""),
    neededBy: isoDate.nullable().default(null),
    deliveryTo: z.string().trim().max(300).default("Power Zone Store"),
    paymentTerms: z.string().trim().max(500).default(""),
  })
  .strict();
export const requestUpdateSchema = requestSchema.partial().strict();
export const lineSchema = z
  .object({ itemKey: z.string().trim().min(1).max(200), quantity: positive, unit: z.string().trim().max(30).default(""), note: z.string().trim().max(500).default("") })
  .strict();
export const lineUpdateSchema = z
  .object({ quantity: positive.optional(), unit: z.string().trim().min(1).max(30).optional(), note: z.string().trim().max(500).optional() })
  .strict();
export const quoteSchema = z
  .object({ vendor: z.string().trim().min(1, "Enter the vendor.").max(200), rate: amount, note: z.string().trim().max(500).default("") })
  .strict();
export const chooseSchema = z.object({ quoteId: z.uuid() }).strict();
export const decisionSchema = z
  .object({ decision: z.enum(["approve", "send_back", "reject"]), note: z.string().trim().max(1000).default("") })
  .strict();
export const orderedSchema = z.object({ orderReference: z.string().trim().min(1, "Enter the vendor order number(s).").max(500) }).strict();
export const noteSchema = z.object({ note: z.string().trim().max(1000).default("") }).strict();
export const countSchema = z
  .object({ itemKey: z.string().trim().min(1).max(200), quantity: amount, unit: z.string().trim().max(30).default(""), note: z.string().trim().max(500).default("") })
  .strict();
