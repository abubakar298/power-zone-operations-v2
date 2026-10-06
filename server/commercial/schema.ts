import { z } from "zod";
const percent = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,4})?$/, "Enter a nonnegative markup percentage.");
const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with up to two decimals.");
export const pricingSchema = z.object({
  boqRevisionId: z.uuid(),
  presentation: z.enum(["No Breakup", "Basic Breakup", "Full Breakup"]),
  taxMode: z.enum(["Tax Included", "Show Sales Tax Separately"]),
  markups: z.object({
    solar: percent,
    structure: percent,
    bess: percent,
    earthing: percent,
    balance: percent,
    rest: percent,
  }),
  // Accepted for compatibility with older drafts; pricing never applies it.
  discount: amount.optional(),
  preparedBy: z.string().trim().min(1).max(100),
  remarks: z.string().trim().max(2000).default(""),
});
export type PricingInput = z.infer<typeof pricingSchema>;
export const quotationSchema = z.object({
  pricingId: z.uuid(),
  discount: amount.optional(),
  quotedDate: z.iso.date(),
  additionalItem: z.object({
    description: z.string().trim().min(1).max(1500),
    cost: amount,
    markup: percent,
    taxRate: z.enum(["0", "10", "18"]),
  }).optional(),
  validity: z.string().trim().min(1).max(100),
  proposedBy: z.string().trim().min(1).max(100),
  descriptions: z.array(z.string().trim().min(1).max(1500)).max(40).optional(),
});
export type QuotationInput = z.infer<typeof quotationSchema>;
