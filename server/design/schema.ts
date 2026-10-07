import { z } from "zod";
import { surveySchema } from "../boq/schema.js";
export const designFields = surveySchema
  .omit({
    brands: true,
    sourceMode: true,
    preparedBy: true,
    specifications: true,
    additionalItem: true,
    ocrText: true,
    ocrReviewed: true,
  })
  .strict();
export const designDraftSchema = designFields
  .partial()
  .extend({
    siteName: z.string().trim().max(200).default(""),
    siteCode: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9_-]*$/)
      .default(""),
    uploadIds: z.array(z.uuid()).max(10).default([]),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();
export const designSubmissionSchema = designFields
  .extend({
    uploadIds: z
      .array(z.uuid())
      .min(1, "Attach the completed physical survey form.")
      .max(10),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();
