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
    workflowStage: z
      .enum([
        "Survey Requests—Awaiting Scheduling",
        "Scheduled Surveys",
        "Survey Reports—Awaiting Technical Review",
        "Technical Review & Handoff Preparation",
      ])
      .optional(),
    workflowRoute: z.enum(["Survey → quotation"]).optional(),
    surveyStatus: z
      .enum(["Awaiting scheduling", "Scheduled", "In progress", "Completed"])
      .optional(),
    scheduledSurveyDate: z.iso.date().optional(),
    region: z.string().trim().max(100).optional(),
    responsiblePerson: z.string().trim().max(200).optional(),
    revisionReason: z.string().trim().max(2000).optional(),
    uploadIds: z.array(z.uuid()).max(10).default([]),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();
export const designSubmissionSchema = designFields
  .extend({
    workflowStage: z
      .enum([
        "Survey Requests—Awaiting Scheduling",
        "Scheduled Surveys",
        "Survey Reports—Awaiting Technical Review",
        "Technical Review & Handoff Preparation",
      ])
      .optional(),
    workflowRoute: z.enum(["Survey → quotation"]).optional(),
    surveyStatus: z
      .enum(["Awaiting scheduling", "Scheduled", "In progress", "Completed"])
      .optional(),
    scheduledSurveyDate: z.iso.date().optional(),
    region: z.string().trim().max(100).optional(),
    responsiblePerson: z.string().trim().max(200).optional(),
    revisionReason: z.string().trim().max(2000).optional(),
    uploadIds: z
      .array(z.uuid())
      .min(1, "Attach the completed physical survey form.")
      .max(10),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();
