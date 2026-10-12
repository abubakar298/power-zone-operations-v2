import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import {
  drawReportLogo,
  drawReportFooter,
  reportBottomMargin,
} from "../reports/branding.js";
import { ublIpoSamplePdf } from "./ipo-sample-report.js";
import { UblWorkflowRepository } from "./workflow-repository.js";
const schema = z
  .object({
    version: z.number().int().positive(),
    action: z.enum([
      "save",
      "identity",
      "verify",
      "submit",
      "headsup",
      "advance",
      "po",
      "ipo",
      "accept",
      "return",
      "confirmed",
      "acknowledge",
      "revision-pending",
      "defer",
      "decline",
    ]),
    input: z
      .object({
        scheduledSurveyDate: z.iso.date().nullable().optional(),
        actualSurveyDate: z.iso.date().nullable().optional(),
        branchCode: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[a-zA-Z0-9-]+$/)
          .optional(),
        configuration: z
          .enum(["20-20-30", "25-20-30", "30-30-40", "35-30-40"])
          .nullable()
          .optional(),
        pricingStage: z
          .enum(["Proposed", "Negotiated", "Revised"])
          .nullable()
          .optional(),
        surveyStatus: z
          .enum([
            "Awaiting scheduling",
            "Scheduled",
            "In progress",
            "Completed",
          ])
          .optional(),
        notes: z.string().trim().max(4000).optional(),
        planningOwnerId: z.uuid().nullable().optional(),
        technicalOwnerId: z.uuid().nullable().optional(),
        operationsOwnerId: z.uuid().nullable().optional(),
        recipientId: z.uuid().optional(),
        verified: z.boolean().optional(),
        poNumber: z.string().trim().min(1).max(100).optional(),
        ipoNumber: z.string().trim().max(20).optional(),
        date: z.iso.date().optional(),
      })
      .strict(),
  })
  .strict();
