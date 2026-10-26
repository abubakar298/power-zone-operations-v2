import { z } from "zod";

/**
 * The site workflow after an IPO is issued to Operations (Moaz, 19 Oct 2026):
 * IPO received -> Under planning -> Delivery -> [install & commission by us?]
 *   yes: Installation -> Commissioning -> Handover -> Doc dispatch -> Closed
 *   no:  Closed
 */
export const STAGES = ["ipo_received", "planning", "delivery", "installation", "commissioning", "handover", "doc_dispatch", "closed"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  ipo_received: "IPO received",
  planning: "Under planning",
  delivery: "Delivery",
  installation: "Installation",
  commissioning: "Commissioning",
  handover: "Handover",
  doc_dispatch: "Doc dispatch",
  closed: "Closed",
};
export const SCOPES = ["installation", "delivery_only"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = { installation: "Installation and commissioning by us", delivery_only: "Delivery only" };

/** Days a site may sit in one stage before the board flags it late. Moaz, 15 Oct 2026. */
export const LATE_AFTER_DAYS = 2;
export const SITE_TYPES = ["Solar", "BESS", "Solar + BESS", "UPS"] as const;
export const CONNECTION_STATUSES = ["Connected", "Not connected", "N/A"] as const;
export const REGIONS = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan", "Azad Jammu and Kashmir", "Islamabad Capital Territory"] as const;
export const VENDOR_CATEGORIES = ["Structure", "Delivery", "Electrical labour", "Earthing", "Material supplier"] as const;

/** The stage after `stage`. Delivery branches on the scope decision. */
export function nextStage(stage: Stage, scope: Scope | null): Stage | null {
  switch (stage) {
    case "ipo_received": return "planning";
    case "planning": return "delivery";
    case "delivery": return scope === "delivery_only" ? "closed" : scope === "installation" ? "installation" : null;
    case "installation": return "commissioning";
    case "commissioning": return "handover";
    case "handover": return "doc_dispatch";
    case "doc_dispatch": return "closed";
    case "closed": return null;
  }
}
/** The stage before `stage`, for corrections. A closed delivery-only site goes back to Delivery. */
export function previousStage(stage: Stage, scope: Scope | null): Stage | null {
  switch (stage) {
    case "ipo_received": return null;
    case "planning": return "ipo_received";
    case "delivery": return "planning";
    case "installation": return "delivery";
    case "commissioning": return "installation";
    case "handover": return "commissioning";
    case "doc_dispatch": return "handover";
    case "closed": return scope === "delivery_only" ? "delivery" : "doc_dispatch";
  }
}

const isoDate = z.iso.date();
const note = z.string().trim().max(500).default("");
const quantity = z.string().trim().regex(/^\d{1,14}(\.\d{1,6})?$/, "Enter a quantity as a number, up to six decimals.");

export const moveSchema = z.object({ note }).strict();
export const fieldsSchema = z
  .object({
    siteType: z.enum(SITE_TYPES).nullable().optional(),
    region: z.enum(REGIONS).nullable().optional(),
    scope: z.enum(SCOPES).nullable().optional(),
    expectedStart: isoDate.nullable().optional(),
    expectedDelivery: isoDate.nullable().optional(),
    expectedCompletion: isoDate.nullable().optional(),
    deliveredOn: isoDate.nullable().optional(),
    // Solar + BESS sites: the day the batteries and inverters arrived (Quality Control deadlines, 26 Oct 2026).
    bessDeliveredOn: isoDate.nullable().optional(),
    startedOn: isoDate.nullable().optional(),
    installationCompletedOn: isoDate.nullable().optional(),
    commissionedOn: isoDate.nullable().optional(),
    matriCloud: z.enum(CONNECTION_STATUSES).nullable().optional(),
    fourG: z.enum(CONNECTION_STATUSES).nullable().optional(),
    handedOverOn: isoDate.nullable().optional(),
    customerSignoff: z.boolean().nullable().optional(),
    doDate: isoDate.nullable().optional(),
    acknowledgementDate: isoDate.nullable().optional(),
    submittedToCustomerDate: isoDate.nullable().optional(),
    advanceClaimed: z.boolean().optional(),
    finalClaimed: z.boolean().optional(),
    documentsNote: z.string().trim().max(2000).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type FieldsInput = z.infer<typeof fieldsSchema>;
export const picturesSchema = z.object({ day: isoDate, pictures: z.boolean() }).strict();
export const problemSchema = z.object({ problem: z.string().trim().min(1).max(2000) }).strict();
export const resolveSchema = z.object({ resolution: z.string().trim().max(2000).default("") }).strict();
export const vendorSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(200),
    category: z.enum(VENDOR_CATEGORIES),
    contactPerson: z.string().trim().max(200).default(""),
    phone: z.string().trim().max(50).default(""),
    notes: z.string().trim().max(2000).default(""),
    status: z.enum(["Active", "Inactive"]).default("Active"),
  })
  .strict();
export type VendorInput = z.infer<typeof vendorSchema>;
export const assignVendorSchema = z
  .object({ category: z.enum(VENDOR_CATEGORIES), vendorId: z.uuid(), agreedDate: isoDate.nullable().default(null), notes: note })
  .strict();
export const reasonSchema = z.object({ reason: note }).strict();
export const cableSchema = z
  .object({ itemKey: z.string().trim().min(1).max(200), usedQty: quantity, returnedQty: quantity.default("0"), note })
  .strict();
export const additionalItemSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: quantity.refine((v) => Number(v) > 0, "Quantity must be more than zero."),
    unit: z.string().trim().max(50).default(""),
    reason: z.string().trim().max(1000).default(""),
  })
  .strict();
