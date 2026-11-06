import {Router,type RequestHandler} from 'express';
import {z} from 'zod';
import {equalSecrets} from '../auth/crypto.js';
import {HttpError} from '../http/errors.js';
import {ProjectCheckpointsRepository} from './repository.js';
const date=z.union([z.literal(''),z.iso.date()]);
const operations=z.object({solarDelivery:date,startDate:date,equipmentDelivery:date,completionDate:date,estimatedDate:date,installationStatus:z.enum(['Awaiting data','Work in Progress','Installation completed']),remarks:z.string().max(2000),evidence:z.string().max(2000)}).strict();
const accounts=z.object({adjustmentStatus:z.enum(['Awaiting IRR review','Under review','Reviewed — no adjustment','Adjustment authorization required']),remarks:z.string().max(2000),evidence:z.string().max(2000),panelsStatus:z.enum(['Not recorded','Recorded','Submitted']).optional(),installationsStatus:z.enum(['Not recorded','Recorded','Submitted']).optional(),internetStatus:z.enum(['Not recorded','Recorded','Submitted']).optional(),advanceStatus:z.enum(['Pending','Part received','Received']).optional(),balanceStatus:z.enum(['Pending','Part received','Received']).optional(),panelsReference:z.string().max(120).optional(),installationsReference:z.string().max(120).optional(),internetReference:z.string().max(120).optional(),panelsSubmissionDate:date.optional(),installationsSubmissionDate:date.optional(),internetSubmissionDate:date.optional(),advanceReceiptDate:date.optional(),balanceReceiptDate:date.optional()}).strict();
export function projectCheckpointsHttp(repo:ProjectCheckpointsRepository,requireSession:RequestHandler){
 const r=Router();r.use(requireSession);
 r.get('/',async(req,res)=>res.json({jobs:await repo.list(req.authSession!.user.id)}));
 r.post('/:key',async(req,res)=>{
  if(!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');
  const p=z.discriminatedUnion('department',[z.object({department:z.literal('Operations'),version:z.number().int().nonnegative(),requestKey:z.uuid(),snapshot:operations}).strict(),z.object({department:z.literal('Accounts'),version:z.number().int().nonnegative(),requestKey:z.uuid(),snapshot:accounts}).strict()]).safeParse(req.body);
  if(!p.success)throw new HttpError(400,'Check the dates and checkpoint fields.');
  res.status(201).json(await repo.save(req.authSession!.user.id,String(req.params.key),p.data));
 });return r;
}
