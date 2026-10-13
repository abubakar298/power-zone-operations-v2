import { z } from "zod";
const percent = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,4})?$/, "Enter a nonnegative markup percentage.");
const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with up to two decimals.");
export const pricingFieldsSchema = z.object({
  boqRevisionId: z.uuid(),
  revisionRequestId: z.uuid().optional(),
  presentation: z.enum(["No Breakup", "Basic Breakup", "Full Breakup"]),
  groupBessPackages: z.boolean().optional(),
  saleType: z.enum(["Tax Deal", "Cash Deal"]).optional(),
  cashGstTreatment: z
    .enum(["Included in selling price", "No GST added"])
    .optional(),
  taxMode: z.enum(["Tax Included", "Show Sales Tax Separately"]),
  markups: z
    .object({
      solar: percent,
      structure: percent,
      // Confidential markup is omitted from Coordinator revision responses.
      // The active server policy supplies the authoritative value.
      bess: percent.default("0"),
      earthing: percent,
      balance: percent,
      rest: percent,
    })
    .default({
      solar: "10",
      structure: "10",
      bess: "30",
      earthing: "10",
      balance: "25",
      rest: "25",
    }),
  additionalCategory: z
    .enum(["solar", "structure", "earthing", "bess", "other"])
    .optional(),
  // Accepted for compatibility with older drafts; pricing never applies it.
  discount: amount.optional(),
  discountMode:z.enum(["Pre-approved","Custom"]).optional(),
  discountPercent: z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, "Enter a discount from 0 to 100%.").refine(v=>Number(v)<=100,"Discount cannot exceed 100%.").optional(),
  roundedTotal:amount.optional(),
  discountApprovalEvidence:z.array(z.object({id:z.uuid(),filename:z.string().min(1).max(200)})).max(10).optional(),
  preparedBy: z.string().trim().min(1).max(100),
  remarks: z.string().trim().max(2000).default(""),
  additionalMarkup: percent.optional(),
  additionalTaxRate: z.enum(["0", "10", "18"]).optional(),
});
export const pricingSchema = pricingFieldsSchema.transform((v) => ({
  ...v,
  cashGstTreatment: v.saleType === "Cash Deal" ? v.cashGstTreatment : undefined,
}));
export type PricingInput = z.infer<typeof pricingSchema>;
export const quotationSchema = z.object({
  previewPricing:pricingSchema.optional(),
  acknowledgePriceChange: z.boolean().optional(),
  revisionRequestId: z.uuid().optional(),
  pricingId: z.uuid(),
  discount: amount.optional(),
  quotedDate: z.iso.date(),
  additionalItem: z
    .object({
      description: z.string().trim().min(1).max(1500),
      cost: amount,
      markup: percent,
      taxRate: z.enum(["0", "10", "18"]),
    })
    .optional(),
  validity: z.string().trim().min(1).max(100),
  proposedBy: z.string().trim().min(1).max(100),
  descriptions: z.array(z.string().trim().min(1).max(1500)).max(90).optional(),
});
export type QuotationInput = z.infer<typeof quotationSchema>;
