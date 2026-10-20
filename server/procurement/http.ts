import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import type { ProcurementRepository } from "./repository.js";
import {
  chooseSchema, countSchema, decisionSchema, lineSchema, lineUpdateSchema, noteSchema, orderedSchema, quoteSchema, requestSchema, requestUpdateSchema,
} from "./schema.js";

export function procurementHttp(repo: ProcurementRepository, requireSession: RequestHandler) {
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
  r.post("/requests/:id/decide", async (req, res) => res.json(await repo.decide(actor(req), id(req.params.id), parse(decisionSchema, req.body))));
  r.post("/requests/:id/ordered", async (req, res) => res.json(await repo.markOrdered(actor(req), id(req.params.id), parse(orderedSchema, req.body))));
  r.post("/requests/:id/received", async (req, res) => res.json(await repo.markReceived(actor(req), id(req.params.id), parse(noteSchema, req.body))));
  r.post("/requests/:id/cancel", async (req, res) => res.json(await repo.cancel(actor(req), id(req.params.id), parse(noteSchema, req.body))));
  return r;
}
