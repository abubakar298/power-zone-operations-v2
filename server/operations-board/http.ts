import {Router,json,type RequestHandler} from 'express';
import {z} from 'zod';
import {equalSecrets} from '../auth/crypto.js';
import {HttpError} from '../http/errors.js';
import {fileSchema,movementSchema,commandSchema,vendorSchema,targetsSchema,batchSchema} from './schema.js';
import {OperationsBoardRepository} from './repository.js';
export function operationsBoardHttp(repo:OperationsBoardRepository,requireSession:RequestHandler){
 const r=Router();r.use(requireSession);
 r.use((req,_res,next)=>{if(req.method!=='GET'&&!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');next();});
 const parse=<T>(schema:z.ZodType<T>,input:unknown)=>{const r=schema.safeParse(input);if(!r.success)throw new HttpError(400,'Check the Operations fields and references.');return r.data;};
 const siteId=(value:unknown)=>parse(z.string().min(1).max(160),value);
 r.get('/batches',async(req,res)=>res.json(await repo.batches(req.authSession!.user.id)));
 r.post('/batches',json({limit:'512kb'}),async(req,res)=>res.status(201).json(await repo.saveBatch(req.authSession!.user.id,parse(batchSchema,req.body))));
 r.get('/alerts',async(req,res)=>res.json(await repo.alerts(req.authSession!.user.id)));
 r.get('/resources',async(req,res)=>res.json(await repo.resources(req.authSession!.user.id,parse(z.enum(['member','vehicle']),req.query.kind))));
 r.post('/resources',json({limit:'128kb'}),async(req,res)=>res.status(201).json(await repo.saveVendor(req.authSession!.user.id,parse(vendorSchema,req.body))));
 r.get('/vendors',async(req,res)=>res.json(await repo.vendors(req.authSession!.user.id)));
 r.post('/vendors',json({limit:'128kb'}),async(req,res)=>res.status(201).json(await repo.saveVendor(req.authSession!.user.id,parse(vendorSchema,req.body))));
 r.get('/targets',async(req,res)=>res.json(await repo.targets(req.authSession!.user.id)));
 r.post('/targets',json({limit:'128kb'}),async(req,res)=>res.status(201).json(await repo.saveTargets(req.authSession!.user.id,parse(targetsSchema,req.body))));
 r.get('/sites',async(req,res)=>res.json(await repo.sites(req.authSession!.user.id)));
 r.get('/sites/:id/history',async(req,res)=>res.json(await repo.history(req.authSession!.user.id,siteId(req.params.id),req.query.before===undefined?undefined:parse(z.coerce.number().int().positive(),req.query.before))));
 r.get('/sites/:id',async(req,res)=>res.json(await repo.site(req.authSession!.user.id,siteId(req.params.id))));
 r.post('/sites/:id/files',async(req,_res,next)=>{await repo.site(req.authSession!.user.id,siteId(req.params.id));next();},json({limit:'36mb'}),async(req,res)=>res.status(201).json(await repo.upload(req.authSession!.user.id,siteId(req.params.id),parse(fileSchema,req.body))));
 r.get('/sites/:id/files/:fileId',async(req,res)=>{
  const file=await repo.download(req.authSession!.user.id,siteId(req.params.id),parse(z.uuid(),req.params.fileId));
  res.set({'Content-Type':file.media_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).send(file.content);
 });
 r.post('/sites/:id/decisions',json({limit:'128kb'}),async(req,res)=>res.status(201).json(await repo.command(req.authSession!.user.id,siteId(req.params.id),parse(commandSchema,req.body))));
 r.post('/sites/:id/document-movements',json({limit:'128kb'}),async(req,res)=>res.status(201).json(await repo.moveDocument(req.authSession!.user.id,siteId(req.params.id),parse(movementSchema,req.body))));
 return r;
}
