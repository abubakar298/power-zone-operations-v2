import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import type { ProcurementRepository } from "./repository.js";
import type { MiscItemsRepository } from "./misc.js";
import type { StockWatchRepository } from "./stock-watch.js";
import type { ProcurementAccessRepository } from "./access.js";
import { requireRecentPassword } from "../security/events.js";
import { buildComparisonPdf, buildComparisonXlsx, buildRfqPdf, buildRfqXlsx, buildRfqZip, safeFileName, type RfqRepository } from "./rfq.js";
import {
  chooseSchema, countSchema, decisionSchema, lineSchema, lineUpdateSchema, miscItemSchema, miscItemUpdateSchema, miscKeySchema, miscSaveSchema,
  noteSchema, orderedSchema, quoteSchema, receiveSchema, requestSchema, requestUpdateSchema, watchOrderSchema, watchSettingSchema, rfqSchema, importQuotesSchema, accessChangeSchema,
} from "./schema.js";

export function procurementHttp(repo: ProcurementRepository, requireSession: RequestHandler, misc: MiscItemsRepository, watch: StockWatchRepository, rfqs: RfqRepository, access: ProcurementAccessRepository) {
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (req.method !== "GET" && !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken))
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  const id = (v: unknown, what = "request") => {
    const p = z.uuid().safeParse(v);
    if (!p.success) throw new HttpError(400, `Invalid ${what} ID.`);
    return p.data;
  };
  const parse = <T,>(schema: z.ZodType<T>, body: unknown): T => {
    const p = schema.safeParse(body ?? {});
    if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? "Invalid input.");
    return p.data;
  };
  const actor = (req: { authSession?: { user: { id: string } } }) => req.authSession!.user.id;

  r.get("/me", async (req, res) => res.json(await repo.me(actor(req))));
  r.get("/overview", async (req, res) => res.json(await repo.overview(actor(req))));
  r.get("/store", async (req, res) => res.json(await repo.storeView(actor(req))));
  r.get("/items", async (req, res) => res.json({ items: await repo.searchItems(actor(req), String(req.query.q ?? "")) }));
  r.post("/stock/counts", async (req, res) => { await repo.setCount(actor(req), parse(countSchema, req.body)); res.json({ ok: true }); });

  r.get("/requests", async (req, res) => res.json({ requests: await repo.listRequests(actor(req)) }));
  r.post("/requests", async (req, res) => res.json(await repo.createRequest(actor(req), parse(requestSchema, req.body))));
  r.post("/requests/from-to-buy", async (req, res) => res.json(await repo.createFromToBuy(actor(req))));
  r.get("/requests/:id", async (req, res) => res.json(await repo.getRequest(actor(req), id(req.params.id))));
  r.post("/requests/:id/update", async (req, res) => res.json(await repo.updateRequest(actor(req), id(req.params.id), parse(requestUpdateSchema, req.body))));
  r.post("/requests/:id/lines", async (req, res) => res.json(await repo.addLine(actor(req), id(req.params.id), parse(lineSchema, req.body))));
  r.post("/requests/:id/lines/:lineId/update", async (req, res) =>
    res.json(await repo.updateLine(actor(req), id(req.params.id), id(req.params.lineId, "line"), parse(lineUpdateSchema, req.body))));
  r.post("/requests/:id/lines/:lineId/remove", async (req, res) => res.json(await repo.removeLine(actor(req), id(req.params.id), id(req.params.lineId, "line"))));
  r.post("/requests/:id/lines/:lineId/quotes", async (req, res) =>
    res.json(await repo.addQuote(actor(req), id(req.params.id), id(req.params.lineId, "line"), parse(quoteSchema, req.body))));
  r.post("/requests/:id/lines/:lineId/choose", async (req, res) =>
    res.json(await repo.chooseQuote(actor(req), id(req.params.id), id(req.params.lineId, "line"), parse(chooseSchema, req.body).quoteId)));
  r.post("/requests/:id/quotes/:quoteId/remove", async (req, res) => res.json(await repo.removeQuote(actor(req), id(req.params.id), id(req.params.quoteId, "quotation"))));
  r.post("/requests/:id/submit", async (req, res) => res.json(await repo.submit(actor(req), id(req.params.id))));
  r.post("/requests/:id/decide", async (req, res) => {
    const input = parse(decisionSchema, req.body);
    if (input.decision === "approve") requireRecentPassword(req);
    res.json(await repo.decide(actor(req), id(req.params.id), input));
  });
  r.post("/requests/:id/ordered", async (req, res) => res.json(await repo.markOrdered(actor(req), id(req.params.id), parse(orderedSchema, req.body))));
  r.post("/requests/:id/received", async (req, res) => res.json(await repo.markReceived(actor(req), id(req.params.id), parse(receiveSchema, req.body))));
  r.post("/requests/:id/cancel", async (req, res) => res.json(await repo.cancel(actor(req), id(req.params.id), parse(noteSchema, req.body))));

  // Misc items BOQ: Design fills it per site, Hamza buys the items, Store sends them.
  const miscKey = (v: unknown) => parse(miscKeySchema, v);
  r.get("/misc/catalogue", async (req, res) => res.json(await misc.catalogue(actor(req))));
  r.get("/misc/sites", async (req, res) => res.json(await misc.sites(actor(req))));
  r.get("/misc/sites/:recordId", async (req, res) => res.json(await misc.site(actor(req), id(req.params.recordId, "site"))));
  r.post("/misc/sites/:recordId/save", async (req, res) => res.json(await misc.save(actor(req), id(req.params.recordId, "site"), parse(miscSaveSchema, req.body))));
  r.post("/misc/sites/:recordId/sent", async (req, res) => res.json(await misc.markSent(actor(req), id(req.params.recordId, "site"), parse(noteSchema, req.body))));
  r.post("/misc/items", async (req, res) => res.json(await misc.addItem(actor(req), parse(miscItemSchema, req.body))));
  r.post("/misc/items/:key/update", async (req, res) => res.json(await misc.updateItem(actor(req), miscKey(req.params.key), parse(miscItemUpdateSchema, req.body))));

  // Inverter, battery and BMS watch for Abu Bakar.
  r.get("/stock-watch", async (req, res) => res.json(await watch.view(actor(req))));
  r.post("/stock-watch/settings/:itemKey", async (req, res) =>
    res.json(await watch.saveSetting(actor(req), String(req.params.itemKey).slice(0, 200), parse(watchSettingSchema, req.body))));
  r.post("/stock-watch/orders", async (req, res) => {
    const input = parse(watchOrderSchema, req.body);
    requireRecentPassword(req);
    res.json(await watch.createOrder(actor(req), input));
  });

  // Procurement access, managed by Admin.
  r.get("/access", async (req, res) => res.json(await access.list(actor(req))));
  r.post("/access/change", async (req, res) => res.json(await access.change(actor(req), parse(accessChangeSchema, req.body), req)));

  // Requests for quotation, quotations entered in bulk, and the comparative statement.
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  // File names follow the app's download naming (server/documents/download-http.ts) through its downloadContext hook.
  const send = (res: any, body: Buffer, type: string, name: string, context: { documentType: string; identity: string; customer: string; site: string; reference: string }) => {
    res.locals.downloadContext = context;
    res.type(type).set("Content-Disposition", `attachment; filename="${safeFileName(name.replace(/\.[a-z]+$/, ""))}${name.match(/\.[a-z]+$/)?.[0] ?? ""}"`).send(body);
  };
  const rfqName = (f: { id: string; number: string }, vendor: string, part: string) =>
    ({ documentType: "Request for Quotation", identity: `rfq:${f.id}:${part}`, customer: vendor, site: "Procurement", reference: f.number });
  const cmpName = (d: { id: string; number: string }) => ({ documentType: "Comparative Statement", identity: `comparison:${d.id}`, customer: "Procurement", site: d.number, reference: d.number });
  const vendorOf = async (req: any) => {
    const f = await rfqs.rfq(actor(req), id(req.params.rfqId, "quotation request"));
    const v = f.vendors.find((x) => x.id === id(req.params.vendorId, "vendor"));
    if (!v) throw new HttpError(404, "Vendor not found on this request for quotation.");
    return { f, v };
  };
  r.get("/requests/:id/rfqs", async (req, res) => res.json(await rfqs.list(actor(req), id(req.params.id))));
  r.post("/requests/:id/rfqs", async (req, res) => res.json(await rfqs.create(actor(req), id(req.params.id), parse(rfqSchema, req.body))));
  r.get("/rfqs/:rfqId/vendors/:vendorId/pdf", async (req, res) => { const { f, v } = await vendorOf(req); send(res, buildRfqPdf(f, v), "application/pdf", `${f.number} ${v.vendor}.pdf`, rfqName(f, v.vendor, v.id)); });
  r.get("/rfqs/:rfqId/vendors/:vendorId/xlsx", async (req, res) => { const { f, v } = await vendorOf(req); send(res, buildRfqXlsx(f, v), XLSX, `${f.number} ${v.vendor}.xlsx`, rfqName(f, v.vendor, v.id)); });
  r.get("/rfqs/:rfqId/all.zip", async (req, res) => { const f = await rfqs.rfq(actor(req), id(req.params.rfqId, "quotation request")); send(res, buildRfqZip(f), "application/zip", `${f.number} all vendors.zip`, rfqName(f, "All vendors", "all")); });
  r.post("/requests/:id/quotes/import", async (req, res) => res.json(await repo.importQuotes(actor(req), id(req.params.id), parse(importQuotesSchema, req.body))));
  r.get("/requests/:id/comparison.pdf", async (req, res) => { const d = await repo.getRequest(actor(req), id(req.params.id)); send(res, buildComparisonPdf(d), "application/pdf", `${d.number} comparative statement.pdf`, cmpName(d)); });
  r.get("/requests/:id/comparison.xlsx", async (req, res) => { const d = await repo.getRequest(actor(req), id(req.params.id)); send(res, buildComparisonXlsx(d), XLSX, `${d.number} comparative statement.xlsx`, cmpName(d)); });
  return r;
}
