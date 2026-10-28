import {Router,type RequestHandler} from 'express';
import {z} from 'zod';
import {equalSecrets} from '../auth/crypto.js';
import {HttpError} from '../http/errors.js';
import {InventoryReviewRepository,reviewCommandSchema} from './review-register.js';

export function inventoryReviewHttp(repo:InventoryReviewRepository,requireSession:RequestHandler){
 const r=Router();r.use(requireSession);
 r.use((req,_res,next)=>{if(req.method!=='GET'&&!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');next();});
 const id=(value:unknown)=>{const parsed=z.string().regex(/^[a-f0-9]{64}$/).safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid reconciliation item.');return parsed.data;};
 r.get('/',async(req,res)=>res.json(await repo.list(req.authSession!.user.id)));
 r.get('/:id',async(req,res)=>res.json(await repo.detail(req.authSession!.user.id,id(req.params.id))));
 r.post('/:id/decisions',async(req,res)=>{
  const v=reviewCommandSchema.safeParse(req.body);if(!v.success)throw new HttpError(422,'Enter a reason and the required proposal evidence.');
  res.json(await repo.command(req.authSession!.user.id,id(req.params.id),v.data));
 });
 return r;
}
