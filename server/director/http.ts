import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { DirectorRepository } from "./repository.js";
import { HttpError } from "../http/errors.js";
import {equalSecrets} from '../auth/crypto.js';
export function directorHttp(
  repo: DirectorRepository,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.use(requireSession);
  r.get('/ups-alerts',async(req,res)=>{res.json(await repo.upsInstallationAlerts(req.authSession!.user.id));});
  r.get('/ups-data-review',async(req,res)=>{const customer=z.enum(['MBL','UBL']).parse(req.query.customer);res.json(await repo.upsDataReview(req.authSession!.user.id,customer));});
  r.post('/ups-data-review',async(req,res)=>{if(!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession!.csrfToken))throw new HttpError(403,'Refresh and try again.');res.json(await repo.saveUpsDataReview(req.authSession!.user.id,req.body));});
  r.get('/ups',async(req,res)=>{
    const customer=z.enum(['MBL','UBL']).safeParse(req.query.customer);
    if(!customer.success)throw new HttpError(400,'Choose a UPS customer.');
    res.json(await repo.upsPortfolio(req.authSession!.user.id,customer.data));
  });
  r.get("/portfolio", async (req, res) => {
    const v = z.coerce.number().int().min(0).safeParse(req.query.customerId);
    if (req.query.customerId !== undefined && !v.success)
      throw new HttpError(400, "Choose a customer.");
    res.json(
      await repo.portfolio(
        req.authSession!.user.id,
        req.query.customerId === undefined ? undefined : v.data,
      ),
    );
  });
  return r;
}
