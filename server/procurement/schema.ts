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
/** Store records what arrived, item by item; zero means it has not come yet. */
export const receiveSchema = z
  .object({
    lines: z.array(z.object({ itemKey: z.string().trim().min(1).max(200), quantity: amount }).strict()).min(1).max(200),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
export const countSchema = z
  .object({ itemKey: z.string().trim().min(1).max(200), quantity: amount, unit: z.string().trim().max(30).default(""), note: z.string().trim().max(500).default("") })
  .strict();

// Misc items BOQ (Moaz, 24 Oct 2026).
const miscKey = z.string().trim().regex(/^MSC-\d{3,}$/, "Choose an item from the misc items list.");
export const miscSaveSchema = z
  .object({
    version: z.number().int().positive().nullable(),
    optionKey: z.string().trim().min(1).max(40).nullable(),
    lines: z.array(z.object({ itemKey: miscKey, quantity: positive }).strict()).max(150),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
export const miscItemSchema = z
  .object({ name: z.string().trim().min(1, "Enter the item name.").max(200), unit: z.string().trim().min(1, "Enter the unit.").max(30) })
  .strict();
export const miscItemUpdateSchema = miscItemSchema.partial().extend({ active: z.boolean().optional() }).strict();
export const miscKeySchema = miscKey;

// Inverter, battery and BMS watch (Moaz, 24 Oct 2026).
export const watchSettingSchema = z.object({ leadDays: z.number().int().min(0).max(365), minStock: amount }).strict();
export const watchOrderSchema = z
  .object({
    vendor: z.string().trim().min(1, "Enter the supplier.").max(200),
    orderReference: z.string().trim().min(1, "Enter the order reference.").max(500),
    expectedOn: isoDate.nullable().default(null),
    note: z.string().trim().max(2000).default(""),
    lines: z.array(z.object({ itemKey: z.string().trim().min(1).max(200), quantity: positive, rate: amount.nullable().default(null) }).strict()).min(1, "Add at least one item.").max(30),
  })
  .strict();

// Requests for quotation and one vendor's quotation for many items at once (Moaz, 24 Oct 2026).
export const rfqSchema = z
  .object({
    vendors: z.array(z.object({ name: z.string().trim().min(1, "Enter the vendor's name.").max(200), contact: z.string().trim().max(300).default("") }).strict())
      .min(1, "Add at least one vendor.").max(20, "Up to 20 vendors per request for quotation."),
    dueOn: isoDate,
    terms: z.array(z.string().trim().max(500)).max(15),
  })
  .strict();
export const importQuotesSchema = z
  .object({
    vendor: z.string().trim().min(1, "Enter the vendor.").max(200),
    lines: z.array(z.object({ lineId: z.uuid(), rate: amount, note: z.string().trim().max(500).default("") }).strict()).min(1, "Enter at least one rate.").max(150),
  })
  .strict();