export function ublWorkflowHttp(
  repo: UblWorkflowRepository,
  session: RequestHandler,
) {
  const r = Router();
  r.use(session);
  r.use((req, _res, next) => {
    if (
      req.method !== "GET" &&
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  const parse = <T>(s: z.ZodType<T>, value: unknown) => {
    const p = s.safeParse(value);
    if (!p.success) throw new HttpError(400, p.error.issues[0].message);
    return p.data;
  };
  r.get("/", async (req, res) =>
    res.json(await repo.list(req.authSession!.user.id)),
  );
  r.get("/sources", async (req, res) =>
    res.json({ sources: await repo.sources(req.authSession!.user.id) }),
  );
  r.get("/sources/:sha/file", async (req, res) => {
    const s = await repo.sourceFile(
      req.authSession!.user.id,
      parse(z.string().regex(/^[a-f0-9]{64}$/), req.params.sha),
    );
    res
      .set({
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${s.filename}"`,
      })
      .send(s.content);
  });
  r.post("/import", async (req, res) => {
    const v = parse(
      z
        .object({
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          reviewed: z.literal(true),
        })
        .strict(),
      req.body,
    );
    res.status(201).json(await repo.import(req.authSession!.user.id, v.sha256));
  });
  r.get("/attachments/:id", async (req, res) => {
    const a = await repo.attachment(
      req.authSession!.user.id,
      parse(z.uuid(), req.params.id),
    );
    res
      .set({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      })
      .send(a.content);
  });
  r.get("/documents/:id.pdf", async (req, res) => {
    const doc = await repo.document(
        req.authSession!.user.id,
        parse(z.uuid(), req.params.id),
      ),
      s = doc.snapshot;
    let buffer: Buffer;
    if (doc.kind === "IPO / PT") buffer = ublIpoSamplePdf(s.sample, "pack");
    else {
      const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
      drawReportLogo(pdf);
      pdf.setFontSize(12);
      pdf.text(doc.kind, 14, 37);
      pdf.setFontSize(8);
      autoTable(pdf, {
        startY: 43,
        margin: { bottom: reportBottomMargin },
        styles: { fontSize: 9, cellPadding: 2 },
        body: [
          ["Customer", "United Bank Limited (UBL)"],
          ["Site / branch", `${s.siteName} (${s.branchCode})`],
          [
            "Configuration",
            s.configuration ?? s.reportedRecommendation ?? "Unconfirmed",
          ],
          ["Document / version", `${doc.id} / ${doc.version}`],
          [
            "Status",
            s.label ?? "Prepared from imported data - verification pending",
          ],
          ["PO", s.poNumber ?? "Not received"],
          ["Expected date", s.expectedDate ?? "Not entered"],
        ],
      });
      if (s.findings) {
        const findings = Object.entries(s.findings).filter(
          ([k, v]) =>
            v != null &&
            !["Site Key", "Branch Code", "Branch Name", "_row"].includes(k),
        );
        if (findings.length)
          autoTable(pdf, {
            startY: (pdf as any).lastAutoTable.finalY + 5,
            margin: { bottom: reportBottomMargin },
            styles: { fontSize: 8, cellPadding: 2 },
            head: [["Reported survey field", "Source value"]],
            body: findings.map(([k, v]) => [k, String(v)]),
          });
      }
      const rows = s.rows ?? [];
      if (rows.length)
        autoTable(pdf, {
          startY: (pdf as any).lastAutoTable.finalY + 5,
          margin: { bottom: reportBottomMargin },
          styles: { fontSize: 8, cellPadding: 2 },
          head: [["Description", "Specification", "Qty", "Unit"]],
          columnStyles: { 2: { halign: "right" }, 3: { halign: "center" } },
          body: rows.map((x: any) => [
            x.description,
            x.specification,
            x.quantity,
            x.unit,
          ]),
        });
      if (s.previousAdvance)
        autoTable(pdf, {
          startY: (pdf as any).lastAutoTable.finalY + 5,
          margin: { bottom: reportBottomMargin },
          styles: { fontSize: 8, cellPadding: 2 },
          head: [["Changes from advance BOQ", "Advance qty", "Confirmed qty"]],
          body: s.differences.length
            ? s.differences.map((x: any) => [
                x.description,
                x.previousQuantity,
                x.confirmedQuantity,
              ])
            : [["No quantity/specification changes", "—", "—"]],
        });
      autoTable(pdf, {
        startY: (pdf as any).lastAutoTable.finalY + 5,
        margin: { bottom: reportBottomMargin },
        styles: { fontSize: 8, cellPadding: 2 },
        body: [
          [
            "Control note",
            s.authorization ??
              "Prepared from imported data. Original survey evidence and customer sending evidence are tracked separately.",
          ],
        ],
      });
      drawReportFooter(
        pdf,
        `UBL / ${s.branchCode} / ${doc.kind} / V${doc.version}`,
      );
      buffer = Buffer.from(pdf.output("arraybuffer"));
    }
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="UBL-${s.branchCode}-${doc.kind.replace(/[^a-z0-9]/gi, "-")}-v${doc.version}.pdf"`,
      })
      .send(buffer);
  });
  r.get("/:id", async (req, res) =>
    res.json(
      await repo.detail(
        req.authSession!.user.id,
        parse(z.uuid(), req.params.id),
      ),
    ),
  );
  r.post("/:id/action", async (req, res) => {
    const v = parse(schema, req.body);
    res.json(
      await repo.action(
        req.authSession!.user.id,
        parse(z.uuid(), req.params.id),
        v.version,
        v.action,
        v.input,
      ),
    );
  });
  r.post("/:id/attachments", async (req, res) => {
    const v = parse(
      z
        .object({
          kind: z.enum([
            "Original request",
            "Survey report",
            "Sending evidence",
            "Heads-up evidence",
            "Customer PO",
            "Operations evidence",
          ]),
          filename: z
            .string()
            .min(1)
            .max(200)
            .refine((s) => !/[\x00-\x1f/\\]/.test(s)),
          mime: z.enum([
            "application/pdf",
            "image/png",
            "image/jpeg",
            "text/plain",
          ]),
          base64: z
            .string()
            .max(11_200_000)
            .regex(/^[a-zA-Z0-9+/]*={0,2}$/),
        })
        .strict(),
      req.body,
    );
    const content = Buffer.from(v.base64, "base64");
    if (!content.length || content.length > 8 * 1024 * 1024)
      throw new HttpError(413, "Choose an attachment up to 8 MB.");
    const signature =
      v.mime === "application/pdf"
        ? content.subarray(0, 5).toString() === "%PDF-"
        : v.mime === "image/png"
          ? content
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : v.mime === "image/jpeg"
            ? content[0] === 255 && content[1] === 216
            : true;
    if (!signature)
      throw new HttpError(
        400,
        "The file content does not match its selected type.",
      );
    res
      .status(201)
      .json(
        await repo.attach(
          req.authSession!.user.id,
          parse(z.uuid(), req.params.id),
          v.kind,
          v.filename,
          v.mime,
          content,
        ),
      );
  });
  return r;
}
