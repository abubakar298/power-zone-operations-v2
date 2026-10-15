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
