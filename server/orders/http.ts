import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { orderSchema } from "./schema.js";
import { OrdersRepository } from "./repository.js";
import { buildIpoPdf } from "./report.js";
import { buildPeachtreePdf } from "./peachtree-report.js";
export function ordersHttp(
  repo: OrdersRepository,
  requireSession: RequestHandler,
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
    const v = schema.safeParse(value);
    if (!v.success) throw new HttpError(400, v.error.issues[0].message);
    return v.data;
  };
  r.get("/", async (_req, res) => res.json({ orders: await repo.list() }));
  r.get("/submissions", async (req, res) =>
    res.json({ submissions: await repo.submissions(req.authSession!.user.id) }),
  );
  r.get("/submissions/:id/preview.pdf", async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const s = (await repo.submissions(req.authSession!.user.id)).find(
      (s) => s.id === id,
    );
    if (!s) throw new HttpError(404, "IPO submission not found.");
    res.type("application/pdf").send(buildIpoPdf(s.snapshot));
  });
  r.post("/submissions", async (req, res) => {
    const v = parse(
      z
        .object({
          input: orderSchema,
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          requestKey: z.uuid(),
        })
        .strict(),
      req.body,
    );
    res
      .status(201)
      .json(
        await repo.submit(
          req.authSession!.user.id,
          v.input,
          v.fingerprint,
          v.requestKey,
        ),
      );
  });
  r.post("/submissions/:id/approve", async (req, res) => {
    const v = parse(z.object({ requestKey: z.uuid() }).strict(), req.body);
    res
      .status(201)
      .json(
        await repo.approve(
          req.authSession!.user.id,
          parse(z.uuid(), req.params.id),
          v.requestKey,
        ),
      );
  });
  r.post("/preview", async (req, res) =>
    res.json(
      await repo.preview(
        req.authSession!.user.id,
        parse(orderSchema, req.body),
      ),
    ),
  );
  r.post("/", async (req, res) => {
    const v = parse(
      z
        .object({
          input: orderSchema,
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          requestKey: z.uuid(),
        })
        .strict(),
      req.body,
    );
    res
      .status(201)
      .json(
        await repo.save(
          req.authSession!.user.id,
          v.input,
          v.fingerprint,
          v.requestKey,
        ),
      );
  });
  r.post("/preview.pdf", async (req, res) => {
    const p = await repo.preview(
      req.authSession!.user.id,
      parse(orderSchema, req.body),
    );
    res
      .type("application/pdf")
      .set("Content-Disposition", 'attachment; filename="DRAFT-IPO.pdf"')
      .send(buildIpoPdf(p.snapshot));
  });
  r.post("/documents", async (req, res) => {
    const v = parse(
      z
        .object({
          filename: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .regex(/^[^/\\\r\n]+$/),
          mime: z.enum(["application/pdf", "image/png", "image/jpeg"]),
          base64: z
            .string()
            .min(4)
            .max(11184812)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .strict(),
      req.body,
    );
    const bytes = Buffer.from(v.base64, "base64");
    if (bytes.length > 8388608 || bytes.toString("base64") !== v.base64)
      throw new HttpError(400, "Upload a valid PO file up to 8 MB.");
    const valid =
      v.mime === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : v.mime === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid)
      throw new HttpError(
        400,
        "File content does not match its selected type.",
      );
    res
      .status(201)
      .json(
        await repo.upload(req.authSession!.user.id, v.filename, v.mime, bytes),
      );
  });
  r.get("/documents/:id", async (req, res) => {
    const d = await repo.document(
      req.authSession!.user.id,
      parse(z.uuid(), req.params.id),
    );
    res.type(d.mime).set("Content-Disposition", "attachment").send(d.content);
  });
  r.get("/:id/peachtree.pdf", async (req, res) => {
    const { row, division } = await repo.peachtree(
      parse(z.uuid(), req.params.id),
    );
    res
      .type("application/pdf")
      .set(
        "Content-Disposition",
        `attachment; filename="${row.number}-Peachtree-Division.pdf"`,
      )
      .send(buildPeachtreePdf(row.snapshot, division, row.number));
  });
  r.get("/:id/ipo.pdf", async (req, res) => {
    const q = await repo.get(parse(z.uuid(), req.params.id));
    res
      .type("application/pdf")
      .set("Content-Disposition", `attachment; filename="${q.number}.pdf"`)
      .send(buildIpoPdf(q.snapshot, q.number));
  });
  r.get("/:id", async (req, res) =>
    res.json(await repo.get(parse(z.uuid(), req.params.id))),
  );
  return r;
}
