import { z } from "zod";

export const STAGES = [
  "ipo_received",
  "material_planning",
  "procurement",
  "delivery_scheduled",
  "dispatched",
  "installation",
  "commissioning",
  "documents",
  "closed",
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  ipo_received: "IPO received",
  material_planning: "Material planning",
  procurement: "Procurement",
  delivery_scheduled: "Delivery scheduled",
  dispatched: "Dispatched",
  installation: "Installation",
  commissioning: "Commissioning",
  documents: "Documents",
  closed: "Closed",
};
/** Days a site may sit in one stage before the board flags it. Moaz, 15 Oct 2026. */
export const LATE_AFTER_DAYS = 2;
export const SITE_TYPES = ["Solar", "BESS", "Solar + BESS", "UPS"] as const;
export const CONNECTION_STATUSES = ["Connected", "Not connected", "N/A"] as const;
export const REGIONS = [
  "Punjab",
  "Sindh",
  "Khyber Pakhtunkhwa",
  "Balochistan",
  "Gilgit-Baltistan",
  "Azad Jammu and Kashmir",
  "Islamabad Capital Territory",
] as const;

const isoDate = z.iso.date();
export const stageSchema = z
  .object({
    stage: z.enum(STAGES),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
export const fieldsSchema = z
  .object({
    siteType: z.enum(SITE_TYPES).nullable().optional(),
    region: z.enum(REGIONS).nullable().optional(),
    materialDeliveryPlanned: isoDate.nullable().optional(),
    materialDeliveryActual: isoDate.nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    matriCloudStatus: z.enum(CONNECTION_STATUSES).nullable().optional(),
    fourGStatus: z.enum(CONNECTION_STATUSES).nullable().optional(),
    customerSignoff: z.boolean().nullable().optional(),
    doDate: isoDate.nullable().optional(),
    acknowledgementDate: isoDate.nullable().optional(),
    submittedToCustomerDate: isoDate.nullable().optional(),
    advanceClaimed: z.boolean().optional(),
    finalClaimed: z.boolean().optional(),
    documentsNote: z.string().trim().max(2000).optional(),
  })
  .strict();
export type FieldsInput = z.infer<typeof fieldsSchema>;
export const photoCheckSchema = z
  .object({ date: isoDate, pictures: z.boolean() })
  .strict();
export const problemSchema = z
  .object({ problem: z.string().trim().min(1).max(2000) })
  .strict();
export const resolveSchema = z
  .object({ resolution: z.string().trim().max(2000).default("") })
  .strict();

// Slice 2: stock, vendors and procurement.
const quantity = z.string().trim().regex(/^\d{1,14}(\.\d{1,6})?$/, "Enter a quantity as a number, up to six decimals.");
const positiveQuantity = quantity.refine((v) => Number(v) > 0, "Quantity must be more than zero.");
const money = z.string().trim().regex(/^\d{1,18}(\.\d{1,2})?$/, "Enter an amount as a number, up to two decimals.");
export const VENDOR_CATEGORY_VALUES = ["Structure", "Delivery", "Electrical labour", "Earthing", "Material supplier"] as const;
export const PROCUREMENT_STATUS_VALUES = ["Not started", "Quoted", "Ordered", "Received", "Cancelled"] as const;
export const stockCountSchema = z
  .object({ itemKey: z.string().trim().min(1).max(200), quantity, note: z.string().trim().max(500).default("") })
  .strict();
export const reservationSchema = z
  .object({ itemKey: z.string().trim().min(1).max(200), quantity: positiveQuantity, note: z.string().trim().max(500).default("") })
  .strict();
export const releaseSchema = z.object({ reason: z.string().trim().max(500).default("") }).strict();
export const vendorSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(200),
    category: z.enum(VENDOR_CATEGORY_VALUES),
    regions: z.array(z.enum(REGIONS)).max(10).default([]),
    contactPerson: z.string().trim().max(200).default(""),
    phone: z.string().trim().max(50).default(""),
    email: z.string().trim().max(200).default(""),
    notes: z.string().trim().max(2000).default(""),
    status: z.enum(["Active", "Inactive"]).default("Active"),
  })
  .strict();
export const vendorAssignSchema = z
  .object({
    category: z.enum(VENDOR_CATEGORY_VALUES),
    vendorId: z.uuid(),
    agreedDate: isoDate.nullable().default(null),
    notes: z.string().trim().max(500).default(""),
  })
  .strict();
export const procurementCreateSchema = z
  .object({
    executionId: z.uuid().nullable().default(null),
    itemKey: z.string().trim().min(1).max(200).nullable().default(null),
    serviceCategory: z.enum(VENDOR_CATEGORY_VALUES).nullable().default(null),
    description: z.string().trim().min(1).max(500),
    quantity: positiveQuantity.nullable().default(null),
    unit: z.string().trim().max(50).default(""),
    vendorId: z.uuid().nullable().default(null),
    expectedDate: isoDate.nullable().default(null),
    amount: money.nullable().default(null),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict()
  .refine((v) => v.itemKey || v.serviceCategory, "Choose an item or a service category.");
export const procurementUpdateSchema = z
  .object({
    status: z.enum(PROCUREMENT_STATUS_VALUES).optional(),
    vendorId: z.uuid().nullable().optional(),
    expectedDate: isoDate.nullable().optional(),
    amount: money.nullable().optional(),
    notes: z.string().trim().max(2000).optional(),
    note: z.string().trim().max(500).default(""),
  })
  .strict();

// Slice 3: cables against BOQ, additional items.
const nonNegativeQuantity = quantity;
export const cableUsageSchema = z
  .object({
    itemKey: z.string().trim().min(1).max(200),
    usedQty: nonNegativeQuantity,
    returnedQty: nonNegativeQuantity.default("0"),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
export const additionalItemSchema = z
  .object({
    itemKey: z.string().trim().min(1).max(200).nullable().default(null),
    description: z.string().trim().min(1).max(500),
    quantity: positiveQuantity,
    unit: z.string().trim().max(50).default(""),
    reason: z.string().trim().max(1000).default(""),
  })
  .strict();
export const removalSchema = z.object({ reason: z.string().trim().max(500).default("") }).strict();
