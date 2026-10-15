import {saveHeadsup,submitHeadsup} from './headsup.js';
import {customerSendEvidence,attachCustomerSendEvidence,removeCustomerSendEvidence,sendPackageToCustomer} from "./ubl-customer-send.js";
import { buildIpoPdf, buildPeachtreePdf } from "../orders/document-renderers.js";
import {
  drawReportLogo,
  drawReportFooter,
  reportBottomMargin,
} from "../reports/branding.js";
import { Router, type RequestHandler, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { ProjectWorkflowRepository } from "./repository.js";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { surveyDispatchPdf } from "./survey-dispatch-pdf.js";
export function projectWorkflowHttp(
  repo: ProjectWorkflowRepository,
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
  const actor = (req: any) => req.authSession.user.id,
    id = (req: any) => z.uuid().parse(req.params.id);
  r.get('/framework-reference-attachments/:id',async(req,res)=>{
    const file=await repo.frameworkReferenceAttachment(actor(req),id(req));
    res.set('Content-Type',file.mime).set('Content-Disposition',`inline; filename="${file.filename.replace(/["\r\n\\]/g,'_')}"`).set('Cache-Control','private, no-store').send(file.content);
  });
  r.get('/ipo-number-availability',async(req,res)=>res.json(await repo.ipoAvailability(actor(req),String(req.query.number??''))));
  r.post('/:id/informational-technical-report',async(req,res)=>res.json(await repo.sendInformationalTechnicalReport(actor(req),id(req),req.body)));
  r.get("/po-followup-sources", async (req, res) =>
    res.json({
      sources: await repo.poFollowupSources(
        actor(req),
        z.coerce.number().int().nonnegative().parse(req.query.customerId),
      ),
    }),
  );
  r.get("/headsup-sources", async (req, res) =>
    res.json({
      sources: await repo.headsupSources(
        actor(req),
        z.coerce.number().int().nonnegative().parse(req.query.customerId),
        req.query.includeReceived!=="true",
      ),
    }),
  );
  r.post('/headsup-preview', async(req,res)=>res.json(await saveHeadsup(repo,actor(req),req.body,{preview:true})));
  r.post('/headsup-submit', async(req,res)=>res.json(await submitHeadsup(repo,actor(req),req.body)));
  r.post("/headsup-receipts/:id/send", async (req, res) =>
    res.json(await repo.sendHeadsup(actor(req), id(req), req.body)),
  );
  r.get("/headsup-receipts", async (req, res) =>
    res.json({ receipts: await repo.savedHeadsups(actor(req)) }),
  );
  r.post("/headsup-receipts", async (req, res) =>
    res.status(201).json(await repo.saveHeadsup(actor(req), req.body)),
  );
  r.get("/advance-inbox", async (req, res) =>
    res.json({ requests: await repo.advanceInbox(actor(req)) }),
  );
  r.get("/references", async (req, res) =>
    res.json(await repo.references(actor(req))),
  );
  r.get("/performance", async (req, res) =>
    res.json(
      await repo.performance(
        actor(req),
        String(req.query.department ?? "coordination"),
      ),
    ),
  );
  r.get("/", async (req, res) =>
    res.json(
      await repo.list(
        actor(req),
        String(req.query.department ?? "coordination"),
        String(req.query.scope ?? "mine"),
      ),
    ),
  );
  r.post("/:id/revision-source", async (req, res) =>
    res.json(await repo.frameworkRevisionSource(actor(req), id(req))),
  );
  r.get("/:id/configuration-choices", async (req, res) =>
    res.json({ choices: await repo.configurationChoices(actor(req), id(req)) }),
  );
  r.post("/:id/framework-revision", async (req, res) =>
    res.json(await repo.startFrameworkRevision(actor(req), id(req), req.body)),
  );
  r.post("/", async (req, res) =>
    res.status(201).json(await repo.create(actor(req), req.body)),
  );
  r.post("/frameworks", async (req, res) =>
    res.status(201).json(await repo.framework(actor(req), req.body)),
  );
  r.post("/adopt", async (req, res) =>
    res.json(await repo.adopt(actor(req), req.body)),
  );
  r.post("/surveyors", async (req, res) =>
    res.status(201).json(await repo.addSurveyor(actor(req), req.body)),
  );
  r.post("/survey-dispatches", async (req, res) =>
    res.status(201).json(await repo.createSurveyDispatch(actor(req), req.body)),
  );
  r.post("/survey-dispatches/:id/close", async (req, res) =>
    res.json(await repo.closeSurveyDispatch(actor(req), id(req), req.body)),
  );
  r.post("/survey-dispatches/preview", async (req, res) =>
    res
      .status(201)
      .json(await repo.previewSurveyDispatch(actor(req), req.body)),
  );
  r.post("/survey-dispatch-previews/:id/approve", async (req, res) =>
    res.json(await repo.approveSurveyDispatch(actor(req), id(req))),
  );
  r.get("/survey-dispatches/:id", async (req, res) =>
    res.json(await repo.surveyDispatch(actor(req), id(req))),
  );
  r.get("/survey-dispatch-previews/:id/pdf", async (req, res) => {
    const plan = await repo.surveyDispatchPreview(actor(req), id(req));
    const kind = req.query.kind === "forms" ? "forms" : "dispatch";
    res
      .type("application/pdf")
      .set(
        "Content-Disposition",
        `inline; filename="${plan.number}-${kind}.pdf"`,
      )
      .send(surveyDispatchPdf(plan, kind));
  });
  r.get("/approved-survey-groups", async (req, res) =>
    res.json({ groups: await repo.readyPackages(actor(req)) }),
  );
  r.get("/approved-survey-groups/:id/xlsx", async (req, res) => {
    const file = await repo.readyFile(
      actor(req),
      id(req),
      req.query.recordId ? z.uuid().parse(req.query.recordId) : undefined,
    );
    res
      .type(file.mime)
      .set("Content-Disposition", `attachment; filename="${file.name}"`)
      .send(file.content);
  });
  r.post("/:id/unbind-approved-survey", async (req, res) =>
    res.json(await repo.unbindReady(actor(req), id(req), req.body)),
  );
  r.get("/ubl-survey-packages", async (req, res) =>
    res.json({ packages: await repo.ublSurveyPackages(actor(req)) }),
  );
  r.get("/survey-submission-groups", async (req, res) =>
    res.json({ groups: await repo.surveySubmissionGroups(actor(req)) }),
  );
  r.post("/:id/quotation-master-details", async (req, res) =>
    res.json(await repo.quotationMasterDetails(actor(req), id(req), req.body)),
  );
  r.post("/:id/link-quotation-draft", async (req, res) =>
    res.json(await repo.linkQuotationDraft(actor(req), id(req), req.body)),
  );
  r.get("/survey-submission-groups/:id/xlsx", async (req, res) => {
    const file = await repo.surveySubmissionGroupFile(actor(req), id(req));
    res
      .type(file.mime)
      .set("Content-Disposition", `attachment; filename="${file.name}"`)
      .send(file.content);
  });
  r.post("/:id/remove-from-survey-group", async (req, res) =>
    res.json(await repo.removeFromSurveyGroup(actor(req), id(req), req.body)),
  );
  r.get("/ubl-survey-packages/:id/sending-evidence", async (req,res) => res.json(await customerSendEvidence(repo,actor(req),id(req))));
  r.post("/ubl-survey-packages/:id/sending-evidence", async (req,res) => res.status(201).json(await attachCustomerSendEvidence(repo,actor(req),id(req),req.body)));
  r.post("/ubl-survey-packages/:id/sending-evidence/:file/remove", async (req,res) => res.json(await removeCustomerSendEvidence(repo,actor(req),id(req),z.uuid().parse(req.params.file))));
  r.post("/ubl-survey-packages/:id/send-to-customer", async (req,res) => res.json(await sendPackageToCustomer(repo,actor(req),id(req),req.body)));
  r.post("/ubl-survey-packages/:id/decision", async (req, res) =>
    res.json(await repo.decideUblSurveyPackage(actor(req), id(req), req.body)),
  );
  r.post("/ubl-survey-packages", async (req, res) =>
    res.json(await repo.saveUblSurveyPackage(actor(req), req.body)),
  );
  r.get("/ubl-survey-packages/:id/:kind", async (req, res) => {
    const file = await repo.ublSurveyPackageFile(
      actor(req),
      id(req),
      String(req.params.kind),
    );
    res
      .type(file.mime)
      .set("Content-Disposition", `attachment; filename="${file.name}"`)
      .send(file.content);
  });
  r.get("/:id", async (req, res) =>
    res.json(await repo.detail(actor(req), id(req))),
  );
  r.post("/:id/actions", async (req, res) =>
    res.json(await repo.action(actor(req), id(req), req.body)),
  );
  r.post("/:id/sale-preview", async (req, res) => {
    const snapshot = await repo.salePreview(actor(req), id(req), req.body);
    res
      .set("Cache-Control", "private, no-store")
      .json({
        ipo: buildIpoPdf(snapshot, "DRAFT - NOT ISSUED",snapshot.peachtree,{includePt:false}).toString("base64"),
        pt: buildPeachtreePdf(
          snapshot,
          snapshot.peachtree,
          "DRAFT - NOT ISSUED",
        ).toString("base64"),
      });
  });
  r.post("/:id/preview", async (req, res) =>
    res.json(await repo.preview(actor(req), id(req), req.body)),
  );
  r.post("/:id/files", async (req, res) =>
    res.status(201).json(await repo.attach(actor(req), id(req), req.body)),
  );
  r.post("/:id/files/:file/remove", async (req, res) =>
    res.json(await repo.removeRequestFile(actor(req), id(req), z.uuid().parse(req.params.file))),
  );
  r.get("/:id/files/:file", async (req, res) => {
    const f = await repo.file(
      actor(req),
      id(req),
      z.uuid().parse(req.params.file),
    );
    res
      .type(f.mime)
      .set(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      )
      .set("Cache-Control", "private, no-store")
      .send(f.content);
  });
  r.get("/:id/documents/:document", async (req, res) =>
    res.json(
      await repo.documentData(
        actor(req),
        id(req),
        z.uuid().parse(req.params.document),
      ),
    ),
  );
  r.get("/:id/documents/:document/pdf", async (req, res) => {
    const d = await repo.documentData(
        actor(req),
        id(req),
        z.uuid().parse(req.params.document),
      ),
      pdf = new jsPDF(),
      s = d.snapshot;
    if (
      ["Survey dispatch", "Survey form"].includes(d.kind) &&
      s.dispatchPreviewId
    ) {
      const plan = {
        ...s,
        sites:
          d.kind === "Survey form"
            ? s.sites.filter((site: any) => site.recordId === s.siteRecordId)
            : s.sites,
      };
      return res
        .type("application/pdf")
        .send(
          surveyDispatchPdf(
            plan,
            d.kind === "Survey form" ? "forms" : "dispatch",
          ),
        );
    }
    pdf.setFontSize(18);
    drawReportLogo(pdf);
    pdf.setFontSize(13);
    pdf.text(d.kind, 14, 38);
    pdf.setFontSize(9);
    pdf.text(
      [
        d.number,
        `${d.customer} · ${d.site_name} (${d.site_code})`,
        `Version ${d.version} · ${new Date(d.created_at).toLocaleDateString("en-GB")}`,
      ],
      14,
      46,
    );
    const lines = s.items ?? s.costing?.lines ?? s.boq?.lines ?? [];
    autoTable(pdf, {
      startY: 67,
      margin: { top: 35, bottom: reportBottomMargin },
      head: [
        ["Item ID", "Description / specification", "Brand", "Qty", "Unit"],
      ],
      body: lines.map((l: any) => [
        l.itemId ?? l.key,
        l.description + (l.specification ? "\n" + l.specification : ""),
        l.brand ?? l.stockBrand ?? "General",
        l.qty,
        l.unit,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [40, 43, 78] },
      didDrawPage: () => {
        drawReportLogo(pdf);
      },
    });
    let y = (pdf as any).lastAutoTable?.finalY ?? 60;
    const costing = ['Technical review','Technical review information'].includes(d.kind) ? s.costing : null;
    if (costing) {
      autoTable(pdf, {
        startY: y + 8,
        margin: { top: 35, bottom: reportBottomMargin },
        head: [
          [
            "Item ID",
            "Budgeted cost excl. GST",
            "Markup %",
            "Selling excl. GST",
          ],
        ],
        body: costing.lines.map((l: any) => [
          l.itemId ?? l.key,
          l.cost ?? "Restricted",
          l.markup ?? "Restricted",
          l.selling ?? "Restricted",
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [40, 43, 78] },
        didDrawPage: () => drawReportLogo(pdf),
      });
      y = (pdf as any).lastAutoTable.finalY;
    }

    if (y > 245) {
      pdf.addPage();
      y = 20;
    }
    pdf.setFontSize(9);
    const notes = pdf.splitTextToSize(
      [
        s.notes ?? s.reason ?? s.technicalNotes ?? "",
        s.originalIpoReference
          ? `Original IPO: ${s.originalIpoReference}; revised PO: ${s.poReference} (${s.poDate}). Financial snapshots preserved.`
          : "",
        s.expectedDate ? `Expected material date: ${s.expectedDate}` : "",
        s.agreedSellingInclusiveGst
          ? `Agreed selling amount inclusive GST: PKR ${s.agreedSellingInclusiveGst}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      180,
    );
    y += 10;
    for (const line of notes) {
      if (y > 258) {
        pdf.addPage();
        drawReportLogo(pdf);
        y = 40;
      }
      pdf.text(line, 14, y);
      y += 5;
    }
    if (s.comparison?.billing) {
      autoTable(pdf, {
        startY: y + 8,
        margin: { top: 35, bottom: reportBottomMargin },
        head: [
          [
            "Approved description",
            "Qty",
            "Rate excl. GST",
            "Amount excl. GST",
            "GST %",
          ],
        ],
        body: s.comparison.billing.map((l: any) => [
          l.description,
          l.qty,
          l.rate,
          l.amount,
          l.taxRate,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [40, 43, 78] },
        didDrawPage: () => drawReportLogo(pdf),
      });
    }

    drawReportFooter(pdf, d.number);
    res
      .type("pdf")
      .set(
        "Content-Disposition",
        `inline; filename="${d.kind.replace(/[^A-Za-z]/g, "-")}-v${d.version}.pdf"`,
      )
      .send(Buffer.from(pdf.output("arraybuffer")));
  });
  const validationErrors: ErrorRequestHandler = (error, _req, _res, next) => {
    if (error instanceof z.ZodError)
      return next(
        new HttpError(
          400,
          error.issues
            .map(
              (issue) => `${issue.path.join(".") || "Form"}: ${issue.message}`,
            )
            .join("; "),
        ),
      );
    if (error?.code === "23505")
      return next(
        new HttpError(
          409,
          "This record already exists. Reload and open the existing site or order.",
        ),
      );
    next(error);
  };
  r.use(validationErrors);
  return r;
}
