import { z } from "zod";
export const issuanceSchema = z
  .object({
    ipoId: z.uuid(),
    notes: z.string().trim().max(2000).default(""),
    requestKey: z.uuid(),
  })
  .strict();
export type IssuanceInput = z.infer<typeof issuanceSchema>;
