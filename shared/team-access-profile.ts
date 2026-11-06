import {z} from 'zod';
const region=z.enum(['central','south']);
export const teamAccessProfileSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('QC'),region}).strict(),
 z.object({kind:z.literal('Operations Lead'),region}).strict(),
 z.object({kind:z.literal('Storekeeper'),warehouses:z.array(z.string().trim().min(1).max(200).refine(v=>!['all','*'].includes(v.toLowerCase()),'Select explicit warehouses.')).min(1).max(50).refine(v=>new Set(v).size===v.length,'Do not repeat warehouses.')}).strict(),
]);
export type TeamAccessProfile=z.infer<typeof teamAccessProfileSchema>;
export function teamProfileRole(profile:TeamAccessProfile):'Operations'|'Inventory'{return profile.kind==='Storekeeper'?'Inventory':'Operations';}
