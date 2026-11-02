import {z} from 'zod';
const label=z.string().trim().min(1).max(120);
export const catalogueItemInput=z.object({
 itemId:z.string().trim().min(1).max(200).regex(/^[^\r\n\t]+$/,'Enter one item ID.'),
 commercialDescription:z.string().trim().min(1).max(1500),
 technicalDescription:z.string().trim().max(2000).default(''),
 itemGroup:label,unit:z.string().trim().min(1).max(40),
 brandCategory:z.string().trim().max(120).default(''),
 itemType:z.enum(['Stock item','Service']).default('Stock item'),
}).strict();
