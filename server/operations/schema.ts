import { z } from "zod";
export const issuanceSchema = z
  .object({
    ipoId: z.uuid(),
    notes: z.string().trim().max(2000).default(""),
    requestKey: z.uuid(),
  })
  .strict();
export type IssuanceInput = z.infer<typeof issuanceSchema>;
export const deliveryPlanSchema = z
  .object({
    version: z.number().int().min(0),
    requestKey: z.uuid(),
    details: z
      .object({
        deliveryAddress: z.string().trim().min(1).max(1000),
        siteContact: z.string().trim().min(1).max(300),
        sitePhone: z.string().trim().min(1).max(300),
        deliveryDate: z.iso.date(),
        deliveryTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .or(z.literal("")),
        instructions: z.string().trim().max(2000),
      })
      .strict(),
  })
  .strict();
export type DeliveryPlanInput = z.infer<typeof deliveryPlanSchema>;
