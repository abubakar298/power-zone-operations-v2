import{recordInvoiceReceipt,invoiceReceiptSchema}from'./invoice-receipts.js';
import {managementProgrammes} from '../director/management-programmes.js';
import { Router, type RequestHandler } from "express";
import {invoiceRegister,recordInvoiceEntry,invoiceEntrySchema,recordInvoiceSubmission,invoiceSubmissionSchema} from './invoice-entries.js';
import {ptEntrySchema} from './pt-entries.js';
import {paymentRegister,recordPayment,paymentRecordSchema} from './payment-records.js';
import type {AccountsSourceRegisters} from './source-registers.js';
import type {OperationsBoardRepository} from '../operations-board/repository.js';
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { AccountsRepository, closureSchema } from "./repository.js";
export function accountsHttp(
  repo: AccountsRepository,
  requireSession: RequestHandler,
  sources: AccountsSourceRegisters,
  operationsBoard: OperationsBoardRepository,
) {
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (
      req.method !== "GET" &&
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
    const p = schema.safeParse(value);
    if (!p.success)
      throw new HttpError(
        400,
        "Check the Accounts fields and required references.",
      );
    return p.data;
  };
  r.get("/", async (req, res) => {
    const actor=req.authSession!.user.id;
    const [overview,siteImport]=await Promise.all([repo.overview(actor),sources.summary(actor)]);
    res.json({...overview,siteImport});
  });
  r.get('/programmes',async(req,res)=>res.json(await managementProgrammes(repo.pool,req.authSession!.user.id,true)));
  r.get('/work-queues',async(req,res)=>{
    const actor=req.authSession!.user.id;
    const [invoices,payments]=await Promise.all([invoiceRegister(repo.pool,actor),paymentRegister(repo.pool,actor)]);
    res.json({invoicesToSubmit:Object.values(invoices.submissionQueues).reduce((n,rows)=>n+rows.length,0),paymentsToRecord:payments.pending.length+payments.awaiting.length});
  });
  r.get('/closure-queue',async(req,res)=>res.json({closures:await repo.managementClosureQueue(req.authSession!.user.id)}));
  r.get('/billing',async(req,res)=>res.json(await sources.billing(req.authSession!.user.id)));
  r.get('/invoice-entries',async(req,res)=>res.json(await invoiceRegister(repo.pool,req.authSession!.user.id)));
  r.post('/invoice-submissions',async(req,res)=>res.status(201).json(await recordInvoiceSubmission(repo.pool,req.authSession!.user.id,parse(invoiceSubmissionSchema,req.body))));
  r.get('/payment-records',async(req,res)=>res.json(await paymentRegister(repo.pool,req.authSession!.user.id)));
  r.post('/invoice-receipts',async(req,res)=>res.status(201).json(await recordInvoiceReceipt(repo.pool,req.authSession!.user.id,parse(invoiceReceiptSchema,req.body))));
  r.post('/payment-records',async(req,res)=>res.status(201).json(await recordPayment(repo.pool,req.authSession!.user.id,parse(paymentRecordSchema,req.body))));
  r.post('/invoice-entries',async(req,res)=>res.status(201).json(await recordInvoiceEntry(repo.pool,req.authSession!.user.id,parse(invoiceEntrySchema,req.body))));
  r.get('/sites',async(req,res)=>res.json(await sources.sites(req.authSession!.user.id)));
  r.get('/physical-documents',async(req,res)=>{
    await repo.access(req.authSession!.user.id);
    res.json(await operationsBoard.physicalDocuments(req.authSession!.user.id));
  });
  r.post('/pt-entries',async(req,res)=>res.status(201).json(await repo.recordPtEntry(req.authSession!.user.id,parse(ptEntrySchema,req.body))));
  r.post("/evidence", async (req, res) => {
    const v = parse(
      z
        .object({
          jobKey: z.string().max(100),
          filename: z.string().trim().min(1).max(200),
          mediaType: z.enum(["image/png", "image/jpeg", "application/pdf"]),
          base64: z.string().max(11200000),
        })
        .strict(),
      req.body,
    );
    res
      .status(201)
      .json(
        await repo.uploadEvidence(
          req.authSession!.user.id,
          v.jobKey,
          v.filename,
          v.mediaType,
          v.base64,
        ),
      );
  });
  r.get("/evidence/:id", async (req, res) => {
    const f = await repo.evidenceFile(
      req.authSession!.user.id,
      parse(z.uuid(), req.params.id),
    );
    res
      .set({
        "Content-Type": f.media_type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        "X-Content-Type-Options": "nosniff",
      })
      .send(f.content);
  });
  r.get('/jobs/:key/operations-evidence/:version/:fileId',async(req,res)=>{
    const file=await repo.operationsEvidenceFile(req.authSession!.user.id,
      parse(z.string().regex(/^ipo:[0-9a-f-]{36}$/),req.params.key),
      parse(z.coerce.number().int().positive(),req.params.version),parse(z.uuid(),req.params.fileId));
    res.set({'Content-Type':file.media_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).send(file.content);
  });
  r.get("/ipos/:id", async (req, res) =>
    res.json(
      await repo.comparison(
        req.authSession!.user.id,
        parse(z.uuid(), req.params.id),
      ),
    ),
  );
  r.post("/ipo-reviews", async (req, res) =>
    res.json(
      await repo.review(
        req.authSession!.user.id,
        parse(
          z
            .object({
              id: z.uuid(),
              version: z.number().int().nonnegative(),
              decision: z.enum(["Verified", "Returned for Revision"]),
              notes: z.string().trim().min(1).max(2000),
              requestKey: z.uuid(),
            })
            .strict(),
          req.body,
        ),
      ),
    ),
  );
  r.get("/job", async (req, res) =>
    res.json(
      await repo.job(req.authSession!.user.id, String(req.query.key ?? "")),
    ),
  );
  r.post("/return-report", async (req, res) =>
    res.json(
      await repo.returnReport(
        req.authSession!.user.id,
        parse(
          z
            .object({
              id: z.uuid(),
              version: z.number().int().positive(),
              notes: z.string().trim().min(1).max(2000),
              requestKey: z.uuid(),
            })
            .strict(),
          req.body,
        ),
      ),
    ),
  );
  r.post("/closures", async (req, res) =>
    res.json(
      await repo.saveClosure(
        req.authSession!.user.id,
        parse(closureSchema, req.body),
      ),
    ),
  );
  r.post("/closure-decisions", async (req, res) =>
    res.json(
      await repo.decision(
        req.authSession!.user.id,
        parse(
          z
            .object({
              id: z.uuid(),
              version: z.number().int().positive(),
              decision: z.enum(["Closed", "Returned for Revision"]),
              notes: z.string().trim().min(1).max(2000),
              requestKey: z.uuid(),
            })
            .strict(),
          req.body,
        ),
      ),
    ),
  );
  return r;
}
