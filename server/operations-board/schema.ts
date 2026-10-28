import {targetStageIds} from '../../shared/operations-stages.js';
export {targetStageIds} from '../../shared/operations-stages.js';
import {z} from 'zod';
export const teamSchema=z.enum(['central','south']);
export const documentLocationSchema=z.enum(['Location not recorded','At site','With delivery driver','Received at Lahore head office','TCS to Karachi office','TCS to Lahore head office','Received at Karachi office','Submitted to Accounts']);
const evidence=z.object({id:z.string().min(1).max(200),name:z.string().max(200).optional()}).passthrough();
const document=z.object({
 id:z.string().min(1).max(200),label:z.string().min(1).max(300),location:documentLocationSchema,
 date:z.iso.date(),createdDate:z.iso.date().optional(),evidence:z.array(evidence).max(100).default([]),
 history:z.array(z.record(z.string(),z.unknown())).max(10000).default([]),
}).passthrough();
export const sourceSiteSchema=z.object({
 id:z.string().min(1).max(160),ipo:z.string().max(100),name:z.string().min(1).max(300),
 stage:z.enum(['received','awaiting','delivered','completed']),installation:z.boolean().nullable(),completed:z.boolean().optional(),scopePending:z.boolean().optional(),
 projectType:z.enum(['solar-bess','solar','bess','ups','delivery-only']).nullish(),
 operationsTeam:teamSchema.nullish(),
 documents:z.array(document).max(1000).optional(),
}).passthrough().superRefine((site,ctx)=>{if(site.installation===null&&site.scopePending!==true)ctx.addIssue({code:'custom',message:'Unknown installation scope must remain explicitly flagged.',path:['scopePending']});});
export const importSchema=z.object({sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),rows:z.array(sourceSiteSchema).min(1).max(20000)}).strict();
export const movementSchema=z.object({
 version:z.number().int().positive(),requestKey:z.uuid(),documentId:z.string().min(1).max(200),
 location:documentLocationSchema,date:z.iso.date(),tracking:z.string().trim().max(120).default(''),carrier:z.string().trim().max(200).default(''),
 edit:z.boolean().default(false),reason:z.string().trim().max(2000).default(''),
}).strict();
export const fileSchema=z.object({filename:z.string().trim().min(1).max(200),mediaType:z.enum(['application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif']),base64:z.string().min(4).max(34952536)}).strict();
export type BoardSite=z.infer<typeof sourceSiteSchema>;
const commandBase=z.object({version:z.number().int().positive(),requestKey:z.uuid(),edit:z.boolean().default(false),reason:z.string().trim().max(2000).default('')});
const vendorId=z.union([z.uuid(),z.literal('pz-team')]);
export const vendorAssignmentsSchema=z.object({structure:vendorId.optional(),electrical:vendorId.optional(),earthing:vendorId.optional(),delivery:vendorId.optional()}).strict();
const completionFields={date:z.iso.date(),evidenceIds:z.array(z.uuid()).max(30).default([]),acknowledgementId:z.uuid().optional(),irrId:z.uuid().optional(),variableSignoffId:z.uuid().optional()};
export const commandSchema=z.discriminatedUnion('action',[
 commandBase.extend({action:z.literal('assign-team'),team:teamSchema}).strict(),
 commandBase.extend({action:z.literal('plan'),dispatchDate:z.iso.date(),assignments:vendorAssignmentsSchema}).strict(),
 commandBase.extend({action:z.literal('delivery'),deliveryDate:z.iso.date(),signedDoId:z.uuid(),materialPhotoId:z.uuid(),partial:z.boolean().default(false)}).strict(),
 commandBase.extend({action:z.literal('qc'),stageId:z.enum(['civil','electrical','testing','signoff','cabinet','panel','bessTesting','handover']),...completionFields}).strict(),
 commandBase.extend({action:z.literal('ups-job'),...completionFields,checks:z.object({mounting:z.boolean(),electrical:z.boolean(),testingTraining:z.boolean(),signoff:z.boolean()}).strict()}).strict(),
 commandBase.extend({action:z.literal('historical-evidence'),category:z.enum(['delivery','handover']),date:z.iso.date(),signedDoId:z.uuid().optional(),materialPhotoId:z.uuid().optional(),acknowledgementId:z.uuid().optional(),irrId:z.uuid().optional(),variableSignoffId:z.uuid().optional()}).strict(),
 commandBase.extend({action:z.literal('blocker'),text:z.string().trim().min(1).max(2000)}).strict(),
 commandBase.extend({action:z.literal('resolve-blocker'),blockerId:z.string().min(1).max(200),resolution:z.string().trim().min(1).max(2000)}).strict(),
]);
export type BoardCommand=z.infer<typeof commandSchema>;
export const vendorSchema=z.object({id:z.uuid().optional(),version:z.number().int().nonnegative(),requestKey:z.uuid(),name:z.string().trim().min(1).max(200),phone:z.string().trim().max(100).default(''),roles:z.array(z.enum(['structure','electrical','earthing','delivery'])).min(1).max(4),active:z.boolean().default(true),reason:z.string().trim().max(2000).default('')}).strict();
const target=z.object({amount:z.number().finite().positive().max(Number.MAX_SAFE_INTEGER/86400000),unit:z.enum(['hours','days'])}).strict().nullable();
export const targetsSchema=z.object({version:z.number().int().nonnegative(),requestKey:z.uuid(),reason:z.string().trim().max(2000).default(''),values:z.record(z.enum(targetStageIds),target)}).strict();
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const batchSchema=z.object({
 id:z.uuid().optional(),version:z.number().int().nonnegative(),requestKey:z.uuid(),edit:z.boolean().default(false),team:teamSchema,kind:z.enum(['delivery','labour','both']),
 vehicle:z.string().trim().max(100).default(''),driver:z.string().trim().max(200).default(''),labourTeam:vendorId.optional(),inventoryReference:z.string().trim().max(200).default(''),reason:z.string().trim().max(2000).default(''),
 stops:z.array(z.object({siteId:z.string().min(1).max(160),siteVersion:z.number().int().positive(),kind:z.enum(['delivery','labour','both']).optional(),order:z.number().int().positive(),plannedDate:z.iso.date(),start:z.union([time,z.literal('')]).default(''),end:z.union([time,z.literal('')]).default('')}).strict()).min(2).max(1000),
}).strict();
export type BatchInput=z.infer<typeof batchSchema>;
