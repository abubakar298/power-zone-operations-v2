import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { DirectorRepository } from "./repository.js";
import { HttpError } from "../http/errors.js";
export function directorHttp(
  repo: DirectorRepository,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.use(requireSession);
  r.get('/ups-alerts',async(req,res)=>{res.json(await repo.upsInstallationAlerts(req.authSession!.user.id));});
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
