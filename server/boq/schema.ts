import { z } from "zod";
const quantity = z
  .string()
  .regex(
    /^\d{1,8}(\.\d{1,4})?$/,
    "Enter a non-negative quantity with up to four decimals.",
  );
export const surveySchema = z
  .object({
    sourceMode: z.enum(["Survey", "General quotation"]).optional(),
    customerId: z.number().int().min(0),
    siteName: z.string().trim().min(1).max(200),
    siteCode: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/),
    location: z.string().trim().max(1000),
    panelQty: z.number().int().min(1).max(1000000),
    panelWattage: quantity.refine((v) => Number(v) > 0),
    structure: z.enum(["L1", "L2", "L3", "Elevated"]),
    dcMetres: quantity,
    acInverter16: quantity.optional(),
    spInverterTerminationMetres: quantity.optional(),
    acInverter25: quantity.optional(),
    acTerminationMode: z.enum(["Fixed", "Measured"]).optional(),
    acPanel16: quantity.optional(),
    acPanel25: quantity.optional(),
    spLoadPanelRunMetres: quantity.optional(),

    earth25: quantity,
    earth6: quantity,
    earth10: quantity,
    bessId: z
      .string()
      .regex(/^(BESS-\d+-\d+|6-(5|10|15|20|25|30|35|40|45|50|55|60))$/)
      .optional(),
    inverter: z.string().min(1).max(30),
    batteryKwh: z.number().int().min(0).max(120),
    smartMeter: z.boolean(),
    genset: z.boolean(),
    brands: z
      .object({
        solar: z.number().int().positive(),
        inverter: z.number().int().positive(),
        battery: z.number().int().positive(),
        cable: z.number().int().positive(),
        switchgear: z.number().int().positive(),
      })
      .strict(),
    preparedBy: z.string().trim().min(1).max(100),
    specifications: z
      .record(z.string().min(1).max(200), z.string().trim().min(1).max(1500))
      .optional(),
    additionalItem: z
      .object({
        description: z.string().trim().min(1).max(1500),
        specification: z.string().trim().max(1500).default(""),
        qty: quantity.refine((v) => Number(v) > 0),
        unit: z.string().trim().min(1).max(20),
        unitCost: quantity,
        taxRate: z.enum(["0", "10", "18"]),
      })
      .strict()
      .optional(),
    uploadIds: z.array(z.uuid()).max(10).default([]),
    ocrText: z.string().max(100000).default(""),
    ocrReviewed: z.boolean().default(false),
  })
  .strict();
export const surveyDraftSchema = surveySchema
  .partial()
  .extend({
    siteName: z.string().trim().max(200).default(""),
    siteCode: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9_-]*$/)
      .default(""),
    panelQty: z.number().int().min(0).max(1000000).optional(),
    panelWattage: z.union([quantity, z.literal("")]).optional(),
    preparedBy: z.string().trim().max(100).default(""),
    brands: surveySchema.shape.brands.partial().default({}),
    uploadIds: surveySchema.shape.uploadIds,
    ocrText: surveySchema.shape.ocrText,
    ocrReviewed: surveySchema.shape.ocrReviewed,
  })
  .strict();
export type SurveyDraft = z.infer<typeof surveyDraftSchema>;
export type Survey = z.infer<typeof surveySchema>;
export function recommendSiteCode(name: string) {
  return (
    name.match(/\b\d{4,6}\b/)?.[0] ??
    name
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 6)
      .toUpperCase()
  );
}
