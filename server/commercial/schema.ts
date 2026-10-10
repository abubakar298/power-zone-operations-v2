import { z } from "zod";
const percent = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,4})?$/, "Enter a nonnegative markup percentage.");
const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with up to two decimals.");
export const pricingSchema = z.object({
  boqRevisionId: z.uuid(),
  revisionRequestId: z.uuid().optional(),
  presentation: z.enum(["No Breakup", "Basic Breakup", "Full Breakup"]),
  groupBessPackages: z.boolean().optional(),
  taxMode: z.enum(["Tax Included", "Show Sales Tax Separately"]),
  markups: z.object({
    solar: percent,
    structure: percent,
    // Confidential markup is omitted from Coordinator revision responses.
    // The active server policy supplies the authoritative value.
    bess: percent.default("0"),
    earthing: percent,
    balance: percent,
    rest: percent,
  }).default({solar:"10",structure:"10",bess:"30",earthing:"10",balance:"25",rest:"25"}),
  additionalCategory: z.enum(["solar","structure","earthing","bess","other"]).optional(),
  // Accepted for compatibility with older drafts; pricing never applies it.
  discount: amount.optional(),
  preparedBy: z.string().trim().min(1).max(100),
  remarks: z.string().trim().max(2000).default(""),
  additionalMarkup: percent.optional(),
  additionalTaxRate: z.enum(["0", "10", "18"]).optional(),
});
export type PricingInput = z.infer<typeof pricingSchema>;
export const quotationSchema = z.object({
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
