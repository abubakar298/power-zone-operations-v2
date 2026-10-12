import { z } from "zod";
import { pricingSchema } from "../commercial/schema.js";
export const instructionsSchema = pricingSchema
  .pick({ presentation: true, taxMode: true, saleType:true,cashGstTreatment:true,markups: true })
  .extend({ notes: z.string().trim().max(2000).default("") })
  .strict();
export type ApprovalInstructions = z.infer<typeof instructionsSchema>;
export const externalApprovalSchema = z
  .object({
    instructions: instructionsSchema,
    approver: z.string().trim().min(1).max(100),
    comments: z.string().trim().max(2000).default(""),
    evidenceIds: z
      .array(z.uuid())
      .min(1)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length),
    confirmed: z.literal(true),
  })
  .strict();
