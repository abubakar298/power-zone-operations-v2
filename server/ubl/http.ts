import {Router,type RequestHandler} from 'express';
import {z} from 'zod';
import {equalSecrets} from '../auth/crypto.js';
import {HttpError} from '../http/errors.js';
import {UblRepository} from './repository.js';
export function ublHttp(repo:UblRepository,requireSession:RequestHandler){
 const r=Router();r.use(requireSession);
 const config=(value:unknown)=>{const parsed=z.enum(['20-20-30','25-20-30','30-30-40','35-30-40']).safeParse(value);if(!parsed.success)throw new HttpError(404,'UBL configuration not found.');return parsed.data;};
 r.get('/',async(req,res)=>res.json({configurations:await repo.list(req.authSession!.user.id)}));
 r.get('/closed-jobs',async(req,res)=>res.json(await repo.closedJobs(req.authSession!.user.id)));
 r.get('/sites',async(req,res)=>res.json({sites:await repo.sites(req.authSession!.user.id)}));
 r.get('/:id/source.pdf',async(req,res)=>{const source=await repo.source(req.authSession!.user.id,config(req.params.id));res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${source.filename}"`,'Cache-Control':'private, no-store'}).send(source.content);});
 r.get('/:id',async(req,res)=>res.json(await repo.detail(req.authSession!.user.id,config(req.params.id))));
 r.post('/:id/budgets',async(req,res)=>{
  if(!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');
  const parsed=z.object({expectedVersion:z.number().int().nonnegative(),requestKey:z.uuid(),notes:z.string().trim().min(1).max(1700)}).strict().safeParse(req.body);
  if(!parsed.success)throw new HttpError(400,'Enter refresh notes and a valid budget version.');
  const v=parsed.data;res.status(201).json(await repo.refresh(req.authSession!.user.id,config(req.params.id),v.expectedVersion,v.requestKey,v.notes));
 });return r;
}
