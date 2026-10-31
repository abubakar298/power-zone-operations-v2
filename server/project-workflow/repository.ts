import {queueIssuedPo,queueSharedIpo} from '../ipo-email/queue.js';
import {sentSurveyAwaitingDesign} from '../../shared/sent-survey-requests.js';
import {linkCreatedOperationsMaterialSource} from '../inventory/source-links.js';
import {syncCreatedOperationsHandoff} from '../operations-board/live-ipo-sync.js';
import {SiteWorkflowRepository} from '../site-workflow/repository.js';
import {loadDocumentListMetadata,snapshotListMetadata} from '../documents/list-metadata.js';
import {directPoFields,directPoSiteMatches,directPoChanges,validOrderPosition,directPoCapacityIssues} from '../../shared/direct-po-reading.js';
import {manualIpoAvailable,ipoNumberConflict,requireDirectUps,requireEditableIpoRoute} from "../documents/manual-ipo.js";
import {approvedMaterialView} from './advance-material-view.js';
import {ptDetail} from '../orders/pt-detail.js';
import {ipoReference} from '../documents/historical-ipo.js';
import { headsupSources, saveHeadsup, sendHeadsup } from "./headsup.js";
import { readyPackages, readyFile, unbindReady } from "./ready-send.js";
import {
  revisionSource,
  startFrameworkRevision,
  configurationChoices,
} from "./framework-revision.js";
import { decideUblSurveyPackage } from "./ubl-management-decision.js";
import {
  savePackage,
  packageList,
  packageFile,
  submissionGroups,
  submissionGroupFile,
  unbindSubmissionGroup,
} from "./ubl-review-package.js";
import { isBessEquipment } from "../http/cost-visibility.js";
import { finalizeCustomerBoq } from "../boq/lifecycle.js";
import { quickCableComparison } from "./quick-cable-comparison.js";
import { ublSurveyComparison } from "./ubl-survey-comparison.js";
import { createHash, randomUUID } from "node:crypto";
import {
  createDispatch,
  closeDispatch,
  dispatchChoices,
  previewDispatch,
  approveDispatch,
  getDispatchPreview,
  latestDispatch,
} from "./survey-dispatch.js";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { surveySchema, surveyDraftSchema } from "../boq/schema.js";
import {
  customerSurveyTemplates,
  saveCustomerSurveyForm,
} from "./customer-survey-forms.js";
import { fingerprint, BoqRepository } from "../boq/repository.js";
import { MastersRepository } from "../masters/repository.js";
import { CoordinatorRepository } from "../coordinator/repository.js";
import {
  allocateReference,
  revisedReference,
} from "../documents/references.js";
import { OrdersRepository } from "../orders/repository.js";
import { ownedCondition } from "../http/permissions.js";
import {
  safeCosting,
  safeDocument,
  bucketFor,
  routeNames,
  compareBasis,
  commercialComparison,
} from "./policy.js";
import {
  createSchema,
  actionSchema,
  designReviewSchema,
  receiptSchema,
} from "./schema.js";
import { designCalculation, frameworkBasis, quotationBasis } from "./basis.js";
const management = (role: string) => ["Admin", "Management"].includes(role);
const uuid = (v: any) => z.uuid().parse(v);
const saleFields = [
  "invoiceCompany",
  "salesPerson",
  "contactPerson",
  "designation",
  "phone",
  "email",
  "billingAddress",
  "paymentContact",
  "paymentPhone",
  "paymentMode",
  "salesSource",
  "remarks",
  "evidenceNotes",
  "customerNtn",
  "customerStrn",
];
function saleInput(basis: any, received: any) {
  if(received.confirmationType==='Email approval'&&!/^MBL-UPS-6-(5|10)$/.test(basis.source?.key??''))
    throw new HttpError(422,'Email approval is available for Meezan Direct PO agreements only.');
  const sale = received.saleDetails ?? {};
  if(sale.orderNumber&&!validOrderPosition(sale.orderNumber))throw new HttpError(422,'Enter the order unit and total, for example 20/60.');
  if (received.saleDetails) {
    if (
      !["PZES", "PZES (PVT Ltd)", "Energy Solutions"].includes(
        sale.invoiceCompany,
      )
    )
      throw new HttpError(422, "Select a valid invoice company.");
    if (
      (sale.invoiceCompany === "Energy Solutions") !==
      (basis.order.quotationType?.saleType === "Cash Deal")
    )
      throw new HttpError(
        422,
        "Invoice company must match the approved quotation deal type.",
      );
    if (!sale.salesPerson?.trim())
      throw new HttpError(422, "Enter the sales person.");
  }
  return {
    ...basis.order.input,
    ...Object.fromEntries(
      Object.entries(sale).filter(([key]) => saleFields.includes(key)),
    ),
    orderNumber: sale.orderNumber??basis.order.input.orderNumber??"",
    poNumber: received.saleDetails?.poNumber ?? (received.confirmationType === "Customer PO" ? received.reference : ""),
    ...(basis.order.allocation?.policy==="fixed-bank-ups"?{salesPerson:"Waqas ul Haq"}:{}),
    approvalReference: received.reference,
    orderDate: received.date,
    evidenceType: received.confirmationType,
    workflowEvidenceId: received.evidenceId,
    evidenceNotes: received.notes,
  };
}
const note = (v: any) => z.string().trim().min(1).max(4000).parse(v);
// Imported snapshots retain their historical source ID while framework_id is
// remapped to the live FK. Both IDs select this record's same frozen approval.
function savedFrameworkSelected(r: any, selectedId: unknown): boolean {
  return typeof r.framework_id === "string" &&
    r.data?.basis?.source?.type === "framework" &&
    typeof selectedId === "string" &&
    (selectedId === r.framework_id || selectedId === r.data.basis.source.id);
}
export class ProjectWorkflowRepository {
  constructor(private pool: Pool) {}
  async user(actor: string, c: Pool | PoolClient = this.pool) {
    const u = (
      await c.query(
        "SELECT id,active,role,display_name,EXISTS(SELECT 1 FROM restricted_cost_access a WHERE a.user_id=users.id) AS restricted_cost_access FROM users WHERE id=$1",
        [actor],
      )
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Active account required.");
    if (
      ![
        "Design",
        "Coordinator",
        "Admin",
        "Management",
        "Accounts",
        "Operations",
      ].includes(u.role)
    )
      throw new HttpError(403, "Department access required.");
    return u;
  }
  async record(
    actor: string,
    id: string,
    c: Pool | PoolClient = this.pool,
    lock = false,
  ) {
    const u = await this.user(actor, c),
      r = (
        await c.query(
          `SELECT r.*,c.name AS customer,c.short_code,s.code AS canonical_site_code,p.display_name AS planner,t.display_name AS technical_owner,k.display_name AS coordinator FROM project_workflow_records r JOIN customers c ON c.id=r.customer_id LEFT JOIN sites s ON s.id=r.site_id LEFT JOIN users p ON p.id=r.planning_owner_id LEFT JOIN users t ON t.id=r.technical_owner_id JOIN users k ON k.id=r.coordinator_id WHERE r.id=$1${lock ? " FOR UPDATE OF r" : ""}`,
          [id],
        )
      ).rows[0];
    if (!r) throw new HttpError(404, "Workflow record not found.");
    const allowed =
      management(u.role) ||
      (u.role === "Coordinator" && r.coordinator_id === actor) ||
      (u.role === "Design" && r.stage !== "request_review") ||
      (u.role === "Accounts" && r.stage === "issued") ||
      (u.role === "Operations" &&
        (
          await c.query(
            "SELECT 1 FROM project_advance_planning WHERE record_id=$1 AND operations_owner_id=$2",
            [id, actor],
          )
        ).rowCount);
    if (!allowed)
      throw new HttpError(
        404,
        "Workflow record is not available to your account.",
      );
    return { u, r };
  }
  requireRole(u: any, roles: string[]) {
    if (!management(u.role) && !roles.includes(u.role))
      throw new HttpError(403, "Your department cannot perform this action.");
  }
  async requireReceivingDepartment(
    u: any,
    r: any,
    c: Pool | PoolClient = this.pool,
  ) {
    if (r.legacy_type === "ubl")
      throw new HttpError(
        403,
        "Existing UBL workflow is preserved in its original interface. Migration to the new journey requires a separate owner instruction.",
      );
    const rule = (
      await c.query(
        "SELECT rule FROM workflow_department_handoff_rules ORDER BY version DESC LIMIT 1",
      )
    ).rows[0]?.rule;
    const current = await this.decorate(r, u, c);
    const receiving =
      current.quotation?.status === "Submitted"
        ? "Management"
        : current.coordinationBucket === "Customer Decision & Order Tracking"
          ? "Coordinator"
          : rule?.stages[r.stage];
    const department = u.role === "Admin" ? "Management" : u.role;
    if (receiving && department !== receiving)
      throw new HttpError(
        403,
        `This document is with ${receiving}. The sending department has preview-only access; only the receiving department can edit or return it.`,
      );
  }
  async person(c: PoolClient, id: string, role: string) {
    const p = (
      await c.query("SELECT id FROM users WHERE id=$1 AND active AND role=$2", [
        id,
        role,
      ])
    ).rows[0];
    if (!p) throw new HttpError(422, `Select an active ${role} account.`);
    return p.id;
  }
  async references(actor: string) {
    const u = await this.user(actor);
    this.requireRole(u, ["Coordinator", "Design", "Accounts"]);
    const m = await new MastersRepository(this.pool).list();
    return {
      frameworkAttachments: (await this.pool.query('SELECT id,framework_id,filename,summary FROM framework_reference_attachments ORDER BY created_at,id')).rows,
      surveyFormTemplates: await customerSurveyTemplates(this.pool),
      customers: m.customers
        .filter((c: any) => c.status === "Active")
        .map(
          ({ id, name, short_code, contact_person, phone, email, address, ntn, strn }: any) => ({
            id,
            name,
            short_code,
            contact_person,
            phone,
            email,
            ntn,
            strn,
            address,
          }),
        ),
      sites: m.sites,
      people: (
        await this.pool.query(
          "SELECT id,display_name,role FROM users WHERE active AND role IN('Design','Coordinator','Operations') ORDER BY display_name",
        )
      ).rows,
      surveyors: (
        await this.pool.query(
          "SELECT id,display_name,'' AS phone,'' AS member_code FROM users WHERE active AND role='Design' UNION ALL SELECT id,display_name,phone,'SUR-'||lpad(member_number::text,6,'0') AS member_code FROM survey_team_members WHERE active ORDER BY display_name",
        )
      ).rows,
      surveyDispatches: await dispatchChoices(this.pool),
      brands: m.brands.filter((b: any) => b.status === "Active"),
      inverters: m.inverters,
      catalogue: m.catalogue.map(
        ({ item_id, version, rate_key, payload }: any) => ({
          item_id,
          version,
          rate_key,
          payload: { ...payload, reviewNotes: undefined },
        }),
      ),
      profiles: m.engineeringProfiles,
      rules: m.rules.map(({ key, version, setting, value }: any) => ({
        key,
        version,
        setting,
        value,
      })),
      features: {directPoUps:process.env.ENABLE_DEFERRED_UPS_WORKFLOW==='true'},
      frameworks: (
        await this.pool.query(
          "SELECT id,customer_id,configuration_key,version,source_reference,payload->>'type' AS type,payload->>'pricingStage' AS pricing_stage,payload->'routes' AS routes FROM project_framework_current WHERE ($1 OR payload->>'type' IS DISTINCT FROM 'bank-ups') ORDER BY customer_id,configuration_key",
          [process.env.ENABLE_DEFERRED_UPS_WORKFLOW==='true'],
        )
      ).rows,
      quotations: (
        await this.pool.query(
          `SELECT q.id,q.number,q.version,b.customer_id,s.code AS site_code,s.name AS site_name FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id JOIN boqs b ON b.id=br.boq_id JOIN sites s ON s.id=b.site_id WHERE ${ownedCondition("quotation", "q.id", "$1")} AND (SELECT kind FROM coordination_events e WHERE e.quotation_id=q.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) IN('Approved','PO received') AND NOT EXISTS(SELECT 1 FROM quotation_versions n WHERE n.boq_revision_id=q.boq_revision_id AND n.version>q.version) AND NOT EXISTS(SELECT 1 FROM quotation_revision_requests rr WHERE rr.source_quotation_id=q.id) ORDER BY q.created_at DESC`,
          [actor],
        )
      ).rows,
      routes: routeNames,
    };
  }
  async frameworkReferenceAttachment(actor:string,id:string){
    const u=await this.user(actor);
    this.requireRole(u,['Coordinator','Design','Accounts']);
    const file=(await this.pool.query('SELECT filename,mime,content,sha256 FROM framework_reference_attachments WHERE id=$1',[id])).rows[0];
    if(!file)throw new HttpError(404,'Reference attachment not found.');
    if(createHash('sha256').update(file.content).digest('hex')!==file.sha256)throw new HttpError(409,'Reference attachment verification failed.');
    return file;
  }
  async decorate(r: any, u: any, c: Pool | PoolClient = this.pool) {
    const data = r.data ?? {};
    let task: any;
    if (
      (data.draftId || data.latestQuotationId) &&
      !data.noFeasibleSolution &&
      ![
        "technical_revision",
        "commercial_revision",
        "order_exception",
        "issued",
      ].includes(r.stage)
    ) {
      const f = (
        await c.query(
          "SELECT f.revision_id FROM boq_draft_finalizations f WHERE draft_id=$1",
          [data.draftId],
        )
      ).rows[0];
      const quotationRevision = data.latestQuotationId
        ? (
            await c.query(
              "SELECT boq_revision_id AS revision_id FROM quotation_versions WHERE id=$1",
              [data.latestQuotationId],
            )
          ).rows[0]
        : null;
      const currentRevision = quotationRevision ?? f;
      if (currentRevision) {
        const q = (
          await c.query(
            "SELECT q.id,q.number,q.version,COALESCE(e.kind,'Draft') AS status,EXISTS(SELECT 1 FROM quotation_dispatch_records d WHERE d.quotation_id=q.id) AS dispatched,EXISTS(SELECT 1 FROM quotation_revision_requests rr WHERE rr.source_quotation_id=q.id) AS revision FROM quotation_versions q LEFT JOIN LATERAL(SELECT kind FROM coordination_events WHERE quotation_id=q.id ORDER BY created_at DESC,id DESC LIMIT 1)e ON true WHERE q.boq_revision_id IN(SELECT id FROM boq_revisions WHERE boq_id=(SELECT boq_id FROM boq_revisions WHERE id=$1)) ORDER BY q.created_at DESC,q.version DESC LIMIT 1",
            [currentRevision.revision_id],
          )
        ).rows[0];
        if (q) {
          task = {
            id: q.id,
            kind: "Sale confirmation",
            target: "quotes",
            boq_revision_id: currentRevision.revision_id,
          };
          r.coordinationBucket =
            q.revision || q.status === "Changes requested"
              ? "Revisions Required"
              : q.status === "Submitted"
                ? "Submitted for Management Review"
                : ["Approved", "PO received"].includes(q.status)
                  ? q.dispatched
                    ? "Customer Decision & Order Tracking"
                    : "Approved Documents—Awaiting Dispatch"
                  : "Design Outputs—Awaiting Action";
          r.quotation = q;
        } else {
          const p = (
            await c.query(
              "SELECT id FROM commercial_pricing_versions WHERE boq_revision_id=$1 ORDER BY version DESC LIMIT 1",
              [currentRevision.revision_id],
            )
          ).rows[0];
          task = {
            id: p?.id ?? currentRevision.revision_id,
            target: p ? "quotes" : "pricing",
            kind: p ? "Quotation" : "Commercial pricing",
            boq_revision_id: currentRevision.revision_id,
          };
        }
      } else
        task = { target: "boqs", draft_id: data.draftId, kind: "Survey / BOQ" };
    }
    const day = (v: any) => (v ? String(v).slice(0, 10) : null),
      scheduled = day(data.scheduledSurveyDate),
      today = (
        await c.query(
          "SELECT to_char(now() AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD') AS today",
        )
      ).rows[0].today;
    if (data.latestQuotationId && !r.quotation) {
      r.quotation = (
        await c.query(
          "SELECT q.id,q.number,q.boq_revision_id,COALESCE(e.kind,'Draft') AS status FROM quotation_versions q LEFT JOIN LATERAL(SELECT kind FROM coordination_events WHERE quotation_id=q.id ORDER BY created_at DESC LIMIT 1)e ON true WHERE q.id=$1",
          [data.latestQuotationId],
        )
      ).rows[0];
    }
    const shared =
      r.stage === "issued"
        ? (
            await c.query(
              "SELECT q.number AS ipo_number,p.reference,p.input->>'date' AS po_date,i.created_at,h.ipo_id,i.operations_id FROM project_workflow_issuances i JOIN internal_purchase_orders q ON q.id=i.ipo_id JOIN project_po_receipts p ON p.id=i.receipt_id JOIN ipo_accounts_handoffs h ON h.ipo_id=i.ipo_id JOIN operations_boq_issuances o ON o.id=i.operations_id WHERE i.record_id=$1",
              [r.id],
            )
          ).rows[0]
        : null;
    const headsup = (
      await c.query(
        "SELECT h.id,h.created_at,h.snapshot,EXISTS(SELECT 1 FROM headsup_department_handoffs d WHERE d.receipt_id=h.id) AS sent FROM customer_headsup_receipts h WHERE EXISTS(SELECT 1 FROM active_headsup_received_sites binding WHERE binding.record_id::text=$1) AND NOT EXISTS(SELECT 1 FROM audit_log archived WHERE archived.action='customer.headsup.unsaved:'||h.id::text) AND NOT EXISTS(SELECT 1 FROM customer_headsup_receipts newer WHERE newer.supersedes_id=h.id) AND EXISTS(SELECT 1 FROM jsonb_array_elements(h.snapshot->'matches') m WHERE m->>'recordId'=$1) ORDER BY h.created_at DESC LIMIT 1",
        [r.id],
      )
    ).rows[0];
    const readyGroupSize =
      r.stage === "approved_dispatch" &&
      data.ublSurveyPackageId &&
      !data.readySendUnbound
        ? Number(
            (
              await c.query(
                "SELECT count(*) AS n FROM project_workflow_records WHERE stage='approved_dispatch' AND data->>'ublSurveyPackageId'=$1 AND COALESCE(data->>'readySendUnbound','false')<>'true'",
                [data.ublSurveyPackageId],
              )
            ).rows[0].n,
          )
        : 0;
    return {
      id: r.id,
      customerId: r.customer_id,
      customer: r.customer,
      customerCode: r.short_code,
      siteId: r.site_id,
      site: r.site_name,
      siteCode: r.canonical_site_code ?? r.site_code,
      region: r.region,
      route: r.route,
      routeLabel: routeNames[r.route],
      stage: r.stage,
      version: r.version,
      coordinatorId: r.coordinator_id,
      planningOwnerId: r.planning_owner_id,
      technicalOwnerId: r.technical_owner_id,
      frameworkId: r.framework_id,
      person: ["survey_requested", "survey_scheduled"].includes(r.stage)
        ? (r.planner ?? "Unassigned")
        : [
              "report_received",
              "technical_review",
              "technical_revision",
            ].includes(r.stage)
          ? (r.technical_owner ?? "Unassigned")
          : r.coordinator,
      started_at: r.updated_at,
      created_at: r.created_at,
      designBucket: bucketFor(r, "design"),
      coordinationBucket: shared
        ? "IPOs Shared"
        : r.stage === "order_exception"
          ? "Submitted for Management Review"
          : bucketFor(r, "coordination"),
      overdue:
        !!scheduled && scheduled < today && r.stage === "survey_scheduled",
      blocker: data.noFeasibleSolution
        ? "Needs Review — No Feasible Solution"
        : data.ublStandardsReview?.needsReview
          ? "Needs Review — UBL standards deviation"
        : (data.returnReason ??
          (r.stage === "order_exception"
            ? "PO differs from approved commercial basis"
            : data.dispatchVia === "Sales" && !data.salesSendConfirmed
              ? "Handed to Sales; customer sending evidence is still pending"
              : "")),
      nextAction: shared
        ? "Preview"
        : data.noFeasibleSolution
          ? "Needs Review — Open Survey"
          : r.route === "survey-framework" &&
              r.short_code?.toUpperCase() === "UBL" &&
              data.designHandoffAt
            ? "Open to Review"
            : task
              ? "Review"
              : r.stage === "request_review"
                ? "Review and send to Design"
                : r.stage === "survey_requested"
                  ? "Schedule and assign survey"
                  : r.stage === "survey_scheduled"
                    ? data.surveyDispatchId
                      ? data.surveyInputsSavedAt
                        ? "Complete Submission"
                        : "Open Survey"
                      : "Create / assign dispatch"
                    : r.stage === "report_received"
                      ? "Submit Technical Review"
                      : r.stage === "technical_revision"
                        ? "Review returned technical changes"
                        : r.stage === "technical_review"
                          ? "Verify design and hand off"
                          : r.stage === "approved_dispatch"
                            ? "Dispatch approved document"
                            : r.stage === "order_exception"
                              ? "Resolve commercial exception"
                              : r.stage === "advance_pending"
                                ? "Send advance planning request"
                                : r.stage === "issued"
                                  ? "View issued IPO and handoffs"
                                  : "Open site record",
      task,
      data: {
        surveyPackageSiteCount: data.ublSurveyPackageId
          ? Number(
              (
                await c.query(
                  "SELECT jsonb_array_length(snapshot->'sites') AS n FROM ubl_survey_review_packages WHERE id=$1",
                  [data.ublSurveyPackageId],
                )
              ).rows[0]?.n ?? 1,
            )
          : 1,
        headsupReceived: !!headsup,
        headsupReceiptId: headsup?.id ?? null,
        headsupDate: headsup?.created_at ?? null,
        headsupSolution:
          headsup?.snapshot?.matches.find((m: any) => m.recordId === r.id)
            ?.receivedSolutionId ?? null,
        advanceBoqSent: headsup?.sent ?? false,
        ipoShared: !!shared,
        ipoNumber: shared?.ipo_number ?? data.ipoNumber ?? null,
        sharedPoReference: shared?.reference ?? null,
        sharedPoDate: shared?.po_date ?? null,
        sharedAt: shared?.created_at ?? null,
        directPoDetails: data.directPoDetails??null,
        notes: data.notes ?? "",
        noFeasibleSolution: data.noFeasibleSolution ?? null,
        ublStandardsReview: data.ublStandardsReview ?? null,
        scheduledSurveyDate: data.scheduledSurveyDate ?? "",
        actualSurveyDate: data.actualSurveyDate ?? "",
        submissionRemarks: data.submissionRemarks ?? "",
        sitePictureFolder: data.sitePictureFolder ?? null,
        surveyInputs: data.surveyInputs ?? null,
        surveyInputsSavedAt: data.surveyInputsSavedAt ?? null,
        customerSurveyForms: data.customerSurveyForms ?? {},
        customerSurveyDrafts: data.customerSurveyDrafts ?? {},
        surveyReading: data.surveyReading ?? null,
        surveyTeam: data.surveyTeam ?? [],
        returnReason: data.returnReason ?? "",
        designHandoffAt: data.designHandoffAt ?? null,
        reviewDocumentId: data.reviewDocumentId ?? null,
        recipientId: data.recipientId ?? null,
        dispatchVia: data.dispatchVia ?? null,
        salesSendConfirmed: data.salesSendConfirmed ?? false,
        customerOutcome: data.customerOutcome ?? null,
        expectedDate: data.expectedDate ?? null,
        deliveryAddress: data.deliveryAddress ?? "",
        siteContact: data.siteContact ?? "",
        sitePhone: data.sitePhone ?? "",
        siteAddress: data.siteAddress ?? "",
        siteCreatedHere: data.siteCreatedHere ?? false,
        customerAddedHere: data.customerAddedHere ?? false,
        sentToDesignAt: data.sentToDesignAt ?? null,
        surveyDispatchId: data.surveyDispatchId ?? null,
        surveyDispatchNumber: data.surveyDispatchNumber ?? null,
        readySendGrouped: readyGroupSize > 1,
        readySendUnbound: data.readySendUnbound ?? false,
        ublSurveyPackageId: data.ublSurveyPackageId ?? null,
        ublSurveyPackageStatus: data.ublSurveyPackageStatus ?? null,
        surveySubmissionGroupId: data.surveySubmissionGroupId ?? null,
        basisSource: data.basis?.source ?? null,
        receiptId: data.receiptId ?? null,
        ipoId: data.ipoId ?? shared?.ipo_id ?? null,
        operationsId: data.operationsId ?? shared?.operations_id ?? null,
        amendmentId: data.amendmentId ?? null,
        originalIpoReference: data.originalIpoReference ?? null,
        draftId: data.draftId ?? null,
        originalOrderPreserved: data.originalOrderPreserved ?? false,
        legacyType: r.legacy_type,
        legacyId: r.legacy_id,
      },
      quotation: r.quotation ?? null,
      references: (
        await c.query(
          "SELECT number FROM project_workflow_documents WHERE record_id=$1",
          [r.id],
        )
      ).rows.map((d) => d.number),
      location:
        data.location ??
        data.legacySurvey?.location ??
        data.legacySource?.branch?.Location ??
        r.region,
    };
  }
  async list(actor: string, department: string, scope: string) {
    const u = await this.user(actor);
    this.requireRole(u, ["Design", "Coordinator"]);
    if (scope === "team" && !management(u.role))
      throw new HttpError(403, "Team Tasks require Management permission.");
    const rows = (
      await this.pool.query(
        `SELECT r.*,c.name AS customer,c.short_code,s.code AS canonical_site_code,p.display_name AS planner,t.display_name AS technical_owner,k.display_name AS coordinator FROM project_workflow_records r JOIN customers c ON c.id=r.customer_id LEFT JOIN sites s ON s.id=r.site_id LEFT JOIN users p ON p.id=r.planning_owner_id LEFT JOIN users t ON t.id=r.technical_owner_id JOIN users k ON k.id=r.coordinator_id WHERE r.legacy_type IS DISTINCT FROM 'ubl' AND r.data->>'bulkHistoricalImport' IS DISTINCT FROM 'true' AND (r.data->>'localPreviewArchived') IS DISTINCT FROM 'true' AND ($3<>'design' OR r.stage<>'request_review') AND ($2 OR CASE WHEN $3='design' THEN $4 OR r.planning_owner_id=$1 OR r.technical_owner_id=$1 OR r.data->'surveyTeam' ? $1::text ELSE r.coordinator_id=$1 END) ORDER BY r.updated_at DESC`,
        [
          actor,
          scope === "team" && management(u.role),
          department,
          u.role === "Design",
        ],
      )
    ).rows;
    const records = [];
    for (const r of rows) records.push(await this.decorate(r, u));
    const surveyPackageIds=[...new Set(records.map((r:any)=>r.data.ublSurveyPackageId).filter((id:any)=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)))];
    const surveyBatches=surveyPackageIds.length?(await this.pool.query('SELECT package_id,sequence FROM survey_submission_groups WHERE package_id=ANY($1::uuid[])',[surveyPackageIds])).rows:[];
    const surveyBatchNumbers=new Map(surveyBatches.map((g:any)=>[g.package_id,'SSG-'+String(g.sequence).padStart(5,'0')]));
    for(const record of records)Object.assign(record,{surveyBatchNumber:surveyBatchNumbers.get(record.data.ublSurveyPackageId)??null});
    const documentMetadata=await loadDocumentListMetadata(this.pool,[...records.flatMap((r:any)=>[r.data.ipoId,r.quotation?.id,r.task?.id]),...rows.flatMap((r:any)=>[r.data?.latestQuotationId,r.data?.quotationId])].filter(Boolean));
    for(const record of records){
      const source=rows.find(r=>r.id===record.id),basis=source?.data?.basis;
      const family=basis?.boq?.survey?.family??(source?.route==='survey-framework'?'solar-hybrid':source?.route==='direct-framework'?'bess-only':undefined);
      const fallback=snapshotListMetadata(basis?.order,family),saved=documentMetadata.get(record.data.ipoId)??documentMetadata.get(record.quotation?.id)??documentMetadata.get(source?.data?.latestQuotationId)??documentMetadata.get(source?.data?.quotationId)??documentMetadata.get(record.task?.id);
      Object.assign(record,saved?{...saved,solutionType:saved.solutionType==='Not recorded'?fallback.solutionType:saved.solutionType}:fallback);
    }
    // The existing ordinary commercial tasks stay actionable until adopted into a route.
    const linked = new Set(
      rows.flatMap((r) =>
        [
          r.data?.draftId,
          r.data?.quotationId,
          r.data?.latestQuotationId,
          r.data?.ipoId,
          r.data?.linkedBoqRevisionId,
        ].filter(Boolean),
      ),
    );
    // Decorated workflow records may resolve a quotation through their draft.
    // Exclude that exact document from legacy tasks as well as explicit links.
    for (const record of records)
      if (record.task?.id) linked.add(record.task.id);
    if (rows.length) {
      const sources = (
        await this.pool.query(
          "SELECT s.boq_revision_id,b.draft_id FROM framework_revision_sources s JOIN boq_revisions r ON r.id=s.boq_revision_id JOIN boqs b ON b.id=r.boq_id WHERE s.record_id=ANY($1::uuid[])",
          [rows.map((r) => r.id)],
        )
      ).rows;
      for (const source of sources) {
        linked.add(source.boq_revision_id);
        linked.add(source.draft_id);
      }
    }
    const archivedDocumentIds=(await this.pool.query("SELECT jsonb_array_elements_text(records->'localPreviewDocumentIds') AS id FROM test_workflow_archives WHERE key LIKE 'LOCAL-REVIEW-SAMPLES-%'")).rows;
    for(const archived of archivedDocumentIds)linked.add(archived.id);
    const legacy =
      department === "coordination"
        ? (
            await new CoordinatorRepository(this.pool).overview(
              actor,
              scope === "team",
            )
          ).tasks.filter(
            (t: any) =>
              ![t.id, t.draft_id, t.ipo_id, t.boq_revision_id].some((id) =>
                linked.has(id),
              ),
          )
        : [];
    return { records, legacyTasks: legacy, department, scope };
  }
  async detail(actor: string, id: string) {
    const { u, r } = await this.record(actor, id);
    const masterReview = {
      customer: (
        await this.pool.query("SELECT * FROM customers WHERE id=$1", [
          r.customer_id,
        ])
      ).rows[0],
      site: (
        await this.pool.query("SELECT * FROM sites WHERE id=$1", [r.site_id])
      ).rows[0],
    };
    const record = await this.decorate(r, u),
      documents = (
        await this.pool.query(
          "SELECT id,kind,version,number,snapshot,created_at FROM project_workflow_documents WHERE record_id=$1 ORDER BY created_at DESC",
          [id],
        )
      ).rows;
    const files = (
      await this.pool.query(
        "SELECT id,kind,filename,mime,created_at FROM project_workflow_files WHERE record_id=$1 AND NOT id::text IN (SELECT jsonb_array_elements_text(COALESCE(data->'removedRequestFileIds','[]'::jsonb)) FROM project_workflow_records WHERE id=$1) ORDER BY created_at",
        [id],
      )
    ).rows;
    const events = (
      await this.pool.query(
        "SELECT e.id,e.version,e.action,e.snapshot->>'reason' AS reason,e.snapshot->>'stage' AS stage,e.created_at,u.display_name AS actor FROM project_workflow_events e JOIN users u ON u.id=e.created_by WHERE record_id=$1 ORDER BY version",
        [id],
      )
    ).rows;
    const receipt = r.data.receiptId
      ? (
          await this.pool.query(
            "SELECT * FROM project_po_receipts WHERE id=$1 AND record_id=$2",
            [r.data.receiptId, id],
          )
        ).rows[0]
      : null;
    const lastReview = documents.find(
      (d) => d.kind === "Technical review" && d.id === r.data.reviewDocumentId,
    );
    const legacy =
      r.legacy_type === "ubl"
        ? {
            documents: (
              await this.pool.query(
                "SELECT id,kind,version,created_at FROM ubl_workflow_documents WHERE request_id=$1 ORDER BY version",
                [r.legacy_id],
              )
            ).rows,
            attachments: (
              await this.pool.query(
                "SELECT id,kind,filename,created_at FROM ubl_workflow_attachments WHERE request_id=$1",
                [r.legacy_id],
              )
            ).rows,
          }
        : null;
    const finalBoq = record.data.ipoShared
      ? (
          await this.pool.query(
            "SELECT number,snapshot FROM operations_boq_issuances WHERE id=$1",
            [record.data.operationsId],
          )
        ).rows[0]
      : null;
    return {
      record,
      informationalTechnicalReport:(await this.pool.query('SELECT t.document_id,d.number,t.created_at FROM informational_technical_reports t JOIN project_workflow_documents d ON d.id=t.document_id WHERE t.record_id=$1 AND t.source_review_id=$2 ORDER BY t.created_at DESC LIMIT 1',[id,r.data.reviewDocumentId??null])).rows[0]??null,
      sharedFinalBoq: finalBoq
        ? {
            number: finalBoq.number,
            items: (finalBoq.snapshot.items ?? []).map((item: any) => ({
              itemId: item.itemId ?? item.key,
              description: item.description,
              brand: item.brand,
              qty: item.qty,
              unit: item.unit,
            })),
          }
        : null,
      masterReview,
      documents: documents.map((d) => ({
        ...d,
        snapshot: safeDocument(
          d.snapshot,
          u.restricted_cost_access ? "Admin" : "Restricted",
        ),
      })),
      files,
      events,
      legacy,
      receipt: receipt
        ? {
            id: receipt.id,
            reference: receipt.reference,
            input: receipt.input,
            differences: receipt.differences,
            basisSource: receipt.basis.source,
          }
        : null,
      review:
        lastReview && r.data.reviewDocumentId === lastReview.id
          ? {
              notes: lastReview.snapshot.notes ?? "",
              survey: lastReview.snapshot.boq?.survey,
              profile: lastReview.snapshot.boq?.workflowProfile,
              itemSelections: lastReview.snapshot.itemSelections ?? {},
              costing: safeCosting(
                lastReview.snapshot.boq,
                u.restricted_cost_access ? "Admin" : "Restricted",
                lastReview.snapshot.markups,
              ),
            }
          : r.legacy_type === "design"
            ? { survey: r.data.legacySurvey, itemSelections: {}, costing: null }
            : null,
      basis: r.data.basis
        ? {
            source: r.data.basis.source,
            comparison: r.data.basis.comparison,
            sourceFingerprint: r.data.basis.fingerprint,
          }
        : null,
    };
  }
  async sendHeadsup(actor: string, id: string, input: unknown) {
    return sendHeadsup(this, actor, id, input);
  }
  async savedHeadsups(actor: string) {
    const u = await this.user(actor);
    this.requireRole(u, ["Coordinator"]);
    return (
      await this.pool.query(
        "SELECT h.id,h.customer_id,h.evidence_id,h.created_at,c.name AS customer,h.snapshot-'ocrText' AS snapshot,EXISTS(SELECT 1 FROM headsup_department_handoffs sent WHERE sent.receipt_id=h.id) AS sent FROM customer_headsup_receipts h JOIN customers c ON c.id=h.customer_id WHERE ($2 OR h.created_by=$1) AND EXISTS(SELECT 1 FROM jsonb_array_elements(h.snapshot->'matches') m JOIN project_workflow_records r ON r.id::text=m->>'recordId' WHERE r.data->>'localPreviewArchived' IS DISTINCT FROM 'true') AND NOT EXISTS(SELECT 1 FROM audit_log archived WHERE archived.action='customer.headsup.unsaved:'||h.id::text) AND NOT EXISTS(SELECT 1 FROM customer_headsup_receipts newer WHERE newer.supersedes_id=h.id) ORDER BY h.created_at DESC LIMIT 100",
        [actor, management(u.role)],
      )
    ).rows;
  }
  async poFollowupSources(actor: string, customerId: number) {
    return headsupSources(this, actor, customerId, this.pool, false);
  }
  async headsupSources(actor: string, customerId: number, pendingOnly=true) {
    return headsupSources(this, actor, customerId, this.pool, pendingOnly);
  }
  async saveHeadsup(actor: string, input: unknown) {
    return saveHeadsup(this, actor, input);
  }
  async readyPackages(actor: string) {
    return readyPackages(this, actor);
  }
  async readyFile(actor: string, id: string, recordId?: string) {
    return readyFile(this, actor, id, recordId);
  }
  async unbindReady(actor: string, id: string, input: unknown) {
    return unbindReady(this, actor, id, input);
  }
  async configurationChoices(actor: string, id: string) {
    return configurationChoices(this, actor, id);
  }
  async frameworkRevisionSource(actor: string, id: string) {
    return revisionSource(this, actor, id);
  }
  async startFrameworkRevision(actor: string, id: string, input: unknown) {
    return startFrameworkRevision(this, actor, id, input);
  }
  async decideUblSurveyPackage(actor: string, id: string, input: unknown) {
    return decideUblSurveyPackage(this, actor, id, input);
  }
  async saveUblSurveyPackage(actor: string, input: unknown) {
    return savePackage(this, actor, input);
  }
  async ublSurveyPackages(actor: string) {
    return packageList(this, actor);
  }
  async surveySubmissionGroups(actor: string) {
    return submissionGroups(this, actor);
  }
  async prepareSentQuotation(actor:string,id:string,raw:unknown){
    const input=z.object({version:z.number().int().positive()}).strict().parse(raw);
    return transaction(this.pool,async c=>{
      const {u,r}=await this.record(actor,id,c,true);this.requireRole(u,['Coordinator']);
      // Own commercial preparation is allowed while Design retains its survey stage and evidence.
      if(r.legacy_type==='ubl')throw new HttpError(403,'Use the preserved UBL workflow for this request.');
      if(!sentSurveyAwaitingDesign(r))throw new HttpError(409,'This survey is no longer awaiting Design. Open its current stage.');
      if(r.data.sentQuotationDraftId){
        const existing=(await c.query('SELECT id FROM survey_drafts WHERE id=$1 AND owner_id=$2',[r.data.sentQuotationDraftId,r.coordinator_id])).rows[0];
        if(!existing)throw new HttpError(409,'The linked quotation preparation needs review.');
        const current=await this.decorate(r,u,c);
        return {recordId:id,draftId:existing.id,task:current.task,repeated:true};
      }
      if(r.version!==input.version)throw new HttpError(409,'The survey request changed. Reload before preparing a quotation.');
      const draftId=randomUUID(),site=(await c.query('SELECT * FROM sites WHERE id=$1 AND customer_id=$2',[r.site_id,r.customer_id])).rows[0];
      if(!site)throw new HttpError(409,'The linked site is unavailable.');
      await c.query('INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,$3)',[draftId,r.coordinator_id,{customerId:r.customer_id,siteName:site.name,siteCode:site.code,location:site.location??'',sourceMode:'General quotation',brands:{},preparedBy:u.display_name,uploadIds:[],ocrText:'',ocrReviewed:false}]);
      const data={...r.data,...(r.data.draftId?{designDraftId:r.data.designDraftId??r.data.draftId}:{}),draftId,sentQuotationDraftId:draftId,coordinationQuotationDraftId:draftId,coordinationPreparedBeforeDesign:true};
      await c.query('UPDATE project_workflow_records SET data=$2,version=version+1,updated_at=now() WHERE id=$1',[id,data]);
      await c.query("INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,'Prepared quotation while awaiting Design',$4,$5,$6,$7)",[randomUUID(),id,r.version+1,{stage:r.stage,data,reason:'Coordinator BOQ/quotation preparation linked to this site; Design survey, completion and evidence unchanged.'},randomUUID(),fingerprint({draftId}),actor]);
      await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'project.sent-survey.quotation-prepared:'+id+':'+draftId]);
      return {recordId:id,draftId,repeated:false};
    });
  }
  async linkQuotationDraft(actor: string, id: string, raw: unknown) {
    const draftId = z.object({ draftId: z.uuid() }).strict().parse(raw).draftId;
    return transaction(this.pool, async (c) => {
      const { u, r } = await this.record(actor, id, c, true);
      this.requireRole(u, ["Coordinator"]);
      await this.requireReceivingDepartment(u, r, c);
      if (r.stage !== "design_handed_off" || r.route !== "survey-quote")
        throw new HttpError(
          409,
          "A quotation draft can be linked only to its reviewed survey.",
        );
      const draft = (
        await c.query(
          "SELECT * FROM survey_drafts WHERE id=$1 AND owner_id=$2 FOR SHARE",
          [draftId, actor],
        )
      ).rows[0];
      const review = (
        await c.query(
          "SELECT snapshot FROM project_workflow_documents WHERE record_id=$1 AND kind='Technical review' ORDER BY created_at DESC LIMIT 1",
          [id],
        )
      ).rows[0];
      const expectedFamily =
        review?.snapshot.boq?.survey?.family ?? r.data.surveyInputs?.family;
      if (
        !draft ||
        Number(draft.inputs.customerId) !== r.customer_id ||
        String(draft.inputs.siteCode).toLowerCase() !==
          String(r.site_code).toLowerCase() ||
        draft.inputs.family !== expectedFamily
      )
        throw new HttpError(
          422,
          "The quotation must use the linked customer, site and technically reviewed project type.",
        );
      if (r.data.draftId === draftId) return { linked: true };
      const data = {
        ...r.data,
        designDraftId: r.data.designDraftId ?? r.data.draftId,
        draftId,
        coordinationQuotationDraftId: draftId,
      };
      await c.query(
        "UPDATE project_workflow_records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",
        [id, data],
      );
      await c.query(
        "INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          id,
          r.version + 1,
          "link-new-quotation-draft",
          {
            stage: r.stage,
            reason:
              "New preliminary quotation BOQ linked; submitted Design BOQ retained.",
            data,
          },
          randomUUID(),
          fingerprint({ draftId }),
          actor,
        ],
      );
      return { linked: true };
    });
  }
  async quotationMasterDetails(actor: string, id: string, raw: unknown) {
    const text = z.string().trim().max(2000);
    const v = z
      .object({
        customerVersion: z.number().int().positive(),
        siteVersion: z.number().int().positive(),
        reviewConfirmed: z.literal(true),
        databaseConfirmed: z.literal(true),
        customer: z
          .object({
            name: text.min(1).max(200),
            short_code: text.min(1).max(30),
            contact_person: text,
            phone: text.max(100),
            email: z.union([z.literal(""), z.email().max(254)]),
            address: text,
          })
          .strict(),
        site: z
          .object({
            name: text.min(1).max(200),
            code: text.min(1).max(30),
            location: text,
            contact_person: text,
            contact_phone: text.max(100),
          })
          .strict(),
      })
      .strict()
      .parse(raw);
    return transaction(this.pool, async (c) => {
      const { u, r } = await this.record(actor, id, c, true);
      this.requireRole(u, ["Coordinator"]);
      await this.requireReceivingDepartment(u, r, c);
      if (r.stage !== "design_handed_off" || r.route === "survey-framework")
        throw new HttpError(
          409,
          "Customer details can be edited here only for a quotation being prepared from Design Outputs.",
        );
      const customer = (
          await c.query("SELECT * FROM customers WHERE id=$1 FOR UPDATE", [
            r.customer_id,
          ])
        ).rows[0],
        site = (
          await c.query(
            "SELECT * FROM sites WHERE id=$1 AND customer_id=$2 FOR UPDATE",
            [r.site_id, r.customer_id],
          )
        ).rows[0];
      if (
        !customer ||
        !site ||
        customer.version !== v.customerVersion ||
        site.version !== v.siteVersion
      )
        throw new HttpError(
          409,
          "Customer or site details changed. Reload and review the latest values.",
        );
      const customerChanged = Object.entries(v.customer).some(
          ([k, value]) => String(customer[k] ?? "") !== value,
        ),
        siteChanged = Object.entries(v.site).some(
          ([k, value]) => String(site[k] ?? "") !== value,
        );
      if (!customerChanged && !siteChanged) return { changed: false };
      if (customerChanged)
        await c.query(
          "UPDATE customers SET name=$2,short_code=$3,contact_person=$4,phone=$5,email=$6,address=$7,version=version+1 WHERE id=$1",
          [
            customer.id,
            v.customer.name,
            v.customer.short_code,
            v.customer.contact_person,
            v.customer.phone,
            v.customer.email,
            v.customer.address,
          ],
        );
      if (siteChanged)
        await c.query(
          "UPDATE sites SET name=$2,code=$3,location=$4,contact_person=$5,contact_phone=$6,version=version+1 WHERE id=$1",
          [
            site.id,
            v.site.name,
            v.site.code,
            v.site.location,
            v.site.contact_person,
            v.site.contact_phone,
          ],
        );
      const change = {
        before: { customer, site },
        after: { customer: v.customer, site: v.site },
        confirmedBy: actor,
        at: new Date().toISOString(),
      };
      const data = {
        ...r.data,
        siteAddress: v.site.location,
        siteContact: v.site.contact_person,
        sitePhone: v.site.contact_phone,
        quotationMasterChanges: [
          ...(r.data.quotationMasterChanges ?? []),
          change,
        ],
      };
      await c.query(
        "UPDATE project_workflow_records SET site_name=$2,site_code=$3,data=$4,version=version+1,updated_at=now() WHERE id=$1",
        [r.id, v.site.name, v.site.code, data],
      );
      await c.query(
        "INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          id,
          r.version + 1,
          "confirm-quotation-master-details",
          {
            stage: r.stage,
            reason:
              "Customer and site database edits confirmed twice during quotation preparation.",
            data,
          },
          randomUUID(),
          fingerprint(v),
          actor,
        ],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `project.workflow.quotation-master-details:${id}`,
      ]);
      return { changed: true };
    });
  }
  async surveySubmissionGroupFile(actor: string, id: string) {
    return submissionGroupFile(this, actor, id);
  }
  async removeFromSurveyGroup(actor: string, id: string, input: unknown) {
    return unbindSubmissionGroup(this, actor, id, input);
  }
  async ublSurveyPackageFile(actor: string, id: string, kind: string) {
    return packageFile(this, actor, id, kind);
  }
  async createSurveyDispatch(actor: string, raw: unknown) {
    return createDispatch(this.pool, actor, raw);
  }
  async closeSurveyDispatch(actor: string, id: string, raw: unknown) {
    return closeDispatch(this.pool, actor, id, raw);
  }
  async previewSurveyDispatch(actor: string, raw: unknown) {
    return previewDispatch(this.pool, actor, raw);
  }
  async approveSurveyDispatch(actor: string, id: string) {
    return approveDispatch(this.pool, actor, id);
  }
  async surveyDispatchPreview(actor: string, id: string) {
    return getDispatchPreview(this.pool, actor, id);
  }
  async surveyDispatch(actor: string, id: string) {
    return latestDispatch(this.pool, actor, id);
  }
  async addSurveyor(actor: string, raw: unknown) {
    const u = await this.user(actor);
    this.requireRole(u, ["Design"]);
    const input = z
      .object({
        name: z.string().trim().min(1).max(200),
        phone: z.string().trim().max(100).default(""),
      })
      .strict()
      .parse(raw);
    return transaction(this.pool, async (c) => {
      let row = (
        await c.query(
          "INSERT INTO survey_team_members(id,display_name,phone,created_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id,display_name,phone,'SUR-'||lpad(member_number::text,6,'0') AS member_code",
          [randomUUID(), input.name, input.phone, actor],
        )
      ).rows[0];
      if (!row)
        row = (
          await c.query(
            "SELECT id,display_name,phone,'SUR-'||lpad(member_number::text,6,'0') AS member_code FROM survey_team_members WHERE lower(display_name)=lower($1) AND phone=$2 AND active",
            [input.name, input.phone],
          )
        ).rows[0];
      if (!row)
        throw new HttpError(
          409,
          "This surveyor already exists but is inactive. Ask management to review the member record.",
        );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `survey-team.member.${row.id}.selected-or-added`,
      ]);
      return row;
    });
  }
  async create(actor: string, raw: unknown, client?:PoolClient) {
    const input = createSchema.parse(raw);
    const execute=async(c:PoolClient)=>{
      const u = await this.user(actor, c);
      this.requireRole(u, ["Coordinator"]);
      if(input.route==='direct-framework'&&input.frameworkId&&process.env.ENABLE_DEFERRED_UPS_WORKFLOW!=='true'){
        const framework=(await c.query("SELECT payload->>'type' AS type FROM project_framework_versions WHERE id=$1",[input.frameworkId])).rows[0];
        if(framework?.type==='bank-ups')throw new HttpError(403,'Direct UPS orders are deferred and are not enabled in this release.');
      }
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('project-workflow-create'))",
      );
      const prior = (
        await c.query(
          "SELECT * FROM project_workflow_records WHERE request_key=$1",
          [input.requestKey],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.created_by !== actor ||
          prior.data.creationFingerprint !== fingerprint(input)
        )
          throw new HttpError(
            409,
            "This request key belongs to a different request.",
          );
        return { id: prior.id, repeated: true };
      }
      const customer = (
        await c.query(
          "SELECT * FROM customers WHERE id=$1 AND status='Active'",
          [input.customerId],
        )
      ).rows[0];
      if (!customer) throw new HttpError(422, "Choose an active customer.");
      const selectedFramework = input.frameworkId ? (await c.query(
        "SELECT customer_id,configuration_key,payload->>'type' AS type FROM project_framework_versions WHERE id=$1", [input.frameworkId],
      )).rows[0] : undefined;
      const sharedUblConstruction = input.route === 'direct-framework' && input.siteCode === '0999' &&
        customer.short_code === 'UBL' && selectedFramework?.customer_id === customer.id &&
        selectedFramework?.type === 'bank-ups' && selectedFramework.configuration_key === 'UBL-UPS-6-10';
      const lookupSite=async()=>{
        const candidates=(await c.query(input.siteId
          ? 'SELECT * FROM sites WHERE customer_id=$1 AND id=$2 FOR UPDATE'
          : 'SELECT * FROM sites WHERE customer_id=$1 AND lower(code)=lower($2) FOR UPDATE',
          [input.customerId,input.siteId??input.siteCode])).rows;
        const matches=candidates.filter((v:any)=>directPoSiteMatches(v,input.customerId,input.siteCode,input.siteName,input.siteAddress??'',sharedUblConstruction));
        if(matches.length>1)throw new HttpError(409,'More than one site matches this branch name and delivery address. Review the site identity.');
        return matches[0];
      };
      let site=await lookupSite();
      let siteCreatedHere = false;
      if (input.siteId && site?.id !== input.siteId)
        throw new HttpError(
          422,
          "Selected site identity does not match its customer and code.",
        );
      if (
        (
          await c.query(
            "SELECT id FROM project_workflow_records WHERE customer_id=$1 AND ((NOT $4::boolean AND lower(site_code)=lower($2)) OR site_id=$3) AND stage NOT IN('issued','declined') AND data->>'localPreviewArchived' IS DISTINCT FROM 'true'",
            [input.customerId, input.siteCode, site?.id ?? null,sharedUblConstruction],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "This site already has active work. Open it to record a heads-up or PO.",
        );
      if (!site) {
        await c.query("LOCK TABLE sites IN SHARE ROW EXCLUSIVE MODE");
        site = await lookupSite();
        if (!site) {
          const next = (
            await c.query("SELECT COALESCE(max(id),0)+1 AS id FROM sites")
          ).rows[0].id;
          site = (
            await c.query(
              "INSERT INTO sites(id,customer_id,name,code,location,contact_person,contact_phone,region,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Active') RETURNING *",
              [
                next,
                input.customerId,
                input.siteName,
                input.siteCode,
                input.siteAddress,
                input.siteContact,
                input.sitePhone,
                input.region,
              ],
            )
          ).rows[0];
          siteCreatedHere = true;
        }
      }
      if (site.status !== "Active")
        throw new HttpError(409, "This site is inactive.");
      let siteChange: any;
      if (input.siteId) {
        const before = {
          name: site.name,
          code: site.code,
          location: site.location,
          contact_person: site.contact_person,
          contact_phone: site.contact_phone,
          region: site.region,
        };
        const after = {
          name: input.siteName,
          code: input.siteCode,
          location: input.siteAddress,
          contact_person: input.siteContact,
          contact_phone: input.sitePhone,
          region: input.region,
        };
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          if (!input.confirmSiteChange || input.siteVersion !== site.version)
            throw new HttpError(
              409,
              "Review the latest site details and confirm the changes before saving.",
            );
          if (
            (
              await c.query(
                "SELECT 1 FROM sites WHERE customer_id=$1 AND lower(code)=lower($2) AND id<>$3 AND NOT $4::boolean",
                [input.customerId, input.siteCode, site.id,sharedUblConstruction],
              )
            ).rowCount
          )
            throw new HttpError(
              409,
              "That site code already belongs to another site for this customer.",
            );
          siteChange = { before, after, confirmedBy: actor };
          site = (
            await c.query(
              "UPDATE sites SET name=$1,code=$2,location=$3,contact_person=$4,contact_phone=$5,region=$6,version=version+1 WHERE id=$7 RETURNING *",
              [
                after.name,
                after.code,
                after.location,
                after.contact_person,
                after.contact_phone,
                after.region,
                site.id,
              ],
            )
          ).rows[0];
          await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
            actor,
            `master.sites.${site.id}.updated-from-survey-request`,
          ]);
        }
      }
      const coordinator =
        management(u.role) && input.coordinatorId
          ? await this.person(c, input.coordinatorId, "Coordinator")
          : u.role === "Coordinator"
            ? actor
            : (
                await c.query(
                  "SELECT id FROM users WHERE active AND role='Coordinator' ORDER BY CASE WHEN display_name ILIKE '%atif%' THEN 0 ELSE 1 END,display_name LIMIT 1",
                )
              ).rows[0]?.id;
      if (!coordinator)
        throw new HttpError(422, "Create an active Coordinator account first.");
      const planner = input.planningOwnerId
        ? await this.person(c, input.planningOwnerId, "Design")
        : (
            await c.query(
              "SELECT id FROM users WHERE active AND role='Design' ORDER BY CASE WHEN display_name ILIKE '%sajid%' THEN 0 ELSE 1 END,display_name LIMIT 1",
            )
          ).rows[0]?.id;
      const r: any = {
        id: randomUUID(),
        customer_id: input.customerId,
        site_name: site.name,
        site_code: site.code,
        route: input.route,
      };
      let basis: any;
      if (
        input.route === "direct-framework" ||
        (input.route === "survey-framework" && input.frameworkId)
      ) {
        if (!input.frameworkId)
          throw new HttpError(
            422,
            "Select an approved pre-agreed configuration.",
          );
        basis = await frameworkBasis(this.pool, c, r, input.frameworkId);
      }
      let stage = input.headsup
        ? "advance_pending"
        : input.route === "direct-framework"
          ? "po_receipt"
          : input.route === "quick-quote"
            ? "design_handed_off"
            : "request_review";
      const data: any = {
        creationFingerprint: fingerprint(input),
        ...(sharedUblConstruction ? {sharedConstructionBranch:'UBL-UPS',branchCodeStatus:'Under construction — branch code not assigned'} : {}),
        notes: input.notes,
        siteAddress: site.location,
        siteContact: site.contact_person,
        sitePhone: site.contact_phone,
        siteChange,
        siteCreatedHere,
        customerAddedHere: input.customerAddedHere,
      };
      if (basis) data.basis = basis;
      if (input.route === "quick-quote") {
        const draftId = randomUUID();
        await c.query(
          "INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,$3)",
          [
            draftId,
            coordinator,
            {
              customerId: input.customerId,
              siteName: site.name,
              siteCode: site.code,
              location: site.location ?? "",
              sourceMode: "General quotation",
              brands: {},
              preparedBy: u.display_name,
              uploadIds: [],
              ocrText: "",
              ocrReviewed: false,
            },
          ],
        );
        data.draftId = draftId;
      }
      await c.query(
        "INSERT INTO project_workflow_records(id,customer_id,site_id,site_name,site_code,region,route,stage,coordinator_id,planning_owner_id,framework_id,data,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [
          r.id,
          input.customerId,
          site.id,
          site.name,
          site.code,
          input.region,
          input.route,
          stage,
          coordinator,
          stage === "request_review" ? null : (planner ?? null),
          input.frameworkId ?? null,
          data,
          input.requestKey,
          actor,
        ],
      );
      await c.query(
        "INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,1,'Created',$3,$4,$5,$6)",
        [
          randomUUID(),
          r.id,
          { stage, reason: input.notes, route: input.route },
          input.requestKey,
          fingerprint(input),
          actor,
        ],
      );
      return { id: r.id, repeated: false };
    };
    return client?execute(client):transaction(this.pool,execute);
  }

  async document(
    c: PoolClient,
    r: any,
    actor: string,
    kind: string,
    snapshot: any,
  ) {
    const version = (
      await c.query(
        "SELECT COALESCE(max(version),0)+1 AS version FROM project_workflow_documents WHERE record_id=$1 AND kind=$2",
        [r.id, kind],
      )
    ).rows[0].version;
    const id = randomUUID(),
      number = await allocateReference(
        c,
        kind === "Recommendation"
          ? "SSR"
          : kind === "Advance BOQ"
            ? "BOQ"
            : "TS",
        id,
        r.customer_id,
        r.site_code,
      );
    return (
      await c.query(
        "INSERT INTO project_workflow_documents(id,record_id,kind,version,number,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [id, r.id, kind, version, number, snapshot, actor],
      )
    ).rows[0];
  }
  async sendInformationalTechnicalReport(actor:string,id:string,raw:unknown){
    const input=z.object({version:z.number().int().positive()}).strict().parse(raw);
    return transaction(this.pool,async c=>{
      const {u,r}=await this.record(actor,id,c,true);this.requireRole(u,['Coordinator']);
      if(r.route!=='survey-quote'||r.stage!=='design_handed_off')throw new HttpError(422,'This action is available for technically reviewed survey quotations in Design Review.');
      await this.requireReceivingDepartment(u,r,c);
      if(r.version!==input.version)throw new HttpError(409,'This record changed. Reload before sending the report.');
      const existing=(await c.query('SELECT document_id FROM informational_technical_reports WHERE record_id=$1 AND source_review_id=$2',[id,r.data.reviewDocumentId??null])).rows[0];if(existing)return {...existing,repeated:true};
      const source=(await c.query("SELECT * FROM project_workflow_documents WHERE id=$1 AND record_id=$2 AND kind='Technical review'",[r.data.reviewDocumentId??null,id])).rows[0];
      if(!source?.snapshot.boq)throw new HttpError(422,'Save a complete technical review before sending this report.');
      const document=await this.document(c,r,actor,'Technical review information',{...source.snapshot,costing:safeCosting(source.snapshot.boq,'Admin',source.snapshot.markups),sourceReviewId:source.id,sourceReviewNumber:source.number,sourceReviewHash:fingerprint(source.snapshot),informational:true});
      const result=(await c.query('INSERT INTO informational_technical_reports(id,record_id,source_review_id,document_id,created_by) VALUES($1,$2,$3,$4,$5) RETURNING document_id,created_at',[randomUUID(),id,source.id,document.id,actor])).rows[0];
      await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`project.technical-information.sent:${JSON.stringify({recordId:id,reviewId:source.id,documentId:document.id,stageUnchanged:r.stage})}`]);
      return result;
    });
  }
  async action(actor: string, id: string, raw: unknown) {
    const v = actionSchema.parse(raw),
      input: any = v.input;
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019004)");
      const { u, r } = await this.record(actor, id, c, true);
      this.requireRole(u, ["Design", "Coordinator"]);
      const repeated = (
        await c.query(
          "SELECT * FROM project_workflow_events WHERE request_key=$1",
          [v.requestKey],
        )
      ).rows[0];
      if (repeated) {
        if (
          repeated.record_id !== id ||
          repeated.created_by !== actor ||
          repeated.input_fingerprint !== fingerprint(v)
        )
          throw new HttpError(
            409,
            "Request key already used for different work.",
          );
        return { id, version: r.version, repeated: true };
      }
      await this.requireReceivingDepartment(u, r, c);
      if (r.version !== v.version)
        throw new HttpError(
          409,
          "This record changed. Reload before continuing.",
        );
      if (
        (
          await c.query(
            "SELECT 1 FROM survey_submission_group_members m JOIN survey_submission_groups g ON g.id=m.group_id WHERE m.record_id=$1 AND g.status='Open'",
            [id],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "This survey is locked in a submission group. Remove it from the group before changing it.",
        );
      const data = { ...r.data };
      let stage = r.stage,
        reason = String(input.notes ?? "").trim();
      const requireStage = (allowed: string[]) => {
        if (!allowed.includes(stage))
          throw new HttpError(
            409,
            "Complete the preceding workflow step first.",
          );
      };
      if (
        data.noFeasibleSolution &&
        [
          "link-quote",
          "dispatch",
          "receipt",
          "resolve",
          "decision",
          "advance",
        ].includes(v.action)
      )
        throw new HttpError(
          422,
          "This survey needs review because no feasible solution was found. Return it to Design for a revised solution before commercial processing.",
        );
      if(v.action==='save-direct-po-details'){
        this.requireRole(u,['Coordinator']);requireStage(['po_receipt']);requireDirectUps(r);
        const fields=z.object(Object.fromEntries(directPoFields.map(([key])=>[key,key==='poNumber'?z.string().trim().max(100).default(''):z.string().trim().max(key==='siteAddress'||key==='billingAddress'?1000:200)]))).strict();
        const saved=z.object({evidenceId:z.uuid(),evidenceType:z.enum(['Customer PO','Email approval','WhatsApp approval']),extracted:fields,sourceText:z.string().max(150000).default('').transform(value=>value.replace(/\u0000/g,'').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'\uFFFD')),values:fields,notes:z.string().max(2000)}).strict().parse(input);
        await this.requireFile(c,r,saved.evidenceId,'PO / confirmation');
        if(saved.evidenceType==='Email approval'&&!/^MBL-UPS-/.test(data.basis?.source?.key??''))throw new HttpError(422,'Email approval is available for Meezan Direct PO agreements only.');
        if(saved.values.siteCode!==r.site_code)throw new HttpError(422,'The edited branch code must match this order site. Open a Direct PO for the correct branch.');
        if(!saved.values.siteName)throw new HttpError(422,'Enter the site name.');
        z.iso.date().parse(saved.values.approvalDate);
        if(saved.values.orderNumber&&!validOrderPosition(saved.values.orderNumber))throw new HttpError(422,'Enter the unit number and total, for example 20/60.');
        if(saved.values.ipoNumber&&!await manualIpoAvailable(c,saved.values.ipoNumber,r.id,saved.values.orderNumber))throw new HttpError(409,ipoNumberConflict);
        const capacityIssues=directPoCapacityIssues(saved.sourceText,data.basis?.source?.key??'');if(capacityIssues.length)throw new HttpError(422,capacityIssues.join(' '));
        const previous=data.directPoDetails;
        const changes=directPoChanges(previous?.values??saved.extracted,saved.values);
        data.directPoDetails={...saved,savedAt:new Date().toISOString(),savedBy:actor,history:[...(previous?.history??[]),{actor,actorName:u.display_name,at:new Date().toISOString(),evidenceId:saved.evidenceId,extracted:saved.extracted,changes}]};
        reason='Direct PO evidence details saved'+(changes.length?': '+changes.map(x=>x.label).join(', '):' without corrections');
      } else if (v.action === "review-survey-handoff") {
        this.requireRole(u, ["Coordinator"]);
        requireStage(["approved_dispatch"]);
        const customer = (
          await c.query("SELECT short_code FROM customers WHERE id=$1", [
            r.customer_id,
          ])
        ).rows[0];
        if (
          r.route !== "survey-framework" ||
          customer?.short_code?.toUpperCase() !== "UBL" ||
          !data.designHandoffAt
        )
          throw new HttpError(
            422,
            "This action applies to a handed-over UBL survey.",
          );
        if (data.dispatchedAt)
          throw new HttpError(
            409,
            "A sent recommendation requires a controlled revision, not a review reset.",
          );
        data.coordinationSurveyReviewPending = true;
        stage = "design_handed_off";
        reason = note(input.notes);
      } else if (v.action === "no-feasible-solution") {
        this.requireRole(u, ["Design"]);
        requireStage([
          "report_received",
          "technical_review",
          "technical_revision",
        ]);
        const remarks = note(input.notes);
        const files = (
          await c.query(
            "SELECT id,kind,filename,mime FROM project_workflow_files WHERE record_id=$1 AND NOT id::text IN (SELECT jsonb_array_elements_text(COALESCE(data->'removedRequestFileIds','[]'::jsonb)) FROM project_workflow_records WHERE id=$1) ORDER BY created_at",
            [id],
          )
        ).rows;
        const doc = await this.document(
          c,
          r,
          actor,
          "Technical review — Needs Review",
          {
            outcome: "No Feasible Solution",
            status: "Needs Review",
            remarks,
            customerId: r.customer_id,
            customer: r.customer,
            siteId: r.site_id,
            siteName: r.site_name,
            siteCode: r.site_code,
            siteAddress: data.siteAddress,
            enteredSurvey: data.surveyInputs ?? null,
            customerSurveyForms: data.customerSurveyForms ?? {},
            attachments: files,
            reviewedBy: u.display_name,
          },
        );
        data.noFeasibleSolution = {
          status: "Needs Review",
          remarks,
          documentId: doc.id,
          reviewedBy: actor,
          reviewedAt: new Date().toISOString(),
        };
        data.reviewDocumentId = null;
        data.technicalVerifiedAt = null;
        data.designHandoffAt = new Date().toISOString();
        r.technical_owner_id = actor;
        stage = "design_handed_off";
        reason =
          "No feasible solution — submitted to Coordination as Needs Review. " +
          remarks;
      } else if (v.action === "edit-request") {
        this.requireRole(u, ["Coordinator"]);
        requireStage(["request_review"]);
        const edit = createSchema.parse({ ...input, requestKey: v.requestKey });
        if (!edit.route.startsWith("survey"))
          throw new HttpError(422, "Choose a survey route for this request.");
        const customer = (
          await c.query(
            "SELECT * FROM customers WHERE id=$1 AND status='Active'",
            [edit.customerId],
          )
        ).rows[0];
        if (!customer) throw new HttpError(422, "Select an active customer.");
        await c.query("LOCK TABLE sites IN SHARE ROW EXCLUSIVE MODE");
        let site = (
          await c.query(
            edit.siteId
              ? "SELECT * FROM sites WHERE id=$1 AND customer_id=$2"
              : "SELECT * FROM sites WHERE lower(code)=lower($1) AND customer_id=$2",
            [edit.siteId ?? edit.siteCode, edit.customerId],
          )
        ).rows[0];
        if (edit.siteId && !site)
          throw new HttpError(422, "Select a site belonging to this customer.");
        if (
          (
            await c.query(
              "SELECT 1 FROM project_workflow_records WHERE id<>$1 AND customer_id=$2 AND (lower(site_code)=lower($3) OR site_id=$4) AND stage NOT IN('issued','declined')",
              [r.id, edit.customerId, edit.siteCode, site?.id ?? null],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "This site already has active work. Open the existing request.",
          );
        let created = false;
        if (!site) {
          const next = (
            await c.query("SELECT COALESCE(max(id),0)+1 AS id FROM sites")
          ).rows[0].id;
          site = (
            await c.query(
              "INSERT INTO sites(id,customer_id,name,code,location,contact_person,contact_phone,region,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Active') RETURNING *",
              [
                next,
                edit.customerId,
                edit.siteName,
                edit.siteCode,
                edit.siteAddress,
                edit.siteContact,
                edit.sitePhone,
                edit.region,
              ],
            )
          ).rows[0];
          created = true;
        } else {
          const changed = [
            site.name,
            site.code,
            site.location,
            site.contact_person,
            site.contact_phone,
            site.region,
          ].some(
            (value, i) =>
              value !==
              [
                edit.siteName,
                edit.siteCode,
                edit.siteAddress,
                edit.siteContact,
                edit.sitePhone,
                edit.region,
              ][i],
          );
          if (changed) {
            if (!edit.confirmSiteChange || edit.siteVersion !== site.version)
              throw new HttpError(
                409,
                "Review and confirm the latest site details before saving.",
              );
            if (
              (
                await c.query(
                  "SELECT 1 FROM sites WHERE customer_id=$1 AND lower(code)=lower($2) AND id<>$3",
                  [edit.customerId, edit.siteCode, site.id],
                )
              ).rowCount
            )
              throw new HttpError(
                409,
                "This site code belongs to another site.",
              );
            data.siteChange = { before: site, confirmedBy: actor };
            site = (
              await c.query(
                "UPDATE sites SET name=$1,code=$2,location=$3,contact_person=$4,contact_phone=$5,region=$6,version=version+1 WHERE id=$7 RETURNING *",
                [
                  edit.siteName,
                  edit.siteCode,
                  edit.siteAddress,
                  edit.siteContact,
                  edit.sitePhone,
                  edit.region,
                  site.id,
                ],
              )
            ).rows[0];
            data.siteChange.after = site;
          }
        }
        if (site.status !== "Active")
          throw new HttpError(422, "Select an active site.");
        data.previousRequest = {
          customerId: r.customer_id,
          siteId: r.site_id,
          siteName: r.site_name,
          siteCode: r.site_code,
          route: r.route,
          notes: data.notes,
        };
        data.customerAddedHere =
          edit.customerAddedHere ||
          (edit.customerId === r.customer_id && data.customerAddedHere);
        data.siteCreatedHere =
          created || (site.id === r.site_id && data.siteCreatedHere);
        data.notes = edit.notes;
        data.siteAddress = site.location;
        data.siteContact = site.contact_person;
        data.sitePhone = site.contact_phone;
        r.planning_owner_id = null;
        await c.query(
          "UPDATE project_workflow_records SET customer_id=$2,site_id=$3,site_name=$4,site_code=$5,region=$6,route=$7 WHERE id=$1",
          [
            r.id,
            edit.customerId,
            site.id,
            site.name,
            site.code,
            site.region,
            edit.route,
          ],
        );
        reason =
          "Survey request adjusted by Coordination before sending to Design.";
      } else if (v.action === "send-design") {
        this.requireRole(u, ["Coordinator"]);
        requireStage(["request_review", "survey_requested"]);
        if (data.sentToDesignAt)
          throw new HttpError(
            409,
            "This request has already been sent to Design.",
          );
        if (input.customerVerified !== true || input.siteVerified !== true)
          throw new HttpError(
            422,
            "Verify both the customer and site details before sending.",
          );
        const customer = (
          await c.query("SELECT * FROM customers WHERE id=$1 FOR SHARE", [
            r.customer_id,
          ])
        ).rows[0];
        const site = (
          await c.query("SELECT * FROM sites WHERE id=$1 FOR SHARE", [
            r.site_id,
          ])
        ).rows[0];
        if (
          customer.version !== input.customerVersion ||
          site.version !== input.siteVersion
        )
          throw new HttpError(
            409,
            "The master details changed. Reload and verify the latest customer and site details.",
          );
        const requestFile = (
          await c.query(
            "SELECT id FROM project_workflow_files WHERE record_id=$1 AND kind='Request evidence' AND NOT id::text IN (SELECT jsonb_array_elements_text(COALESCE(data->'removedRequestFileIds','[]'::jsonb)) FROM project_workflow_records WHERE id=$1) ORDER BY created_at DESC,id DESC LIMIT 1",
            [r.id],
          )
        ).rows[0];
        if (!requestFile)
          throw new HttpError(
            422,
            "Attach the request evidence before sending to Design.",
          );
        const planner = (
          await c.query(
            "SELECT id FROM users WHERE active AND role='Design' ORDER BY CASE WHEN display_name ILIKE '%sajid%' THEN 0 ELSE 1 END,display_name LIMIT 1",
          )
        ).rows[0];
        if (!planner)
          throw new HttpError(
            422,
            "Create an active Design planning account before sending.",
          );
        r.planning_owner_id = planner.id;
        data.verifiedMaster = { customer, site, verifiedBy: actor };
        data.siteAddress = site.location;
        data.siteContact = site.contact_person;
        data.sitePhone = site.contact_phone;
        data.sentToDesignAt = (await c.query("SELECT now() AS at")).rows[0].at;
        data.requestEvidenceId = requestFile.id;
        data.requestDocumentId = (
          await this.document(c, r, actor, "Survey request", {
            customer,
            site,
            route: r.route,
            notes: data.notes,
            sentToDesignAt: data.sentToDesignAt,
            evidenceId: requestFile.id,
          })
        ).id;
        stage = "survey_requested";
        reason =
          "Customer and site master details verified by Coordination; survey request sent to Design.";
      } else if (v.action === "request-return") {
        this.requireRole(u, ["Design"]);
        requireStage([
          "survey_requested",
          "survey_scheduled",
          "report_received",
        ]);
        reason = note(input.notes);
        data.returnReason = reason;
        data.returnSourceVersion = r.version;
        data.revisionCategory = z
          .enum([
            "Technical error",
            "Internal correction",
            "Customer scope change",
          ])
          .parse(input.category);
        stage = "commercial_revision";
      } else if (v.action === "assign") {
        this.requireRole(u, ["Design"]);
        requireStage([
          "survey_requested",
          "survey_scheduled",
          "report_received",
          "technical_review",
          "technical_revision",
        ]);
        if (
          r.planning_owner_id !== actor &&
          !management(u.role) &&
          u.role !== "Design"
        )
          throw new HttpError(
            403,
            "The assigned survey planner schedules and assigns the team.",
          );
        if (data.surveyDispatchId)
          throw new HttpError(
            409,
            "This survey already belongs to an approved dispatch. Correct its dispatch before changing its schedule.",
          );
        if (data.surveyInProgress)
          throw new HttpError(
            409,
            "Survey work has started. Scheduling cannot be changed here.",
          );
        const date = z.iso.date().parse(input.date);
        const team = z.array(z.uuid()).min(1).max(20).parse(input.team);
        for (const p of team) {
          if (
            !(
              await c.query(
                "SELECT id FROM users WHERE id=$1 AND active AND role='Design' UNION ALL SELECT id FROM survey_team_members WHERE id=$1 AND active",
                [p],
              )
            ).rowCount
          )
            throw new HttpError(422, "Select an active surveyor.");
        }
        if (input.technicalOwnerId) {
          r.technical_owner_id = await this.person(
            c,
            uuid(input.technicalOwnerId),
            "Design",
          );
        }
        data.scheduledSurveyDate = date;
        data.surveyTeam = team;
        if (stage === "survey_requested") stage = "survey_scheduled";
        reason = note(input.notes);
      } else if (v.action === "save-site-picture-link") {
        this.requireRole(u, ["Design"]);
        requireStage(["survey_scheduled", "report_received", "technical_review", "technical_revision"]);
        const {sitePictureFolder} = await import('./site-picture-link.js');
        const url = sitePictureFolder(input.url);
        data.sitePictureFolder = {url, savedBy: actor, savedAt: new Date().toISOString()};
        reason = "Site pictures and videos linked to their Google Drive folder; media remains in Drive.";
      } else if (v.action === "start-survey") {
        this.requireRole(u, ["Design"]);
        requireStage(["survey_scheduled"]);
        data.surveyInProgress = true;
        reason = note(input.notes);
      } else if (
        v.action === "save-survey-inputs" ||
        v.action === "save-survey-completion" ||
        v.action === "review-survey-inputs"
      ) {
        this.requireRole(u, ["Design"]);
        const reviewing = v.action === "review-survey-inputs";
        requireStage(
          reviewing
            ? ["report_received", "technical_review", "technical_revision"]
            : ["survey_scheduled"],
        );
        if (!data.surveyDispatchId)
          throw new HttpError(
            422,
            "Approve the survey dispatch before preparing the completion report.",
          );
        const surveyCustomer = (
          await c.query("SELECT short_code FROM customers WHERE id=$1", [
            r.customer_id,
          ])
        ).rows[0];
        const combinedUbl =
          r.route === "survey-framework" &&
          surveyCustomer?.short_code?.toUpperCase() === "UBL";
        if (combinedUbl && v.action === "save-survey-inputs")
          throw new HttpError(
            422,
            "Complete the Standard BOQ and UBL details, then save both together.",
          );
        if (!combinedUbl && v.action === "save-survey-completion")
          throw new HttpError(
            422,
            "Combined UBL survey save is only available on the UBL pre-agreed survey route.",
          );
        const edit = z
          .object({
            customerName: z.string().trim().min(1).max(200),
            siteName: z.string().trim().min(1).max(200),
            address: z.string().trim().max(1000),
          })
          .strict()
          .parse(input.masterDetails);
        const customer = (
          await c.query("SELECT * FROM customers WHERE id=$1 FOR UPDATE", [
            r.customer_id,
          ])
        ).rows[0];
        const site = (
          await c.query(
            "SELECT * FROM sites WHERE id=$1 AND customer_id=$2 FOR UPDATE",
            [r.site_id, r.customer_id],
          )
        ).rows[0];
        if (
          !customer ||
          !site ||
          customer.status !== "Active" ||
          site.status !== "Active"
        )
          throw new HttpError(422, "The customer and site must remain active.");
        const customerChanged = customer.name !== edit.customerName;
        const siteChanged =
          site.name !== edit.siteName || site.location !== edit.address;
        if (customerChanged || siteChanged) {
          if (input.confirmMasterChange !== true)
            throw new HttpError(
              422,
              "Confirm the customer/site database changes before saving.",
            );
          if (
            (customerChanged && input.customerVersion !== customer.version) ||
            (siteChanged && input.siteVersion !== site.version)
          )
            throw new HttpError(
              409,
              "Master details changed while this form was open. Reload and confirm the latest values.",
            );
          const before = {
            customer: {
              id: customer.id,
              name: customer.name,
              version: customer.version,
            },
            site: {
              id: site.id,
              name: site.name,
              address: site.location,
              version: site.version,
            },
          };
          if (customerChanged)
            await c.query(
              "UPDATE customers SET name=$2,version=version+1 WHERE id=$1",
              [customer.id, edit.customerName],
            );
          if (siteChanged)
            await c.query(
              "UPDATE sites SET name=$2,location=$3,version=version+1 WHERE id=$1",
              [site.id, edit.siteName, edit.address],
            );
          data.surveyMasterChanges = [
            ...(data.surveyMasterChanges ?? []),
            {
              before,
              after: {
                customer: {
                  id: customer.id,
                  name: edit.customerName,
                  version: customer.version + (customerChanged ? 1 : 0),
                },
                site: {
                  id: site.id,
                  name: edit.siteName,
                  address: edit.address,
                  version: site.version + (siteChanged ? 1 : 0),
                },
              },
              confirmedBy: actor,
              at: new Date().toISOString(),
            },
          ];
          await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
            actor,
            `project.workflow.confirmed-master-update:${id}:customer-${customer.id}:site-${site.id}`,
          ]);
        }
        await c.query(
          "UPDATE project_workflow_records SET site_name=$2 WHERE id=$1",
          [r.id, edit.siteName],
        );
        r.site_name = edit.siteName;
        data.siteAddress = edit.address;
        const schema = surveySchema.omit({
          uploadIds: true,
          ocrText: true,
          ocrReviewed: true,
        });
        const previousInputs = data.surveyInputs;
        data.surveyInputs = schema.parse({
          ...input.survey,
          brands: Object.fromEntries(
            ["solar", "inverter", "battery", "cable", "switchgear"].map(
              (key) => [key, data.surveyInputs?.brands?.[key] ?? 0],
            ),
          ),
          customerId: r.customer_id,
          siteName: edit.siteName,
          siteCode: r.site_code,
          location: edit.address,
          preparedBy: u.display_name,
          sourceMode: "Survey",
        });
        data.surveyInputsSavedAt = new Date().toISOString();
        data.surveyInputsSavedBy = actor;
        if (reviewing) {
          data.surveyInputChanges = [
            ...(data.surveyInputChanges ?? []),
            {
              before: previousInputs,
              after: data.surveyInputs,
              reviewedBy: actor,
              at: data.surveyInputsSavedAt,
            },
          ];
          data.reviewDocumentId = null;
          data.technicalVerifiedAt = null;
        }
        if (combinedUbl && !reviewing) {
          const saved = await saveCustomerSurveyForm(
            c,
            { ...r, data },
            actor,
            input.customerForm,
          );
          data.customerSurveyForms = {
            ...(data.customerSurveyForms ?? {}),
            [saved.templateKey]: saved,
          };
          if (data.customerSurveyDrafts)
            delete data.customerSurveyDrafts[saved.templateKey];
          if (input.date)
            data.actualSurveyDate = z.iso.date().parse(input.date);
          if (input.notes)
            data.submissionRemarks = z
              .string()
              .trim()
              .max(4000)
              .parse(input.notes);
          if (input.completeSubmission === true) {
            const date = z.iso.date().parse(input.date);
            const submissionNote = note(input.notes);
            const files = (
              await c.query(
                "SELECT kind FROM project_workflow_files WHERE record_id=$1 AND kind IN('Survey report','Survey photo') UNION SELECT kind FROM ubl_workflow_attachments WHERE request_id=$2 AND kind IN('Survey report','Survey photo')",
                [id, r.legacy_type === "ubl" ? r.legacy_id : null],
              )
            ).rows;
            if (!files.some((file: any) => file.kind === "Survey report"))
              throw new HttpError(
                422,
                "Attach the completed survey report before completing submission.",
              );
            if (!files.some((file: any) => file.kind === "Survey photo") && !data.sitePictureFolder?.url)
              throw new HttpError(
                422,
                "Save the site pictures folder link before completing submission.",
              );
            data.actualSurveyDate = date;
            data.submissionRemarks = submissionNote;
            data.reportSubmittedAt = new Date().toISOString();
            data.surveyInProgress = false;
            stage = "report_received";
          }
        }
        reason = reviewing
          ? "Survey BOQ inputs corrected during technical review; previous review retained in history and must be verified again."
          : input.completeSubmission === true
            ? "Complete survey and BOQ saved and submitted for technical review."
            : "Standard BOQ survey inputs saved for technical review; no commercial approval or costing change.";
      } else if (v.action === "import-survey-reading") {
        this.requireRole(u, ["Design"]);
        requireStage(["survey_scheduled"]);
        const reading = z
          .object({
            method: z.string().min(1).max(200),
            sourceFileIds: z.array(z.uuid()).min(1).max(10),
            standardInputs: z.record(z.string(), z.unknown()),
            customerFormValues: z.record(z.string(), z.unknown()),
            flags: z.array(z.string().max(2000)).max(50),
          })
          .strict()
          .parse(input);
        for (const file of reading.sourceFileIds)
          await this.requireFile(c, r, file, "Survey report");
        const blankQuantity = z.union([
          z.string().regex(/^\d{1,8}(\.\d{1,4})?$/),
          z.literal(""),
        ]);
        const partial = surveyDraftSchema.extend(
          Object.fromEntries(
            [
              "dcMetres",
              "acInverter16",
              "acInverter25",
              "acPanel16",
              "acPanel25",
              "earth25",
              "earth6",
              "earth10",
              "spInverterTerminationMetres",
              "spLoadPanelRunMetres",
            ].map((key) => [key, blankQuantity.optional()]),
          ),
        );
        data.surveyReading = {
          ...reading,
          standardInputs: partial.parse(reading.standardInputs),
          readAt: new Date().toISOString(),
          readBy: actor,
          reviewed: false,
        };
        reason =
          "Attached survey reports read into an unapproved review draft; no master, costing or approval changes.";
      } else if (v.action === "save-customer-survey-draft") {
        this.requireRole(u, ["Design"]);
        requireStage(["survey_scheduled"]);
        const saved = await saveCustomerSurveyForm(c, r, actor, input, true);
        data.customerSurveyDrafts = {
          ...(data.customerSurveyDrafts ?? {}),
          [saved.templateKey]: saved,
        };
        reason =
          "Customer survey draft prepared for review; not accepted or submitted.";
      } else if (v.action === "save-customer-survey") {
        this.requireRole(u, ["Design"]);
        requireStage(["survey_scheduled"]);
        if (!data.surveyDispatchId)
          throw new HttpError(
            422,
            "Approve the survey dispatch before preparing the completion report.",
          );
        const saved = await saveCustomerSurveyForm(c, r, actor, input);
        data.customerSurveyForms = {
          ...(data.customerSurveyForms ?? {}),
          [saved.templateKey]: saved,
        };
        reason =
          "Customer survey details saved for Solution Engineer review; connected load remains manually reported.";
      } else if (v.action === "report") {
        this.requireRole(u, ["Design"]);
        requireStage(["survey_scheduled", "technical_revision"]);
        if (
          !(
            await c.query(
              "SELECT 1 FROM project_workflow_files WHERE record_id=$1 AND kind='Survey report' UNION SELECT 1 FROM ubl_workflow_attachments WHERE request_id=$2 AND kind='Survey report'",
              [id, r.legacy_type === "ubl" ? r.legacy_id : null],
            )
          ).rowCount
        )
          throw new HttpError(
            422,
            "Attach the completed survey report before submitting it.",
          );
        if (
          !(
            await c.query(
              "SELECT 1 FROM project_workflow_files WHERE record_id=$1 AND kind='Survey photo' UNION SELECT 1 FROM ubl_workflow_attachments WHERE request_id=$2 AND kind='Survey photo'",
              [id, r.legacy_type === "ubl" ? r.legacy_id : null],
            )
          ).rowCount && !data.sitePictureFolder?.url
        )
          throw new HttpError(
            422,
            "Save the site pictures folder link before submitting the survey report.",
          );
        const reportCustomer = (
          await c.query("SELECT short_code FROM customers WHERE id=$1", [
            r.customer_id,
          ])
        ).rows[0];
        if (
          r.route === "survey-framework" &&
          reportCustomer?.short_code?.toUpperCase() === "UBL" &&
          !data.surveyInputsSavedAt
        )
          throw new HttpError(
            422,
            "Save the manually entered standard BOQ before submitting the UBL survey for technical review.",
          );
        if (
          r.route === "survey-framework" &&
          reportCustomer?.short_code?.toUpperCase() === "UBL"
        ) {
          const template = (await customerSurveyTemplates(c)).find(
            (t: any) => t.key === "ubl-solar-survey",
          );
          const form = data.customerSurveyForms?.["ubl-solar-survey"];
          if (
            !template ||
            !form ||
            form.templateVersion !== template.version ||
            template.payload.fields.some(
              (field: any) =>
                !field.shared &&
                String(form.values[field.key] ?? "").trim() === "",
            )
          )
            throw new HttpError(
              422,
              "Complete and save the current UBL survey form before submitting for technical review.",
            );
        }
        data.actualSurveyDate = z.iso.date().parse(input.date);
        data.reportSubmittedAt = new Date().toISOString();
        data.surveyInProgress = false;
        stage = "report_received";
        reason = note(input.notes);
      } else if (v.action === "begin-review") {
        this.requireRole(u, ["Design"]);
        requireStage(["report_received", "technical_revision"]);
        if (input.technicalOwnerId) {
          if (
            r.planning_owner_id !== actor &&
            !management(u.role) &&
            u.role !== "Design"
          )
            throw new HttpError(
              403,
              "The survey planner assigns the Solution Engineer.",
            );
          r.technical_owner_id = await this.person(
            c,
            uuid(input.technicalOwnerId),
            "Design",
          );
        }
        if (!r.technical_owner_id)
          throw new HttpError(
            422,
            "Assign the technical review to an active Design account.",
          );
        stage = "technical_review";
        reason = note(input.notes);
      } else if (
        ["review", "handoff", "submit-technical-review"].includes(v.action)
      ) {
        if (v.action !== "handoff") {
          data.noFeasibleSolution = null;
          this.requireRole(u, ["Design"]);
          requireStage(
            v.action === "submit-technical-review"
              ? ["report_received", "technical_review", "technical_revision"]
              : ["technical_review", "technical_revision"],
          );
          if (v.action === "submit-technical-review")
            r.technical_owner_id = actor;
          if (
            r.technical_owner_id !== actor &&
            !management(u.role) &&
            u.role !== "Design"
          )
            throw new HttpError(
              403,
              "The assigned Solution Engineer verifies this design.",
            );
          const reviewed = designReviewSchema
            .extend({ survey: designReviewSchema.shape.survey.optional() })
            .parse(input);
          let boq: any;
          if (r.route.endsWith("framework")) {
            const basis = await frameworkBasis(
              this.pool,
              c,
              r,
              uuid(input.frameworkId ?? r.framework_id),
            );
            boq = basis.boq;
            data.basis = basis;
            r.framework_id = basis.source.id;
            for (const line of boq.lines) {
              const itemId = reviewed.itemSelections[line.key];
              if (itemId && itemId !== line.itemId)
                throw new HttpError(
                  422,
                  "A framework recommendation must retain the approved configuration Item IDs. Create an approved framework revision for a scope change.",
                );
            }
          } else {
            if (!reviewed.survey)
              throw new HttpError(422, "Enter the technical survey inputs.");
            const calculated = await designCalculation(
              c,
              r,
              reviewed,
              u.display_name,
            );
            boq = calculated.boq;
          }
          const hidden = boq.lines
            .filter(
              (l: any) => l.phase === "BESS" || /^(CH-CNI-|CH-C&I)/.test(l.key),
            )
            .map((l: any) => l.key);
          if (
            !u.restricted_cost_access &&
            Object.keys(reviewed.markups).some((k) => hidden.includes(k))
          )
            throw new HttpError(
              403,
              "Restricted equipment markup is reserved for Management.",
            );
          const surveyComparison = r.route === "survey-framework" && data.basis
            ? await ublSurveyComparison(c, { ...r, data }, data.basis) : null;
          data.ublStandardsReview = surveyComparison?.standardsReview ?? null;
          if (data.ublStandardsReview?.needsReview && !reviewed.notes.includes(data.ublStandardsReview.message))
            reviewed.notes = `${reviewed.notes}\n${data.ublStandardsReview.message}`.trim();
          const doc = await this.document(c, r, actor, "Technical review", {
            boq,
            notes: reviewed.notes,
            markups: reviewed.markups,
            itemSelections: reviewed.itemSelections,
            profileKey: reviewed.profileKey,
            profileVersion: reviewed.profileVersion,
            enteredSurvey: data.surveyInputs ?? null,
            surveyComparison,
            originalReportDate: data.actualSurveyDate ?? null,
            originalEvidencePreserved: true,
          });
          data.location =
            reviewed.survey?.location ?? data.location ?? r.region;
          data.reviewDocumentId = doc.id;
          data.technicalVerifiedAt = new Date().toISOString();
          reason = reviewed.notes;
          stage = "technical_review";
        }
        if (v.action !== "review") {
          this.requireRole(u, ["Design"]);
          requireStage(["technical_review"]);
          if (
            r.technical_owner_id !== actor &&
            !management(u.role) &&
            u.role !== "Design"
          )
            throw new HttpError(
              403,
              "The assigned Solution Engineer sends the verified design.",
            );
          if (!data.reviewDocumentId)
            throw new HttpError(
              422,
              "Save the verified technical review first.",
            );
          const review = (
            await c.query(
              "SELECT snapshot FROM project_workflow_documents WHERE id=$1 AND record_id=$2",
              [data.reviewDocumentId, id],
            )
          ).rows[0];
          if (!review)
            throw new HttpError(422, "Technical review is unavailable.");
          if (r.route === "survey-quote") {
            const draftId = randomUUID();
            let base: string | null = null;
            const priorDesignDraftId=data.sentQuotationDraftId?data.designDraftId:data.draftId;
            if (priorDesignDraftId) {
              base =
                (
                  await c.query(
                    "SELECT revision_id FROM boq_draft_finalizations WHERE draft_id=$1",
                    [priorDesignDraftId],
                  )
                ).rows[0]?.revision_id ?? null;
              data.previousDraftIds = [
                ...(data.previousDraftIds ?? []),
                priorDesignDraftId,
              ];
            }
            await c.query(
              "INSERT INTO survey_drafts(id,owner_id,inputs,base_revision_id,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,$6)",
              [
                draftId,
                r.coordinator_id,
                {
                  ...review.snapshot.boq.survey,
                  preparedBy: r.coordinator,
                  uploadIds: [],
                  ocrText: "",
                  ocrReviewed: false,
                },
                base,
                base ? data.returnReason || "Design technical revision" : "",
                base ? "Internal management" : null,
              ],
            );
            const draftRow = (
              await c.query("SELECT * FROM survey_drafts WHERE id=$1", [
                draftId,
              ])
            ).rows[0];
            const frozen = structuredClone(review.snapshot.boq);
            frozen.survey.preparedBy = r.coordinator;
            const finalized = await new BoqRepository(this.pool).finalize(
              c,
              r.coordinator_id,
              draftRow,
              frozen,
              false,
            );
            if(data.sentQuotationDraftId){data.designDraftId=draftId;data.designLinkedBoqRevisionId=finalized.id;}
            else {data.draftId = draftId;data.linkedBoqRevisionId = finalized.id;}
          } else {
            const doc = await this.document(c, r, actor, "Recommendation", {
              configuration: data.basis?.source ?? r.data.basis?.source,
              customer: r.customer,
              site: r.site_name,
              siteCode: r.site_code,
              boq: review.snapshot.boq,
              technicalNotes: review.snapshot.notes,
              agreedSellingInclusiveGst: data.basis?.order?.total ?? null,
              verified: true,
              verifiedBy: u.display_name,
              reviewDocumentId: data.reviewDocumentId,
            });
            data.recommendationId = doc.id;
          }
          data.designHandoffAt = new Date().toISOString();
          data.returnReason = null;
          const handoffCustomer = (
            await c.query("SELECT short_code FROM customers WHERE id=$1", [
              r.customer_id,
            ])
          ).rows[0];
          const ublSurvey =
            r.route === "survey-framework" &&
            handoffCustomer?.short_code?.toUpperCase() === "UBL";
          if (ublSurvey) data.coordinationSurveyReviewPending = true;
          stage =
            r.route === "survey-framework" && !ublSurvey
              ? "approved_dispatch"
              : "design_handed_off";
          reason = v.action === "submit-technical-review"
            ? review.snapshot.notes.trim() || "Technical review submitted to Coordination."
            : note(input.notes);
        }
      } else if (v.action === "technical-return") {
        this.requireRole(u, ["Coordinator"]);
        if (["issued", "order_exception"].includes(stage))
          throw new HttpError(
            409,
            "Use a controlled order exception after PO receipt.",
          );
        if (!r.technical_owner_id)
          throw new HttpError(
            422,
            "Assign a technical owner before returning the design.",
          );
        data.returnReason = note(input.notes);
        data.returnSourceVersion = r.version;
        data.revisionCategory = z
          .enum([
            "Technical error",
            "Internal correction",
            "Customer scope change",
          ])
          .parse(input.category);
        data.reviewDocumentId = null;
        data.technicalVerifiedAt = null;
        if (input.excelCorrection === true) {
          if (
            r.short_code !== "UBL" ||
            r.route !== "survey-framework" ||
            !data.surveyDispatchId
          )
            throw new HttpError(
              422,
              "Survey Excel corrections apply only to a dispatched UBL pre-agreed survey.",
            );
          data.excelCorrectionRequested = true;
          stage = "survey_scheduled";
        } else stage = "technical_revision";
        reason = data.returnReason;
      } else if (v.action === "commercial-return") {
        this.requireRole(u, ["Coordinator"]);
        if (["issued", "order_exception"].includes(stage))
          throw new HttpError(
            409,
            "Use a controlled order exception after PO receipt.",
          );
        data.returnReason = note(input.notes);
        data.returnSourceVersion = r.version;
        data.revisionCategory = z
          .enum([
            "Technical error",
            "Internal correction",
            "Customer scope change",
          ])
          .parse(input.category);
        stage = "commercial_revision";
        reason = data.returnReason;
      } else if (v.action === "resume") {
        this.requireRole(u, ["Coordinator"]);
        requireStage(["commercial_revision", "deferred"]);
        stage = data.draftId
          ? "design_handed_off"
          : r.route.endsWith("framework")
            ? "approved_dispatch"
            : "survey_requested";
        reason = note(input.notes);
      } else if (v.action === "dispatch") {
        this.requireRole(u, ["Coordinator"]);
        const current = await this.decorate(r, u, c);
        if (
          current.coordinationBucket !== "Approved Documents—Awaiting Dispatch"
        )
          throw new HttpError(
            409,
            "Only the exact reviewed recommendation or approved quotation can be dispatched.",
          );
        const via = z.enum(["Customer", "Sales"]).parse(input.via),
          recipient = note(input.recipient),
          evidenceId = uuid(input.evidenceId);
        await this.requireFile(
          c,
          r,
          evidenceId,
          "Recommendation sending evidence",
        );
        if (r.route.endsWith("framework")) {
          if (
            !data.recommendationId &&
            !(r.legacy_type === "ubl" && r.data.legacyData?.technicalVerified)
          )
            throw new HttpError(422, "A verified recommendation is required.");
          await this.document(c, r, actor, "Recommendation dispatch", {
            recommendationId: data.recommendationId ?? null,
            legacyId: r.legacy_id,
            via,
            recipient,
            evidenceId,
            customerSent: via === "Customer",
            notes: note(input.notes),
          });
        } else {
          const quote = current.quotation;
          if (!quote || !["Approved", "PO received"].includes(quote.status))
            throw new HttpError(409, "Choose the exact approved quotation.");
          await c.query(
            "INSERT INTO quotation_dispatch_records(id,quotation_id,recipient,notes,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
            [
              randomUUID(),
              quote.id,
              recipient,
              `${via} handoff; evidence ${evidenceId}; ${note(input.notes)}`,
              actor,
            ],
          );
          data.quotationId = quote.id;
          if (via === "Customer") await finalizeCustomerBoq(c, quote.id, actor);
        }
        data.dispatchVia = via;
        data.recipient = recipient;
        data.salesSendConfirmed = via === "Customer";
        data.dispatchedAt = new Date().toISOString();
        stage = "customer_tracking";
        reason = note(input.notes);
      } else if (v.action === "decision") {
        this.requireRole(u, ["Coordinator"]);
        requireStage(["customer_tracking", "deferred", "approved_dispatch"]);
        const outcome = z
          .enum([
            "Awaiting response",
            "Deferred",
            "Declined",
            "Sales confirmed customer dispatch",
            "Accepted—awaiting PO",
          ])
          .parse(input.outcome);
        if (outcome === "Sales confirmed customer dispatch") {
          if (data.dispatchVia !== "Sales")
            throw new HttpError(422, "This document was not handed to Sales.");
          const evidenceId = uuid(input.evidenceId);
          await this.requireFile(
            c,
            r,
            evidenceId,
            "Recommendation sending evidence",
          );
          await this.document(c, r, actor, "Customer dispatch confirmation", {
            originalRecipient: data.recipient,
            quotationId: data.quotationId ?? null,
            recommendationId: data.recommendationId ?? null,
            evidenceId,
            notes: note(input.notes),
            recordedBy: u.display_name,
            confirmationBasis:
              "Sales sending evidence supplied to Coordination",
          });
          data.salesSendConfirmed = true;
          if (data.quotationId)
            await finalizeCustomerBoq(c, data.quotationId, actor);
          data.customerSentEvidenceId = evidenceId;
        }
        data.customerOutcome = outcome;
        reason = note(input.notes);
        stage =
          outcome === "Deferred"
            ? "deferred"
            : outcome === "Declined"
              ? "declined"
              : "customer_tracking";
      } else if (v.action === "headsup") {
        this.requireRole(u, ["Coordinator"]);
        requireStage(["customer_tracking"]);
        if (
          data.headsup ||
          (
            await c.query(
              "SELECT 1 FROM active_headsup_received_sites WHERE record_id=$1",
              [id],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "A heads-up is already recorded. Open its saved report instead.",
          );
        if (["issued", "order_exception"].includes(stage))
          throw new HttpError(409, "An actual order already exists.");
        reason = note(input.notes);
        const evidenceId = uuid(input.evidenceId);
        await this.requireFile(c, r, evidenceId, "Heads-up evidence");
        data.headsup = {
          evidenceId,
          date: z.iso.date().parse(input.date),
          notes: reason,
        };
        if (input.frameworkId) {
          data.basis = await frameworkBasis(
            this.pool,
            c,
            r,
            uuid(input.frameworkId),
          );
          r.framework_id = data.basis.source.id;
        }
        stage = "customer_tracking";
      } else if (v.action === "advance") {
        this.requireRole(u, ["Coordinator"]);
        requireStage(["advance_pending"]);
        if (!data.headsup && r.legacy_type !== "ubl")
          throw new HttpError(
            422,
            "Attach and record the customer heads-up first.",
          );
        if (data.originalOrderPreserved)
          throw new HttpError(
            409,
            "An existing revised-PO site does not need a new material forecast.",
          );
        const recipient = await this.person(
          c,
          uuid(input.recipientId),
          "Operations",
        );
        let boq: any;
        if (data.basis) boq = data.basis.boq;
        else if (data.reviewDocumentId)
          boq = (
            await c.query(
              "SELECT snapshot->'boq' AS boq FROM project_workflow_documents WHERE id=$1",
              [data.reviewDocumentId],
            )
          ).rows[0]?.boq;
        else if (data.draftId)
          boq = (
            await c.query(
              "SELECT r.snapshot FROM boq_draft_finalizations f JOIN boq_revisions r ON r.id=f.revision_id WHERE f.draft_id=$1",
              [data.draftId],
            )
          ).rows[0]?.snapshot;
        if (!boq)
          throw new HttpError(
            422,
            "Select an approved configuration or a reviewed BOQ for the advance forecast.",
          );
        data.expectedDate = input.date ? z.iso.date().parse(input.date) : null;
        data.deliveryAddress = z
          .string()
          .max(1000)
          .parse(input.deliveryAddress ?? "");
        data.siteContact = z
          .string()
          .max(300)
          .parse(input.siteContact ?? "");
        data.sitePhone = z
          .string()
          .max(100)
          .parse(input.sitePhone ?? "");
        data.recipientId = recipient;
        reason = note(input.notes);
        const doc = await this.document(c, r, actor, "Advance BOQ", {
          label: "Advance preparation—PO not received.",
          authorization:
            "Material forecast only. No IPO, confirmed order, dispatch or installation authorisation.",
          customer: r.customer,
          site: r.site_name,
          siteCode: r.site_code,
          configuration: data.basis?.source ?? null,
          items: this.materials(boq),
          expectedDate: data.expectedDate,
          deliveryAddress: data.deliveryAddress,
          siteContact: data.siteContact,
          sitePhone: data.sitePhone,
          missingDeliveryInformation: [
            !data.deliveryAddress && "Delivery address",
            !data.siteContact && "Site contact",
            !data.sitePhone && "Contact number",
            !data.expectedDate && "Expected date",
          ].filter(Boolean),
          recipientId: recipient,
          notes: reason,
        });
        await c.query(
          "INSERT INTO project_advance_planning(record_id,mode,document_id,operations_owner_id) VALUES($1,'Provisional',$2,$3) ON CONFLICT(record_id) DO UPDATE SET document_id=excluded.document_id,operations_owner_id=excluded.operations_owner_id,updated_at=now()",
          [id, doc.id, recipient],
        );
        stage = "customer_tracking";
      } else if (v.action === "link-quote") {
        this.requireRole(u, ["Coordinator"]);
        const q = uuid(input.quotationId),
          basis = await quotationBasis(this.pool, c, actor, r, q, {}, true);
        const own = (
          await c.query(
            `SELECT 1 FROM quotation_versions q WHERE q.id=$1 AND ${ownedCondition("quotation", "q.id", "$2")}`,
            [q, actor],
          )
        ).rowCount;
        if (!own && !management(u.role))
          throw new HttpError(403, "Choose your own approved quotation.");
        data.basis = basis;
        data.quotationId = q;
        stage = "po_receipt";
        reason = note(input.notes);
      } else if (v.action === "receipt") {
        this.requireRole(u, ["Coordinator"]);
        if (stage === "issued")
          throw new HttpError(
            409,
            "The PO already has issued documents. Open its issuance history.",
          );
        const received = receiptSchema.parse(input);
        if(received.ipoNumber){requireEditableIpoRoute(r);if(!await manualIpoAvailable(c,received.ipoNumber,r.id,received.saleDetails?.orderNumber))throw new HttpError(409,ipoNumberConflict);}
        await this.requireFile(c, r, received.evidenceId, "PO / confirmation");
        let basis: any;
        if (received.basisType === "quotation") {
          const quote = uuid(received.quotationId);
          const own = (
            await c.query(
              `SELECT 1 FROM quotation_versions q WHERE q.id=$1 AND ${ownedCondition("quotation", "q.id", "$2")}`,
              [quote, actor],
            )
          ).rowCount;
          if (!own && !management(u.role))
            throw new HttpError(403, "Choose an approved quotation you own.");
          basis = await quotationBasis(this.pool, c, actor, r, quote, {
            reference: received.reference,
            date: received.date,
            notes: received.notes,
            customerNtn: received.customerNtn,
            customerStrn: received.customerStrn,
          });
          data.quotationId = quote;
        } else {
          if (!r.route.endsWith("framework"))
            throw new HttpError(
              422,
              "The selected route requires a quotation.",
            );
          const useSavedFramework = savedFrameworkSelected(r, received.frameworkId);
          basis =
            useSavedFramework
              ? structuredClone(data.basis)
              : await frameworkBasis(
                  this.pool,
                  c,
                  r,
                  uuid(received.frameworkId),
                  received,
                );
          basis.order.input = {
            ...basis.order.input,
            poNumber: received.reference,
            orderDate: received.date,
            evidenceNotes: received.notes,
            customerNtn: received.customerNtn,
            customerStrn: received.customerStrn,
          };
          // Keep the live FK; the frozen snapshot retains its historical ID.
          if (!useSavedFramework) r.framework_id = basis.source.id;
        }
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `project-po:${r.customer_id}:${received.reference.toLowerCase()}`,
        ]);
        const previous = (
          await c.query(
            "SELECT record_id FROM project_po_receipts WHERE customer_id=$1 AND lower(reference)=lower($2)",
            [r.customer_id, received.reference],
          )
        ).rows;
        if (previous.some((p) => p.record_id !== id))
          throw new HttpError(
            409,
            "This customer PO reference belongs to another site.",
          );
        basis.order.input = saleInput(basis, received);
        if(data.directPoDetails&&received.saleDetails){
          const previous=data.directPoDetails.values,values={...previous,...Object.fromEntries(directPoFields.filter(([key])=>typeof received.saleDetails?.[key]==='string').map(([key])=>[key,received.saleDetails![key]])),approvalDate:received.date};
          const changes=directPoChanges(previous,values);
          if(changes.length)data.directPoDetails={...data.directPoDetails,values,history:[...data.directPoDetails.history,{actor,actorName:u.display_name,at:new Date().toISOString(),evidenceId:received.evidenceId,changes}]};
        }
        const differences =
            received.confirmationType !== "Customer PO"
              ? []
              : compareBasis(basis.comparison, received.actual),
          rid = randomUUID(),
          receiptVersion = (
            await c.query(
              "SELECT COALESCE(max(version),0)+1 AS n FROM project_po_receipts WHERE record_id=$1",
              [id],
            )
          ).rows[0].n;
        await c.query(
          "INSERT INTO project_po_receipts(id,record_id,customer_id,reference,version,input,basis,differences,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            rid,
            id,
            r.customer_id,
            received.reference,
            receiptVersion,
            received,
            basis,
            JSON.stringify(differences),
            actor,
          ],
        );
        data.receiptId = rid;
        data.basis = basis;
        stage = differences.length ? "order_exception" : "po_receipt";
        reason = received.notes;
        if (!differences.length) {
          const decision = (
            await c.query(
              "INSERT INTO project_order_decisions(id,receipt_id,record_id,outcome,reason,authorised_basis,created_by) VALUES($1,$2,$3,'Matched',$4,$5,$6) RETURNING *",
              [
                randomUUID(),
                rid,
                id,
                received.confirmationType !== "Customer PO"
                  ? `Uploaded ${received.confirmationType} of the exact approved source`
                  : "Exact PO comparison against approved source",
                basis,
                actor,
              ],
            )
          ).rows[0];
          const issuance = await this.issue(
            c,
            u,
            r,
            data,
            basis,
            { id: rid, input: received },
            decision.id,
          );
          data.ipoId = issuance.ipo_id;
          data.operationsId = issuance.operations_id;
          data.amendmentId = (issuance as any).amendment_id ?? null;
          data.originalIpoReference =
            (issuance as any).original_ipo_reference ?? null;
          stage = "issued";
        }
      } else if (v.action === "resolve") {
        if (!management(u.role))
          throw new HttpError(
            403,
            "Only Management resolves an order exception.",
          );
        requireStage(["order_exception"]);
        reason = note(input.notes);
        const receipt = (
          await c.query(
            "SELECT * FROM project_po_receipts WHERE id=$1 AND record_id=$2",
            [data.receiptId, id],
          )
        ).rows[0];
        if (!receipt)
          throw new HttpError(422, "Select the received PO exception.");
        if (input.returnForRevision === true) {
          await c.query(
            "INSERT INTO project_order_decisions(id,receipt_id,record_id,outcome,reason,authorised_basis,created_by) VALUES($1,$2,$3,'Returned',$4,$5,$6)",
            [randomUUID(), receipt.id, id, reason, receipt.basis, actor],
          );
          data.returnReason = reason;
          stage = "commercial_revision";
        } else {
          let basis = receipt.basis;
          if (input.quotationId)
            basis = await quotationBasis(
              this.pool,
              c,
              actor,
              r,
              uuid(input.quotationId),
              receipt.input,
            );
          else if (input.frameworkId)
            basis = await frameworkBasis(
              this.pool,
              c,
              r,
              uuid(input.frameworkId),
              receipt.input,
            );
          const remaining = compareBasis(
            basis.comparison,
            receipt.input.actual,
          );
          const termsOnly = remaining.every((x) => x.field === "terms");
          if (
            remaining.length &&
            !(termsOnly && input.authoriseTermsException === true)
          )
            throw new HttpError(
              422,
              "Financial, scope or quantity changes require a revised approved quotation or framework matching the PO. Original snapshots cannot be overwritten.",
            );
          const approvedBasis = structuredClone(basis);
          if (remaining.length) {
            approvedBasis.comparison.terms = receipt.input.actual.terms;
            approvedBasis.order.authorisedTermsException = {
              reason,
              receivedTerms: receipt.input.actual.terms,
              approvedOriginalTerms: basis.comparison.terms,
            };
          }
          const decision = (
            await c.query(
              "INSERT INTO project_order_decisions(id,receipt_id,record_id,outcome,reason,authorised_basis,created_by) VALUES($1,$2,$3,'Approved exception',$4,$5,$6) RETURNING *",
              [randomUUID(), receipt.id, id, reason, approvedBasis, actor],
            )
          ).rows[0];
          const issuance = await this.issue(
            c,
            u,
            r,
            data,
            approvedBasis,
            receipt,
            decision.id,
          );
          data.basis = approvedBasis;
          data.ipoId = issuance.ipo_id;
          data.operationsId = issuance.operations_id;
          data.amendmentId = (issuance as any).amendment_id ?? null;
          data.originalIpoReference =
            (issuance as any).original_ipo_reference ?? null;
          data.returnReason = null;
          stage = "issued";
        }
      } else if (v.action === "undo") {
        this.requireRole(u, ["Design", "Coordinator"]);
        reason = note(input.notes);
        if (stage === "issued" || data.receiptId || data.ipoId)
          throw new HttpError(
            409,
            "Issued or reviewed PO work cannot be undone. Use a documented revision.",
          );
        if (
          data.draftId &&
          (
            await c.query(
              "SELECT 1 FROM boq_draft_finalizations f WHERE f.draft_id=$1 AND (EXISTS(SELECT 1 FROM commercial_pricing_versions p WHERE p.boq_revision_id=f.revision_id) OR EXISTS(SELECT 1 FROM quotation_versions q WHERE q.boq_revision_id=f.revision_id))",
              [data.draftId],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "Downstream commercial work has started. Return the design for revision instead.",
          );
        if (stage === "customer_tracking" || data.dispatch)
          throw new HttpError(
            409,
            "Dispatched customer documents cannot be undone. Record a customer revision.",
          );
        const previous = (
          await c.query(
            "SELECT snapshot FROM project_workflow_events WHERE record_id=$1 AND version<$2 AND snapshot->>'stage'<>$3 ORDER BY version DESC LIMIT 1",
            [id, r.version, r.stage],
          )
        ).rows[0];
        if (!previous?.snapshot.stage)
          throw new HttpError(
            422,
            "No recorded internal transition is available to undo.",
          );
        if (input.targetStage && input.targetStage !== previous.snapshot.stage)
          throw new HttpError(
            409,
            "The undo destination changed. Reload and review it again.",
          );
        if (stage === "survey_scheduled" && data.surveyDispatchId)
          throw new HttpError(
            409,
            "This survey belongs to an approved dispatch. A controlled dispatch correction is required; its membership cannot be silently undone.",
          );
        const priorData = previous.snapshot.data ?? {};
        for (const key of Object.keys(data)) delete data[key];
        Object.assign(data, priorData);
        data.undoHistory = [
          ...(data.undoHistory ?? []),
          {
            from: stage,
            to: previous.snapshot.stage,
            reason,
            sourceVersion: r.version,
            at: new Date().toISOString(),
          },
        ];
        data.revisionCategory = z
          .enum([
            "Technical error",
            "Internal correction",
            "Customer scope change",
          ])
          .parse(input.category);
        stage = previous.snapshot.stage;
      } else throw new HttpError(400, "Unknown workflow action.");
      await c.query(
        "UPDATE project_workflow_records SET stage=$2,data=$3,framework_id=$4,planning_owner_id=$5,technical_owner_id=$6,version=version+1,updated_at=now() WHERE id=$1",
        [
          id,
          stage,
          data,
          r.framework_id ?? null,
          r.planning_owner_id ?? null,
          r.technical_owner_id ?? null,
        ],
      );
      await c.query(
        "INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          id,
          r.version + 1,
          v.action,
          { stage, reason, data },
          v.requestKey,
          fingerprint(v),
          actor,
        ],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `project.workflow.${v.action}:${id}:v${r.version + 1}`,
      ]);
      return { id, version: r.version + 1, stage, repeated: false };
    });
  }
  async requireFile(
    c: PoolClient,
    recordId: any,
    fileId: string,
    kind: string,
  ) {
    const f = (
      await c.query(
        "SELECT * FROM project_workflow_files WHERE id=$1 AND record_id=$2 AND kind=$3",
        [
          fileId,
          typeof recordId === "string" ? recordId : (recordId as any).id,
          kind,
        ],
      )
    ).rows[0];
    if (!f)
      throw new HttpError(422, `Attach ${kind} evidence to this site first.`);
    return f;
  }
  materials(boq: any) {
    return boq.lines
      .filter(
        (l: any) =>
          new Decimal(l.qty).gt(0) &&
          !/(labour|labor|delivery|logistics|synchronization|synchronisation|internet service)/i.test(
            l.description ?? l.key,
          ),
      )
      .map((l: any) => ({
        key: l.itemId ?? l.key,
        rateKey: l.key,
        description: l.description,
        brand: l.stockBrand ?? l.brand ?? "General",
        brandAlternatives: l.brandAlternatives ?? [],
        phase: l.phase ?? null,
        specification: l.specification ?? "",
        qty: String(l.qty),
        unit: l.unit,
        boqQty: String(l.qty),
        boqUnit: l.unit,
        itemId: l.itemId ?? null,
        itemVersion: l.itemVersion ?? null,
      }));
  }
  async issue(
    c: PoolClient,
    u: any,
    r: any,
    data: any,
    basis: any,
    receipt: any,
    decisionId: string,
    historical?:{kind:'verified-register-import';sourceId:string;sourceVersion:number;sourceSha256:string;sourceKey:string;importedBy:string;reason:string;hideFromIpoShared:true;sharedPoOrder?:string},
  ) {
    if(historical){const importer=(await c.query('SELECT active,role FROM users WHERE id=$1',[historical.importedBy])).rows[0];if(!importer?.active||!['Admin','Management'].includes(importer.role))throw new HttpError(403,'Historical IPO import requires active Management authorisation.');}
    const prior = (
      await c.query(
        "SELECT * FROM project_workflow_issuances WHERE record_id=$1",
        [r.id],
      )
    ).rows[0];
    if (prior) return prior;
    // New documents use the assigned master code; earlier snapshots stay immutable.
    r = { ...r, site_code: r.canonical_site_code ?? r.site_code };
    if (data.originalOrderPreserved) {
      const existing = (
        await c.query(
          "SELECT i.id,i.number FROM internal_purchase_orders i JOIN customer_purchase_orders p ON p.id=i.customer_po_id LEFT JOIN boq_revisions br ON br.id=nullif(i.snapshot->>'boqRevisionId','')::uuid LEFT JOIN boqs b ON b.id=br.boq_id WHERE p.customer_id=$1 AND (b.site_id=$2 OR i.snapshot->>'siteCode'=$3) ORDER BY i.created_at DESC LIMIT 1",
          [r.customer_id, r.site_id, r.site_code],
        )
      ).rows[0];
      const historical = (
        await c.query(
          "SELECT o.site_id,o.legacy_ipo_number,d.version FROM ubl_site_orders o LEFT JOIN LATERAL(SELECT version FROM ubl_site_document_versions WHERE site_id=o.site_id ORDER BY version DESC LIMIT 1)d ON true WHERE o.site_id=$1",
          [r.site_id],
        )
      ).rows[0];
      if (!existing && !historical?.legacy_ipo_number)
        throw new HttpError(
          422,
          "Link the original issued IPO before receiving its revised PO. A second IPO will not be created.",
        );
      const priorAmendment = (
        await c.query(
          "SELECT * FROM project_order_amendments WHERE receipt_id=$1",
          [receipt.id],
        )
      ).rows[0];
      if (priorAmendment)
        return {
          ipo_id: priorAmendment.ipo_id,
          operations_id: null,
          amendment_id: priorAmendment.document_id,
          original_ipo_reference: priorAmendment.original_ipo_reference,
        };
      const reference =
        existing?.number ?? `CHP-${historical.legacy_ipo_number}`;
      const doc = await this.document(c, r, u.id, "Revised PO amendment", {
        originalIpoReference: reference,
        originalIpoId: existing?.id ?? null,
        originalHistoricalSiteId: historical?.site_id ?? null,
        originalHistoricalVersion: historical?.version ?? null,
        poReference: receipt.input.reference,
        poDate: receipt.input.date,
        evidenceId: receipt.input.evidenceId,
        approvedSource: basis.source,
        comparison: basis.comparison,
        decisionId,
        notes: receipt.input.notes,
        financialSnapshotPreserved: true,
        noNewMaterialDemand: true,
        sentTo: "Accounts",
      });
      await c.query(
        "INSERT INTO project_order_amendments(id,record_id,receipt_id,decision_id,ipo_id,legacy_site_id,original_ipo_reference,document_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          r.id,
          receipt.id,
          decisionId,
          existing?.id ?? null,
          historical?.site_id ?? null,
          reference,
          doc.id,
          u.id,
        ],
      );
      return {
        ipo_id: existing?.id ?? null,
        operations_id: null,
        amendment_id: doc.id,
        original_ipo_reference: reference,
      };
    }
    const sharedHistoricalPo=!!historical?.sharedPoOrder;
    if(sharedHistoricalPo&&(!['MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10'].includes(basis.source.key)||historical!.sharedPoOrder!==basis.order.input.orderNumber||!/^([1-9][0-9]{0,5})\/([1-9][0-9]{0,5})$/.test(historical!.sharedPoOrder!)))throw new HttpError(409,'Historical shared PO order must match the approved UPS framework and exact order.');
    if (!sharedHistoricalPo&&
      (
        await c.query(
          "SELECT 1 FROM customer_purchase_orders WHERE customer_id=$1 AND lower(po_number)=lower($2)",
          [r.customer_id, receipt.input.reference],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "This PO already has an issued record. Open its existing job instead of issuing it again.",
      );
    let revisionId = basis.boqRevisionId,
      boqNumber = basis.order.boqNumber;
    if (!revisionId) {
      await c.query("SELECT pg_advisory_xact_lock(742019003)");
      const draft = randomUUID(),
        existing = (
          await c.query(
            "SELECT b.id,br.revision,br.number,br.id AS revision_id FROM boqs b JOIN LATERAL(SELECT * FROM boq_revisions WHERE boq_id=b.id ORDER BY revision DESC LIMIT 1)br ON true WHERE b.site_id=$1 ORDER BY b.created_at DESC LIMIT 1",
            [r.site_id],
          )
        ).rows[0];
      await c.query(
        "INSERT INTO survey_drafts(id,owner_id,inputs,base_revision_id,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,'Internal management')",
        [
          draft,
          r.coordinator_id,
          basis.boq.survey,
          existing?.revision_id ?? null,
          existing
            ? "Approved framework issuance"
            : "Initial approved framework",
        ],
      );
      const family = existing?.id ?? randomUUID(),
        revision = existing ? existing.revision + 1 : 0;
      if (!existing)
        await c.query(
          "INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) VALUES($1,$2,$3,$4,1,$5)",
          [family, draft, r.site_id, r.customer_id, r.coordinator_id],
        );
      boqNumber = existing
        ? revisedReference(existing.number, revision)
        : await allocateReference(c, "BOQ", family, r.customer_id, r.site_code);
      revisionId = randomUUID();
      await c.query(
        "INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,$6,$7,'Internal management')",
        [
          revisionId,
          family,
          revision,
          boqNumber,
          basis.boq,
          r.coordinator_id,
          "Approved framework version " + basis.source.version,
        ],
      );
      await c.query(
        "INSERT INTO boq_draft_finalizations(draft_id,revision_id) VALUES($1,$2)",
        [draft, revisionId],
      );
    }
    const po = randomUUID(),
      ipo = randomUUID(),
      ops = randomUUID(),
      number = await ipoReference(c,r,ipo,receipt.input.ipoNumber,basis.order.input.orderNumber),
      opsNumber = await allocateReference(
        c,
        "BOQ",
        ops,
        r.customer_id,
        r.site_code,
      );
    const input = {
      ...basis.order.input,
      poNumber:
        !historical && receipt.input.confirmationType && receipt.input.confirmationType !== "Customer PO"
          ? ""
          : receipt.input.reference,
      approvalReference: receipt.input.reference,
      evidenceType: historical ? "Historical source register" : receipt.input.confirmationType ?? "Customer PO",
      orderDate: receipt.input.date,
      evidenceNotes: receipt.input.notes,
    };
    const snapshot = {
      ...structuredClone(basis.order),
      ...(historical?{historicalImport:{...historical,originalCustomerEvidenceUploaded:false}}:{}),
      directPoApproval: data.directPoDetails??null,
      siteName: data.directPoDetails?.values.siteName??r.site_name,
      siteCode: r.site_code,
      input,
      boqRevisionId: revisionId,
      boqNumber,
      preparedBy: r.coordinator,
      checkedBy: r.coordinator,
      workflowRecordId: r.id,
      approvedCommercialSource: basis.source,
      orderDecisionId: decisionId,
      approvalChannel: "Exact approved commercial basis",
      documentLayoutVersion: 4,
      approvedPanelQty: await this.approvedPanelQuantity(r,c),
      peachtree: ptDetail(basis.order,basis.boq,await this.approvedPanelQuantity(r,c)),
    };
    await c.query(
      "INSERT INTO customer_purchase_orders(id,quotation_id,boq_revision_id,customer_id,po_number,document_id,input,created_by,shared_order_number) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8)",
      [
        po,
        basis.source.type === "quotation" ? basis.source.id : null,
        basis.source.type === "quotation" ? revisionId : null,
        r.customer_id,
        receipt.input.reference,
        input,
        r.coordinator_id,
        historical?.sharedPoOrder??null,
      ],
    );
    await c.query(
      "INSERT INTO internal_purchase_orders(id,customer_po_id,submission_id,number,snapshot,fingerprint,request_key,created_by) VALUES($1,$2,NULL,$3,$4,$5,$6,$7)",
      [
        ipo,
        po,
        number,
        snapshot,
        fingerprint(snapshot),
        randomUUID(),
        r.coordinator_id,
      ],
    );
    if(!historical)await c.query(
      "INSERT INTO ipo_accounts_handoffs(id,ipo_id,created_by) VALUES($1,$2,$3)",
      [randomUUID(), ipo, r.coordinator_id],
    );
    if(!historical){
      const emailIpo={id:ipo,number,snapshot};
      await queueIssuedPo(c,u.id,emailIpo,undefined,receipt.input.evidenceId?receipt.id:undefined);
      await queueSharedIpo(c,u.id,emailIpo);
    }
    const headsupAdvance = !!(
      await c.query(
        "SELECT 1 FROM headsup_advance_members WHERE record_id=$1",
        [r.id],
      )
    ).rowCount;
    const operations = {
      ...(historical?{bulkHistoricalImport:true,historicalImport:historical}:{}),
      directPoApproval: data.directPoDetails??null,
      orderNumber: input.orderNumber??"",
      headsupStatus: headsupAdvance ? "Heads-up shared — final received" : null,
      version: 1,
      ipoId: ipo,
      ipoNumber: number,
      quotationId: snapshot.quotationId,
      quotationNumber: snapshot.quotationNumber,
      boqRevisionId: revisionId,
      boqNumber,
      customer: snapshot.customer,
      siteName: data.directPoDetails?.values.siteName??r.site_name,
      siteCode: r.site_code,
      customerPoNumber: input.poNumber,
      contactPerson: input.contactPerson,
      phone: input.phone,
      billingAddress: input.billingAddress,
      deliveryAddress: input.deliveryAddress,
      items: this.materials(basis.boq),
      notes: receipt.input.notes,
      issuedBy: r.coordinator,
      workflowRecordId: r.id,
      orderDecisionId: decisionId,
    };
    await c.query(
      "INSERT INTO operations_boq_issuances(id,ipo_id,boq_revision_id,number,snapshot,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        ops,
        ipo,
        revisionId,
        opsNumber,
        operations,
        randomUUID(),
        r.coordinator_id,
      ],
    );
    for (const [i, l] of operations.items.entries())
      await c.query(
        "INSERT INTO operations_stock_demand(issuance_id,line_number,item_key,brand,specification,quantity,unit) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [ops, i, l.key, l.brand, l.specification, l.qty, l.unit],
      );
    await c.query(
      "INSERT INTO project_workflow_issuances(record_id,receipt_id,decision_id,ipo_id,operations_id) VALUES($1,$2,$3,$4,$5)",
      [r.id, receipt.id, decisionId, ipo, ops],
    );
    await c.query(
      "UPDATE project_advance_planning SET mode='Confirmed',confirmed_issuance_id=$2,updated_at=now() WHERE record_id=$1",
      [r.id, ops],
    );
    if (headsupAdvance)
      await c.query(
        "INSERT INTO headsup_advance_final_links(record_id,operations_id,created_by) VALUES($1,$2,$3) ON CONFLICT(record_id) DO NOTHING",
        [r.id, ops, r.coordinator_id],
      );
    if(!historical){
      await new SiteWorkflowRepository(this.pool).ensure(c,ops);
      const receiving=await syncCreatedOperationsHandoff(c,u.id,{ipoId:ipo,operationsIssuanceId:ops});
      for(const linked of [...receiving.created,...receiving.retained])await linkCreatedOperationsMaterialSource(c,u.id,{boardSiteId:linked.boardSiteId,ipoId:ipo,operationsIssuanceId:ops});
    }
    return { ipo_id: ipo, operations_id: ops };
  }
  async attach(actor: string, id: string, input: any) {
    const { fileSchema } = await import("./schema.js");
    const v = fileSchema.parse(input);
    return transaction(this.pool, async (c) => {
      const { u, r } = await this.record(actor, id, c, true);
      this.requireRole(u, ["Design", "Coordinator"]);
      await this.requireReceivingDepartment(u, r, c);
      if (u.role === "Design" && v.kind === "Request evidence")
        throw new HttpError(
          422,
          "Original customer request evidence is attached by Coordination. Design uploads the survey report and site photos.",
        );
      if (r.stage === "issued")
        throw new HttpError(
          409,
          "Issued evidence is preserved; use a controlled return for new evidence.",
        );
      const content = Buffer.from(v.base64, "base64");
      if (!content.length || content.length > 8388608)
        throw new HttpError(422, "Use a file up to 8 MB.");
      const valid =
        v.mime === "application/pdf"
          ? content.subarray(0, 5).toString() === "%PDF-"
          : v.mime === "image/png"
            ? content
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : content[0] === 255 && content[1] === 216 && content[2] === 255;
      if (!valid)
        throw new HttpError(
          422,
          "The attachment does not match its file type.",
        );
      const sha = createHash("sha256").update(content).digest("hex");
      if (["Survey report", "Survey photo"].includes(v.kind)) {
        const duplicate = (
          await c.query(
            "SELECT 1 FROM project_workflow_files WHERE record_id=$1 AND kind=$2 AND sha256=$3",
            [id, v.kind, sha],
          )
        ).rowCount;
        const count = (
          await c.query(
            "SELECT count(*)::int AS count FROM project_workflow_files WHERE record_id=$1 AND kind=$2",
            [id, v.kind],
          )
        ).rows[0].count;
        if (!duplicate && count >= 10)
          throw new HttpError(
            422,
            v.kind === "Survey report"
              ? "Up to 10 survey report files may be attached."
              : "Up to 10 site pictures may be attached.",
          );
      }
      const saved =
        (
          await c.query(
            "INSERT INTO project_workflow_files(id,record_id,kind,filename,mime,sha256,content,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(record_id,kind,sha256) DO NOTHING RETURNING id",
            [randomUUID(), id, v.kind, v.filename, v.mime, sha, content, actor],
          )
        ).rows[0] ??
        (
          await c.query(
            "SELECT id FROM project_workflow_files WHERE record_id=$1 AND kind=$2 AND sha256=$3",
            [id, v.kind, sha],
          )
        ).rows[0];
      if ((r.data.removedRequestFileIds ?? []).includes(saved.id))
        await c.query("UPDATE project_workflow_records SET data=jsonb_set(data,'{removedRequestFileIds}',$2::jsonb),updated_at=now() WHERE id=$1", [id, JSON.stringify(r.data.removedRequestFileIds.filter((fileId: string) => fileId !== saved.id))]);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `project.workflow.attach:${id}:${saved.id}`,
      ]);
      return saved;
    });
  }
  async removeRequestFile(actor: string, id: string, fileId: string) {
    return transaction(this.pool, async (c) => {
      const { u, r } = await this.record(actor, id, c, true);
      this.requireRole(u, ["Coordinator"]);
      await this.requireReceivingDepartment(u, r, c);
      if (r.stage !== "request_review")
        throw new HttpError(409, "Request evidence can only be removed before sending to Design.");
      const removed = (await c.query(
        "SELECT filename FROM project_workflow_files WHERE id=$1 AND record_id=$2 AND kind='Request evidence'",
        [fileId, id],
      )).rows[0];
      if (!removed) throw new HttpError(404, "Request attachment not found.");
      await c.query("UPDATE project_workflow_records SET data=jsonb_set(data,'{removedRequestFileIds}',$2::jsonb),updated_at=now() WHERE id=$1", [id, JSON.stringify([...new Set([...(r.data.removedRequestFileIds ?? []), fileId])])]);
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor, `project.workflow.remove-request-file:${id}:${fileId}:${removed.filename}`,
      ]);
      return { removed: true };
    });
  }
  async file(actor: string, id: string, fileId: string) {
    const { r } = await this.record(actor, id);
    if ((r.data.removedRequestFileIds ?? []).includes(fileId)) throw new HttpError(404, "Attachment not found.");
    const f = (
      await this.pool.query(
        "SELECT * FROM project_workflow_files WHERE id=$1 AND record_id=$2",
        [fileId, id],
      )
    ).rows[0];
    if (!f) throw new HttpError(404, "Attachment not found.");
    return f;
  }
  async approvedPanelQuantity(r:any,c:Pool|PoolClient=this.pool){
    if(!r.data.reviewDocumentId)return r.data.surveyInputs?.panelQty;
    const doc=(await c.query("SELECT COALESCE(NULLIF(snapshot->'enteredSurvey'->>'panelQty','0'),NULLIF(snapshot->'boq'->'survey'->>'panelQty','0')) AS qty FROM project_workflow_documents WHERE id=$1 AND record_id=$2 AND kind='Technical review'",[r.data.reviewDocumentId,r.id])).rows[0];
    return doc?.qty??r.data.surveyInputs?.panelQty;
  }
  async ipoAvailability(actor:string,number:string,options:{recordId?:string;frameworkId?:string;orderNumber?:string}={}){
    const u=await this.user(actor);this.requireRole(u,['Coordinator']);
    if(options.recordId){await this.record(actor,uuid(options.recordId));return {available:await manualIpoAvailable(this.pool,number,options.recordId,options.orderNumber)};}
    const f=options.frameworkId?(await this.pool.query('SELECT customer_id,configuration_key FROM project_framework_current WHERE id=$1',[uuid(options.frameworkId)])).rows[0]:undefined;
    return {available:await manualIpoAvailable(this.pool,number,undefined,options.orderNumber,f?{customerId:f.customer_id,configurationKey:f.configuration_key}:undefined)};
  }
  async salePreview(actor: string, id: string, raw: unknown) {
    const received = receiptSchema.parse(raw);
    const { u, r } = await this.record(actor, id);
    this.requireRole(u, ["Coordinator"]);
    await this.requireReceivingDepartment(u, r);
    if(received.ipoNumber){requireEditableIpoRoute(r);if(!await manualIpoAvailable(this.pool,received.ipoNumber,r.id,received.saleDetails?.orderNumber))throw new HttpError(409,ipoNumberConflict);}
    const current = await this.decorate(r, u);
    if (r.stage !== "customer_tracking" && current.coordinationBucket !== "Customer Decision & Order Tracking" && !(r.stage === "po_receipt" && r.route === "direct-framework" && !r.data.originalOrderPreserved))
      throw new HttpError(
        409,
        "Only customer follow-up projects can be confirmed.",
      );
    const basis =
      received.basisType === "quotation"
        ? await quotationBasis(
            this.pool,
            this.pool,
            actor,
            r,
            uuid(received.quotationId),
            {},
            true,
          )
        : savedFrameworkSelected(r, received.frameworkId ?? r.framework_id)
          ? structuredClone(r.data.basis)
          : await frameworkBasis(
              this.pool,
              this.pool,
              r,
              uuid(received.frameworkId ?? r.framework_id),
            );
    const differences =
      received.confirmationType !== "Customer PO"
        ? []
        : compareBasis(basis.comparison, received.actual);
    if (differences.length)
      throw new HttpError(
        422,
        "Resolve PO differences before previewing the IPO.",
      );
    return {
      ...structuredClone(basis.order),
      input: saleInput(basis, received),
      siteName: r.data.directPoDetails?.values.siteName??r.site_name,
      siteCode: r.canonical_site_code ?? r.site_code,
      preparedBy: r.coordinator,
      checkedBy: r.coordinator,
      documentLayoutVersion: 4,
      approvedPanelQty: await this.approvedPanelQuantity(r),
      peachtree: ptDetail(basis.order,basis.boq,await this.approvedPanelQuantity(r)),
    };
  }
  async preview(actor: string, id: string, input: any) {
    const { u, r } = await this.record(actor, id);
    this.requireRole(u, ["Design", "Coordinator"]);
    if (input.kind === "commercial-summary") {
      this.requireRole(u, ["Coordinator"]);
      const revision = r.data.draftId
        ? (
            await this.pool.query(
              "SELECT b.id,COALESCE(final.number,pre.number,b.number) AS number,b.created_at,b.snapshot FROM boq_draft_finalizations f JOIN boq_revisions b ON b.id=f.revision_id LEFT JOIN boq_preliminary_references pre ON pre.revision_id=b.id LEFT JOIN boq_customer_final_references final ON final.revision_id=b.id WHERE f.draft_id=$1",
              [r.data.designDraftId ?? r.data.draftId],
            )
          ).rows[0]
        : null;
      if (!revision)
        return {
          pending:
            "Saved project costing is not available for this survey yet.",
        };
      const snapshot = revision.snapshot;
      const nonBessTotal = (snapshot.lines ?? [])
        .filter((line: any) => !isBessEquipment(line))
        .reduce(
          (total: Decimal, line: any) => total.plus(line.total),
          new Decimal(0),
        )
        .toString();
      const watts = new Decimal(snapshot.engineering?.pvWatts ?? 0);
      const perWatt = (cost: string) =>
        watts.gt(0) ? new Decimal(cost).div(watts).toString() : null;
      const epc = (snapshot.epc ?? []).map((row: any) => {
        const cost = (snapshot.lines ?? [])
          .filter(
            (line: any) => line.epc === row.name && !isBessEquipment(line),
          )
          .reduce(
            (total: Decimal, line: any) => total.plus(line.total),
            new Decimal(0),
          )
          .toString();
        return { name: row.name, cost, perWatt: perWatt(cost) };
      });
      const epcTotal = epc
        .reduce(
          (total: Decimal, row: any) => total.plus(row.cost),
          new Decimal(0),
        )
        .toString();
      return {
        number: revision.number,
        createdAt: revision.created_at,
        rows: (snapshot.summary ?? []).map((row: any) => {
          const restricted = isBessEquipment(row) && !u.restricted_cost_access;
          return {
            name: row.name,
            cost: restricted ? null : row.cost,
            perWatt: restricted ? null : perWatt(row.cost),
            restricted,
          };
        }),
        epc,
        epcTotal,
        epcTotalPerWatt: perWatt(epcTotal),
        nonBessTotal,
        nonBessPerWatt: perWatt(nonBessTotal),
      };
    }
    if (input.kind === "technical-summary") {
      const document = (
        await this.pool.query(
          "SELECT number,created_at,snapshot FROM project_workflow_documents WHERE record_id=$1 AND kind='Technical review' AND ($2::uuid IS NULL OR id=$2::uuid) ORDER BY version DESC,created_at DESC LIMIT 1",
          [id, r.data.reviewDocumentId ?? null],
        )
      ).rows[0];
      const customer = (
        await this.pool.query("SELECT short_code FROM customers WHERE id=$1", [
          r.customer_id,
        ])
      ).rows[0];
      const ubl =
        r.route === "survey-framework" &&
        customer?.short_code?.toUpperCase() === "UBL";
      const reported = document?.snapshot.enteredSurvey ?? r.data.surveyInputs;
      const reviewed = ubl
        ? reported
        : (document?.snapshot.boq?.survey ?? reported);
      if (!reviewed)
        return { pending: "No submitted survey BOQ details are available." };
      const watts = (s: any) =>
        s?.panelQty != null && s?.panelWattage != null
          ? new Decimal(s.panelQty).mul(s.panelWattage)
          : null;
      let cableRows: any[] = [],
        baselineLabel = "Quick BOQ qty (m)",
        panels: any[] = [],
        comparisonNote = "";
      if (ubl && r.framework_id) {
        const basis =
          r.data.basis ??
          (await frameworkBasis(this.pool, this.pool, r, r.framework_id));
        const comparison = await ublSurveyComparison(
          this.pool,
          { ...r, data: { ...r.data, surveyInputs: reviewed } },
          basis,
        );
        cableRows =
          comparison?.rows.filter((row: any) => row.field.endsWith("(m)")) ??
          [];
        panels =
          comparison?.rows.filter(
            (row: any) => row.field === "PV capacity (W)",
          ) ?? [];
        baselineLabel = "Approved UBL qty (m)";
        comparisonNote =
          "Panel wattage is compared with the agreed UBL PV capacity; panel count and individual module wattage follow availability.";
      } else {
        const comparison = quickCableComparison(
          { ...r, data: { ...r.data, surveyInputs: reviewed } },
          await new MastersRepository(this.pool, true).list(),
        );
        cableRows = comparison.rows;
        comparisonNote =
          "Cable quantities are compared with the standard Quick BOQ rules. Panel values are compared with the original survey input because this route has no fixed UBL panel capacity.";
        for (const [field, key] of [
          ["Panel quantity", "panelQty"],
          ["Panel wattage (W)", "panelWattage"],
        ]) {
          const before = reported?.[key],
            after = reviewed[key];
          panels.push({
            field,
            approved: before == null ? "N/A" : String(before),
            entered: after == null ? "N/A" : String(after),
            different:
              before == null || after == null || !new Decimal(before).eq(after),
          });
        }
        const before = watts(reported),
          after = watts(reviewed);
        panels.push({
          field: "Total PV wattage (W)",
          approved: before?.toString() ?? "N/A",
          entered: after?.toString() ?? "N/A",
          different: !before || !after || !before.eq(after),
        });
      }
      return {
        reviewNumber: document?.number ?? null,
        reviewedAt: document?.created_at ?? null,
        remarks:
          document?.snapshot.notes ?? r.data.noFeasibleSolution?.remarks ?? "",
        status: r.data.noFeasibleSolution
          ? "Needs Review — No Feasible Solution"
          : "Technically reviewed",
        survey: {
          family: reviewed.family,
          panelQty: reviewed.panelQty,
          panelWattage: reviewed.panelWattage,
          totalWattage: watts(reviewed)?.toString() ?? null,
          bessId: reviewed.bessId,
          inverter: reviewed.inverter,
          batteryKwh: reviewed.batteryKwh,
          structure: reviewed.structure,
          smartMeter: reviewed.smartMeter,
          genset: reviewed.genset,
        },
        cableRows,
        panels,
        baselineLabel,
        panelBaselineLabel: ubl ? "Agreed UBL capacity" : "Original survey",
        comparisonNote,
      };
    }
    if (input.kind === "quick-cables") {
      return {
        cableComparison: quickCableComparison(
          r,
          await new MastersRepository(this.pool, true).list(),
        ),
      };
    }
    if (input.kind === "design") {
      const v = designReviewSchema.parse(input.review);
      const calculated = await designCalculation(
        this.pool,
        r,
        v,
        u.display_name,
      );
      return {
        costing: safeCosting(
          calculated.boq,
          u.restricted_cost_access ? "Admin" : "Restricted",
          v.markups,
        ),
        survey: calculated.boq.survey,
      };
    }
    const basis =
      input.kind !== "quotation" &&
      savedFrameworkSelected(r, input.frameworkId ?? r.framework_id)
        ? r.data.basis
        : input.kind === "quotation"
          ? await quotationBasis(
              this.pool,
              this.pool,
              actor,
              r,
              uuid(input.quotationId),
              {},
              true,
            )
          : await frameworkBasis(
              this.pool,
              this.pool,
              r,
              uuid(input.frameworkId ?? r.framework_id),
            );
    return {
      source: basis.source,
      surveyComparison: await ublSurveyComparison(this.pool, r, basis),
      comparison: basis.comparison,
      fingerprint: basis.fingerprint,
      costing: safeCosting(
        basis.boq,
        u.restricted_cost_access ? "Admin" : "Restricted",
      ),
      differences: input.actual
        ? compareBasis(basis.comparison, input.actual)
        : [],
    };
  }
  async framework(actor: string, input: any) {
    return transaction(this.pool, async (c) => {
      const u = await this.user(actor, c);
      if (!management(u.role))
        throw new HttpError(403, "Management approves customer frameworks.");
      await c.query("SELECT pg_advisory_xact_lock(742019065)");
      const customerId = z.number().int().positive().parse(input.customerId),
        key = z.string().trim().min(1).max(200).parse(input.key),
        source = note(input.sourceReference),
        quoteId = uuid(input.quotationId);
      const q = (
        await c.query(
          "SELECT q.*,b.customer_id FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id JOIN boqs b ON b.id=br.boq_id WHERE q.id=$1",
          [quoteId],
        )
      ).rows[0];
      if (q?.customer_id !== customerId)
        throw new HttpError(422, "Select this customer’s approved quotation.");
      const site = (
        await c.query(
          "SELECT s.name,s.code FROM boq_revisions br JOIN boqs b ON b.id=br.boq_id JOIN sites s ON s.id=b.site_id WHERE br.id=$1",
          [q.boq_revision_id],
        )
      ).rows[0];
      const basis = await quotationBasis(
        this.pool,
        c,
        actor,
        { customer_id: customerId, site_name: site.name, site_code: site.code },
        quoteId,
      );
      const version = Number(
        (
          await c.query(
            "SELECT COALESCE(max(version),0)+1 AS n FROM project_framework_versions WHERE customer_id=$1 AND configuration_key=$2",
            [customerId, key],
          )
        ).rows[0].n,
      );
      const row = (
        await c.query(
          "INSERT INTO project_framework_versions(id,customer_id,configuration_key,version,payload,source_reference,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [
            randomUUID(),
            customerId,
            key,
            version,
            {
              type: "quotation",
              boq: basis.boq,
              orderSnapshot: basis.order,
              terms: basis.comparison.terms,
              routes: z
                .array(z.enum(["survey-framework", "direct-framework"]))
                .min(1)
                .parse(
                  input.routes ?? ["survey-framework", "direct-framework"],
                ),
            },
            source,
            actor,
          ],
        )
      ).rows[0];
      return row;
    });
  }
  async adopt(actor: string, input: any) {
    return transaction(this.pool, async (c) => {
      const u = await this.user(actor, c);
      this.requireRole(u, ["Coordinator"]);
      await c.query("SELECT pg_advisory_xact_lock(742019066)");
      const revisionId = uuid(input.boqRevisionId);
      const br = (
        await c.query(
          "SELECT br.*,b.customer_id,b.site_id,b.created_by,s.name,s.code,s.location FROM boq_revisions br JOIN boqs b ON b.id=br.boq_id JOIN sites s ON s.id=b.site_id WHERE br.id=$1",
          [revisionId],
        )
      ).rows[0];
      if (!br || (!management(u.role) && br.created_by !== actor))
        throw new HttpError(404, "BOQ not available to your account.");
      const old = (
        await c.query(
          "SELECT id FROM project_workflow_records WHERE customer_id=$1 AND lower(site_code)=lower($2) AND stage NOT IN('issued','declined')",
          [br.customer_id, br.code],
        )
      ).rows[0];
      if (old) return old;
      const draft = (
        await c.query(
          "SELECT draft_id FROM boq_draft_finalizations WHERE revision_id=$1",
          [revisionId],
        )
      ).rows[0];
      const id = randomUUID(),
        data = {
          draftId: draft?.draft_id,
          notes: "Existing commercial workflow retained",
          linkedBoqRevisionId: revisionId,
        };
      await c.query(
        "INSERT INTO project_workflow_records(id,customer_id,site_id,site_name,site_code,region,route,stage,coordinator_id,data,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,'quick-quote','design_handed_off',$7,$8,$9,$10)",
        [
          id,
          br.customer_id,
          br.site_id,
          br.name,
          br.code,
          br.location ?? "",
          br.created_by,
          data,
          randomUUID(),
          actor,
        ],
      );
      await c.query(
        "INSERT INTO project_workflow_events(id,record_id,version,action,snapshot,request_key,input_fingerprint,created_by) VALUES($1,$2,1,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          id,
          "Adopted existing workflow",
          { stage: "design_handed_off", data },
          randomUUID(),
          fingerprint(data),
          actor,
        ],
      );
      return { id };
    });
  }
  async performance(actor: string, department: string) {
    const u = await this.user(actor);
    this.requireRole(u, ["Design", "Coordinator"]);
    const rows = (
      await this.list(actor, department, management(u.role) ? "team" : "mine")
    ).records;
    const ids = rows.map((r: any) => r.id);
    const events = (
      await this.pool.query(
        "SELECT record_id,action,created_at,snapshot FROM project_workflow_events WHERE record_id=ANY($1::uuid[]) ORDER BY created_at",
        [ids],
      )
    ).rows;
    const byId = new Map<string, any[]>();
    for (const e of events)
      byId.set(e.record_id, [...(byId.get(e.record_id) ?? []), e]);
    const durations: number[] = [],
      firstPass: boolean[] = [];
    for (const ls of byId.values()) {
      const start = ls.find(
          (e) => e.action === (department === "design" ? "report" : "handoff"),
        ),
        end = ls.find(
          (e) =>
            e.action === (department === "design" ? "handoff" : "receipt") &&
            (!start || new Date(e.created_at) >= new Date(start.created_at)),
        );
      if (start && end)
        durations.push(
          (+new Date(end.created_at) - +new Date(start.created_at)) / 86400000,
        );
      if (end && (department === "design" || end.snapshot.stage === "issued"))
        firstPass.push(
          !ls.some(
            (e) =>
              ["technical-return", "commercial-return"].includes(e.action) &&
              (department === "design" ||
                new Date(e.created_at) <= new Date(end.created_at)) &&
              e.snapshot.data?.revisionCategory !== "Customer scope change",
          ),
        );
    }
    return {
      recordedHandoffs: events.filter((e) => e.action === "handoff").length,
      overdue: rows.filter((r: any) => r.overdue).length,
      averageTurnaroundDays: durations.length
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null,
      turnaroundObservations: durations.length,
      firstPassAcceptance: firstPass.length
        ? firstPass.filter(Boolean).length / firstPass.length
        : null,
      firstPassObservations: firstPass.length,
      revisionReasons: events
        .filter((e) =>
          [
            "technical-return",
            "commercial-return",
            "request-return",
            "undo",
          ].includes(e.action),
        )
        .map((e) => ({
          recordId: e.record_id,
          reason: e.snapshot.reason,
          category: e.snapshot.data?.revisionCategory ?? "Unclassified",
          date: e.created_at,
        })),
      timingNote:
        "Only recorded transitions are included. Imported history without timestamps is excluded.",
    };
  }
  async documentData(actor: string, id: string, documentId: string) {
    const { u, r } = await this.record(actor, id);
    const d = (
      await this.pool.query(
        "SELECT * FROM project_workflow_documents WHERE record_id=$1 AND id=$2",
        [id, documentId],
      )
    ).rows[0];
    if (!d) throw new HttpError(404, "Document unavailable.");
    return {
      ...d,
      customer: r.customer,
      site_name: r.site_name,
      site_code: r.site_code,
      snapshot: safeDocument(
        d.snapshot,
        u.restricted_cost_access ? "Admin" : "Restricted",
      ),
    };
  }
  async advanceInbox(actor: string) {
    const u = await this.user(actor);
    this.requireRole(u, ["Operations"]);
    const existing = (
      await this.pool.query(
        "SELECT p.record_id,p.mode,p.updated_at,p.confirmed_issuance_id,d.number,d.version,d.snapshot,r.customer_id,r.site_name,r.site_code,c.name AS customer_name,r.region,r.stage AS workflow_stage,e.stage AS operations_stage FROM project_advance_planning p JOIN project_workflow_documents d ON d.id=p.document_id JOIN project_workflow_records r ON r.id=p.record_id LEFT JOIN customers c ON c.id=r.customer_id LEFT JOIN site_workflow e ON e.issuance_id=p.confirmed_issuance_id WHERE ($2 OR p.operations_owner_id=$1) ORDER BY p.updated_at DESC",
        [actor, management(u.role)],
      )
    ).rows;
    const headsups = (
      await this.pool.query(
        "SELECT m.record_id,CASE WHEN final.operations_id IS NULL THEN 'Provisional' ELSE 'Heads-up shared — final received' END AS mode,h.created_at AS updated_at,final.operations_id AS confirmed_issuance_id,h.number,h.created_at AS headsup_created_at,1 AS version,jsonb_build_object('label',h.snapshot->>'label','authorization',h.snapshot->>'authorization','items',site->'items','site',r.site_name,'siteCode',r.site_code,'configuration',site->'solutionId','headsupReceiptId',h.receipt_id,'headsupGroup',h.number) AS snapshot,r.customer_id,r.site_name,r.site_code,c.name AS customer_name,r.region,r.stage AS workflow_stage,e.stage AS operations_stage FROM headsup_department_handoffs h JOIN headsup_advance_members m ON m.handoff_id=h.id JOIN project_workflow_records r ON r.id=m.record_id LEFT JOIN headsup_advance_final_links final ON final.record_id=m.record_id LEFT JOIN customers c ON c.id=r.customer_id LEFT JOIN site_workflow e ON e.issuance_id=final.operations_id JOIN LATERAL jsonb_array_elements(h.snapshot->'sites') site ON site->>'recordId'=m.record_id::text WHERE r.data->>'localPreviewArchived' IS DISTINCT FROM 'true' ORDER BY h.created_at DESC",
      )
    ).rows;
    for(const row of [...headsups,...existing]){
      const record=(await this.pool.query('SELECT data,short_code FROM project_workflow_records r JOIN customers c ON c.id=r.customer_id WHERE r.id=$1',[row.record_id])).rows[0];
      const lines=record?.data?.basis?.boq?.lines??[];
      if(row.snapshot.headsupGroup&&record?.short_code==='UBL'){
        // Pin the approved configuration version that existed when this forecast was sent.
        const framework=(await this.pool.query("SELECT id,version,source_reference,payload->'technical' AS technical FROM project_framework_versions WHERE customer_id=$1 AND configuration_key=$2 AND created_at<=$3 ORDER BY version DESC LIMIT 1",[row.customer_id,row.snapshot.configuration+':Revised',row.headsup_created_at])).rows[0];
        const technicalRows=framework?.technical?.rows??[];
        row.snapshot.items=approvedMaterialView(row.snapshot.items??[],technicalRows,lines);
        row.snapshot.approvedBoqSource=framework?{id:framework.id,version:framework.version,kind:'UBL approved pre-agreed BOQ',reference:framework.source_reference,filename:framework.technical?.source?.filename,configuration:row.snapshot.configuration,rows:technicalRows.map((r:any)=>({id:r.id,description:r.description,specification:r.specification,brands:r.brands}))}:null;
      }else{
        row.snapshot.items=approvedMaterialView(row.snapshot.items??[],[],lines);
        row.snapshot.approvedBoqSource={kind:'Customer approved BOQ',...record?.data?.basis?.source};
      }
    }
    return [...headsups, ...existing];
  }
}
