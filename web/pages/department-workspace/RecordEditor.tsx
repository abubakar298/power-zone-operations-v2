import { SurveyDispatchPlan, SurveySchedulePlan } from "./SurveyDispatch.js";
import { CreateRecord } from "./CreateRecord.js";
import { UblSurveyPackageActions, SurveyReportAttachments } from "./SurveyAttachments.js";
import { CustomerSurveySummary } from "./CustomerSurveyForm.js";
import { SurveyCompletion, SurveyReviewInputs, AwaitingSurveyRequests } from "./SurveyCompletion.js";
import { label, day, Action, Input, People, ApprovedQuoteSelect, FrameworkSelect } from "./parts.js";
import { QuickSurveyCableComparison, TechnicalReview } from "./TechnicalReview.js";
import { PoEntry, DifferenceTable } from "./PoEntry.js";
import { sentSurveyAwaitingDesign } from "../../../shared/sent-survey-requests.js";
import { IpoSharedPreview } from "../../components/IposSharedList.js";
import { InformationalTechnicalReport } from "../../components/InformationalTechnicalReport.js";
import { ConfirmSaleForm } from "../../components/ConfirmSaleForm.js";
import { ReadySendReview } from "../../components/ReadySendReview.js";
import { confirmLeaveWorkspace } from "../../hooks/useUnsavedChanges.js";
import { useState } from "react";
import { api, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { MiscItemsBoq } from "../procurement/MiscItemsBoq.js";
import { money } from "../../numbers.js";
import { designBuckets, coordinationBuckets } from "../../workspaces/project-routes.js";
import { confirmTransition } from "../../confirm.js";
import { Upload } from "./RecordUpload.js";
import { CoordinationTechnicalSummary } from "./CoordinationTechnicalSummary.js";

export function RecordEditor({
  page,
  saleReview,
  initialDirectPo,
  session,
  department,
  refs,
  detail,
  onOpen,
  action,
  refresh,
  onBack,
  records,
  onRequestOpen,
  onScheduled,
  onDispatched,
  onPackageSaved,
  showDocumentRegister = false,
}: any) {
  const [editingRequest, setEditingRequest] = useState(false);
  const r = detail.record,
    manager = ["Admin", "Management"].includes(session.user.role),
    design = department === "design",
    notes = (
      <label>
        Remarks / reason
        <textarea name="notes" required />
      </label>
    ),
    evidence = (kind: string) => (
      <label>
        {kind}
        <select name="evidenceId" required>
          <option value="">Select uploaded evidence</option>
          {detail.files
            .filter((f: any) => f.kind === kind)
            .map((f: any) => (
              <option key={f.id} value={f.id}>
                {f.filename}
              </option>
            ))}
        </select>
      </label>
    ),
    category = (
      <label>
        Revision category
        <select name="category" required>
          {[
            "Technical error",
            "Internal correction",
            "Customer scope change",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
    );
  const requestReview =
    !design &&
    ["request_review", "survey_requested"].includes(r.stage) &&
    !r.data.sentToDesignAt;
  const ublSurveyReview =
    !design &&
    r.route === "survey-framework" &&
    r.customerCode?.toUpperCase() === "UBL" &&
    r.coordinationBucket === coordinationBuckets[1] &&
    !!r.data.designHandoffAt;
  const designOutputReview =
    !design &&
    r.coordinationBucket === coordinationBuckets[1] &&
    !!r.data.designHandoffAt;
  if (!design && r.data.ipoShared)
    return <IpoSharedPreview record={r} onBack={onBack} session={session} onOpen={onOpen} />;
  if (
    !design &&
    saleReview &&
    (r.stage === "customer_tracking" || r.coordinationBucket === coordinationBuckets[5] || (r.stage === "po_receipt" && r.route === "direct-framework" && !r.data.originalOrderPreserved))
  )
    return <ConfirmSaleForm {...{ session, detail, action, onBack, initialDirectPo }} backLabel={r.route === "direct-framework" ? "Direct PO" : "Customer Follow-up"} />;
  if (!design && r.coordinationBucket === coordinationBuckets[4])
    return (
      <ReadySendReview session={session} record={r} onBack={onBack}>
        <Upload
          session={session}
          id={r.id}
          onSaved={refresh}
          initialKind="Recommendation sending evidence"
          dispatchEvidence
        />
        <Action
          title="Dispatch Approved Quotation"
          onSubmit={(f) =>
            action("dispatch", {
              via: f.get("via"),
              recipient: f.get("recipient"),
              evidenceId: f.get("evidenceId"),
              notes: f.get("notes"),
            })
          }
        >
          <div className="pz-form-grid">
            <label>
              Sent to
              <select name="via">
                <option>Customer</option>
                <option>Sales</option>
              </select>
            </label>
            <Input
              name="recipient"
              title="Customer / salesperson recipient"
              required
            />
            {evidence("Recommendation sending evidence")}
          </div>
          {notes}
        </Action>
      </ReadySendReview>
    );
  if (design && r.designBucket === designBuckets[3])
    return (
      <div className="pz-stack">
        <div className="pz-action-row">
          <Button variant="neutral" onClick={onBack}>
            Back to Sent to Coordination
          </Button>
        </div>
        <section className="pz-panel">
          <h2>
            {r.customerCode} · {r.site} ({r.siteCode})
          </h2>
          <p>Submitted to Coordination · Preview only</p>
          <CoordinationTechnicalSummary session={session} detail={detail} />
        </section>
        <MiscItemsBoq session={session} recordId={r.id} />
      </div>
    );
  if (
    !design && !requestReview &&
    ([
      "survey_requested",
      "survey_scheduled",
      "report_received",
      "technical_review",
      "technical_revision",
      "management_review",
      "order_exception",
    ].includes(r.stage) ||
      r.quotation?.status === "Submitted")
  )
    return (
      <div className="pz-stack">
        <div className="pz-action-row">
          <Button variant="neutral" onClick={onBack}>
            Back to workspace
          </Button>
        </div>
        <section className="pz-panel">
          <h2>
            {r.customerCode} · {r.site} ({r.siteCode})
          </h2>
          <p>
            Submitted to{" "}
            {["management_review", "order_exception"].includes(r.stage) ||
            r.quotation?.status === "Submitted"
              ? "Management"
              : "Design"}{" "}
            · Preview only
          </p>
          {r.data.designHandoffAt && (
            <CoordinationTechnicalSummary session={session} detail={detail} />
          )}
        </section>
        {sentSurveyAwaitingDesign(r)&&<SentSurveyQuotation session={session} record={r} onOpen={onOpen}/>}
        {manager && r.stage !== "survey_requested" && <MiscItemsBoq session={session} recordId={r.id} />}
      </div>
    );
  if (editingRequest)
    return (
      <CreateRecord
        refs={refs}
        session={session}
        creating="Create survey request"
        manager={manager}
        selectedSite={detail.masterReview.site}
        existingRequest={detail}
        onCancel={() => {
          if (confirmLeaveWorkspace()) setEditingRequest(false);
        }}
        onEdited={async (payload: any) => {
          await action("edit-request", payload);
          setEditingRequest(false);
        }}
        onCreated={refresh}
      />
    );
  return (
    <div className="pz-stack">
      <div className="pz-action-row">
        <Button onClick={onBack}>Back to workspace</Button>
      </div>
      {!requestReview && (
        <section className="pz-panel">
          <h2>
            {r.customerCode} · {r.site} ({r.siteCode})
          </h2>
          <p>
            {r.routeLabel} · {label(r.stage)} · v{r.version}
          </p>
          <p>
            Responsible: {r.person} · Coordination:{" "}
            {refs.people.find((p: any) => p.id === r.coordinatorId)
              ?.display_name ?? "Not available"}
          </p>
          {r.blocker && <p className="form-error">{r.blocker}</p>}
          {r.data.ublStandardsReview?.needsReview && <p className="pz-survey-difference"><strong>Needs Review — UBL standards deviation</strong><br />{r.data.ublStandardsReview.message}</p>}
          {r.data.noFeasibleSolution && (
            <div className="pz-panel">
              <h3>Needs Review — No Feasible Solution</h3>
              <p>{r.data.noFeasibleSolution.remarks}</p>
            </div>
          )}
          {r.data.customerConfigurationChange&&<section className="pz-panel pz-stack" aria-label="Customer-requested UBL configuration change"><h3>Customer-requested configuration change</h3><p>{r.data.customerConfigurationChange.recommended.source.key} → {r.data.customerConfigurationChange.ordered.source.key}</p><div className="pz-form-grid"><div><strong>Recommended selling total</strong><p>{money(r.data.customerConfigurationChange.recommended.total)}</p></div><div><strong>Customer PO selling total</strong><p>{money(r.data.customerConfigurationChange.ordered.total)}</p></div><div><strong>Difference</strong><p>{money(r.data.customerConfigurationChange.sellingDifference)}</p></div></div><p>PO: {r.data.customerConfigurationChange.poReference} · {r.data.customerConfigurationChange.reason}</p><p className="pz-caption">Existing approved UBL configuration and rates. Management notification only; IPO issuance is not awaiting a new approval. The original survey and recommendation remain in history.</p></section>}
          <p>{r.data.notes}</p>
          {r.route.startsWith("survey") && (
            <p className="pz-caption">
              {r.data.sentToDesignAt
                ? `Sent to Design: ${new Date(r.data.sentToDesignAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })} · Recorded automatically`
                : r.stage === "request_review"
                  ? "Awaiting Atif's verification and sending to Design"
                  : "Design handoff date not recorded in this earlier request"}
            </p>
          )}
          <dl className="project-facts">
            <div>
              <dt>Site address</dt>
              <dd>{r.data.siteAddress || "Not entered"}</dd>
            </div>
            <div>
              <dt>Site contact person</dt>
              <dd>{r.data.siteContact || "Not entered"}</dd>
            </div>
            <div>
              <dt>Site contact number</dt>
              <dd>{r.data.sitePhone || "Not entered"}</dd>
            </div>
          </dl>
          {!design && r.data.designHandoffAt && (
            <CoordinationTechnicalSummary {...{ session, detail }} />
          )}
          {!design&&r.route==='survey-quote'&&r.stage==='design_handed_off'&&<InformationalTechnicalReport detail={detail} session={session} onSent={refresh}/>}
        </section>
      )}
      {ublSurveyReview && (
        <UblSurveyPackageActions
          {...{ session, records }}
          record={r}
          onSaved={onPackageSaved}
        />
      )}
      {!design &&
        r.data.ublSurveyPackageId &&
        r.stage === "management_review" && (
          <section className="pz-panel">
            <h2>Submitted UBL Survey Package</h2>
            <p>
              Survey review has been sent to Management with its report and
              Excel workbook.
            </p>
            <div className="pz-action-row">
              <a
                href={`/api/project-workflow/ubl-survey-packages/${r.data.ublSurveyPackageId}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Review Report
              </a>
              <a
                href={`/api/project-workflow/ubl-survey-packages/${r.data.ublSurveyPackageId}/xlsx`}
              >
                Download UBL Excel
              </a>
            </div>
          </section>
        )}

      {!design &&
        ["request_review", "survey_requested"].includes(r.stage) &&
        !r.data.sentToDesignAt &&
        detail.masterReview && (
          <Action
            title="Review & Send to Design"
            onSubmit={(f) =>
              action("send-design", {
                customerVerified: f.has("customerVerified"),
                siteVerified: f.has("siteVerified"),
                customerVersion: detail.masterReview.customer.version,
                siteVersion: detail.masterReview.site.version,
              })
            }
          >
            <h3>
              {r.data.customerAddedHere
                ? "New customer added to master database"
                : "Existing customer — verify master details"}
            </h3>
            <dl className="project-facts">
              {[
                ["Customer", detail.masterReview.customer.name],
                ["Short code", detail.masterReview.customer.short_code],
                ["Contact person", detail.masterReview.customer.contact_person],
                ["Contact number", detail.masterReview.customer.phone],
                ["Email", detail.masterReview.customer.email],
                ["Billing address", detail.masterReview.customer.address],
              ].map(([title, value]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{value || "Not entered"}</dd>
                </div>
              ))}
            </dl>
            <h3>
              {r.data.siteCreatedHere
                ? "New site added to customer"
                : "Existing site — verify master details"}
            </h3>
            <dl className="project-facts">
              {[
                ["Site", detail.masterReview.site.name],
                ["Site / branch code", detail.masterReview.site.code],
                ["Region", detail.masterReview.site.region],
                ["Site address", detail.masterReview.site.location],
                [
                  "Site contact person",
                  detail.masterReview.site.contact_person,
                ],
                ["Site contact number", detail.masterReview.site.contact_phone],
              ].map(([title, value]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{value || "Not entered"}</dd>
                </div>
              ))}
            </dl>
            <label className="pz-review-check">
              <input type="checkbox" name="customerVerified" required />I have
              verified the customer details saved in the master database.
            </label>
            <label className="pz-review-check">
              <input type="checkbox" name="siteVerified" required />I have
              verified the site details and contact information saved in the
              master database.
            </label>
            <p>
              <strong>Request / notes:</strong> {r.data.notes}
            </p>
            <Upload
              session={session}
              id={r.id}
              onSaved={refresh}
              initialKind="Request evidence"
              files={detail.files}
              removableRequestFiles
            />
            <p className="pz-caption">
              {detail.files.some(
                (file: any) => file.kind === "Request evidence",
              )
                ? "Uploaded request evidence will be included automatically when sent to Design."
                : "Attach the request evidence above before sending to Design."}
            </p>
            <p className="pz-caption">
              Sending saves the verified details and source reference, records
              the handoff time, and places the request in Design's scheduling
              bucket.
            </p>
          </Action>
        )}
      {design &&
        ["survey_requested", "survey_scheduled"].includes(r.stage) &&
        !r.data.surveyDispatchId &&
        !r.data.surveyInProgress && (
          <>
            <SurveySchedulePlan
              key={`schedule-${r.id}-${r.version}`}
              session={session}
              refs={refs}
              detail={detail}
              onScheduled={onScheduled}
            />
            {r.stage === "survey_requested" ? (
              <section className="pz-panel pz-stack">
                <h3>Create / Assign Dispatch</h3>
                <p>
                  Save the scheduled date and surveyors above first. Dispatch is
                  reviewed and approved separately in this module.
                </p>
                <Button variant="primary" disabled>
                  Review Dispatch
                </Button>
              </section>
            ) : (
              <SurveyDispatchPlan
                key={`dispatch-${r.id}-${r.version}`}
                embedded
                session={session}
                refs={refs}
                records={records}
                initialId={r.id}
                onAssigned={onDispatched}
              />
            )}
          </>
        )}
      {design && r.stage === "survey_scheduled" && r.data.surveyDispatchId && (
        <>
          <SurveyReportAttachments
            session={session}
            id={r.id}
            record={r}
            files={detail.files}
            onSaved={refresh}
          />
          <SurveyCompletion
            session={session}
            refs={refs}
            detail={detail}
            action={action}
          />
        </>
      )}
      {design &&
        ["report_received", "technical_review", "technical_revision"].includes(
          r.stage,
        ) && <SurveyReviewInputs {...{ session, refs, detail, action }} />}
      {!design && r.data.noFeasibleSolution && (
        <>
          <SurveyReviewInputs
            {...{ session, refs, detail, action }}
            canEdit={false}
          />
          <CustomerSurveySummary refs={refs} detail={detail} />
        </>
      )}
      {design &&
        ["report_received", "technical_review", "technical_revision"].includes(
          r.stage,
        ) && <CustomerSurveySummary refs={refs} detail={detail} />}
      {design &&
        ["report_received", "technical_review", "technical_revision"].includes(
          r.stage,
        ) &&
        !(
          r.customerCode?.toUpperCase() === "UBL" &&
          r.route === "survey-framework"
        ) && <QuickSurveyCableComparison {...{ session, detail }} />}
      {design &&
        ["report_received", "technical_review", "technical_revision"].includes(
          r.stage,
        ) && <TechnicalReview {...{ session, refs, detail, action }} />}
      {(design || manager) &&
        r.stage !== "declined" &&
        !["request_review", "survey_requested"].includes(r.stage) &&
        !(r.stage === "survey_scheduled" && !r.data.surveyDispatchId) && (
          <MiscItemsBoq session={session} recordId={r.id} />
        )}
      {!design &&
        r.task &&
        !designOutputReview &&
        r.coordinationBucket !== coordinationBuckets[3] && (
          <section className="pz-panel">
            <h3>BOQ, commercial pricing and quotation</h3>
            <Button variant="primary" onClick={() => onOpen?.(r.task)}>
              Open current {r.task.target}
            </Button>
            <p>
              Use the existing calculation and approval flow. Return here after
              approval for dispatch or PO comparison.
            </p>
          </section>
        )}
      {!design && r.coordinationBucket === coordinationBuckets[4] && (
        <Action
          title="Dispatch Approved Quotation"
          onSubmit={(f) =>
            action("dispatch", {
              via: f.get("via"),
              recipient: f.get("recipient"),
              evidenceId: f.get("evidenceId"),
              notes: f.get("notes"),
            })
          }
        >
          <div className="pz-form-grid">
            <label>
              Sent to
              <select name="via">
                <option>Customer</option>
                <option>Sales</option>
              </select>
            </label>
            <Input
              name="recipient"
              title="Customer / salesperson recipient"
              required
            />
            {evidence("Recommendation sending evidence")}
          </div>
          {notes}
        </Action>
      )}
      {!design &&
        r.data.dispatchVia === "Sales" &&
        !r.data.salesSendConfirmed &&
        r.stage === "customer_tracking" && (
          <Action
            title="Record Sales customer sending evidence"
            onSubmit={(f) =>
              action("decision", {
                outcome: "Sales confirmed customer dispatch",
                evidenceId: f.get("evidenceId"),
                notes: f.get("notes"),
              })
            }
          >
            <p>
              Record the sending evidence supplied by Sales. The original
              handoff remains in history.
            </p>
            {evidence("Recommendation sending evidence")}
            {notes}
          </Action>
        )}
      {!design && ["customer_tracking", "deferred"].includes(r.stage) && (
        <Action
          title="Record customer decision"
          onSubmit={(f) =>
            action("decision", {
              outcome: f.get("outcome"),
              notes: f.get("notes"),
            })
          }
        >
          <label>
            Decision
            <select name="outcome">
              {[
                "Awaiting response",
                "Accepted—awaiting PO",
                "Deferred",
                "Declined",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {notes}
        </Action>
      )}
      {!design &&
        !designOutputReview &&
        ![
          "request_review",
          "survey_requested",
          "survey_scheduled",
          "report_received",
          "technical_review",
          "technical_revision",
          "issued",
          "order_exception",
        ].includes(r.stage) && (
          <>
            {r.stage === "advance_pending" && (
              <Action
                title="Complete & Send — advance preparation BOQ"
                onSubmit={(f) =>
                  action("advance", {
                    recipientId: f.get("recipientId"),
                    date: f.get("date") || undefined,
                    deliveryAddress: f.get("deliveryAddress"),
                    siteContact: f.get("siteContact"),
                    sitePhone: f.get("sitePhone"),
                    notes: f.get("notes"),
                  })
                }
              >
                <p>
                  Material forecast for advance preparation. This does not issue
                  a confirmed order or authorise physical dispatch.
                </p>
                <div className="pz-form-grid">
                  <People
                    refs={refs}
                    role="Operations"
                    name="recipientId"
                    title="Planning recipient"
                  />
                  <Input
                    name="date"
                    title="Expected PO / preparation date"
                    type="date"
                  />
                  <Input
                    name="deliveryAddress"
                    title="Delivery address (if known)"
                  />
                  <Input name="siteContact" title="Site contact (if known)" />
                  <Input
                    name="sitePhone"
                    title="Site contact number (if known)"
                  />
                </div>
                {notes}
              </Action>
            )}
          </>
        )}
      {!design &&
        saleReview &&
        ![
          "request_review",
          "survey_requested",
          "survey_scheduled",
          "report_received",
          "technical_review",
          "technical_revision",
          "issued",
          "order_exception",
        ].includes(r.stage) && (
          <PoEntry {...{ session, refs, detail, action }} />
        )}
      {!design && r.stage === "order_exception" && (
        <section className="pz-panel">
          <h3>PO mismatch — Management review</h3>
          <p>
            Source: {detail.receipt?.basisSource?.key} · v
            {detail.receipt?.basisSource?.version}
          </p>
          <DifferenceTable differences={detail.receipt?.differences ?? []} />
          {manager ? (
            <Action
              title="Resolve exception and issue matched documents"
              onSubmit={(f) =>
                action("resolve", {
                  quotationId: f.get("quotationId") || undefined,
                  frameworkId: f.get("frameworkId") || undefined,
                  authoriseTermsException: f.has("authoriseTermsException"),
                  returnForRevision: f.has("returnForRevision"),
                  notes: f.get("notes"),
                })
              }
            >
              <p>
                Financial or scope differences need a revised approved basis. A
                reason alone cannot overwrite the approved amounts.
              </p>
              {!r.route.endsWith("framework") && (
                <ApprovedQuoteSelect refs={refs} r={r} optional />
              )}
              {r.route.endsWith("framework") && (
                <FrameworkSelect refs={refs} r={r} optional />
              )}
              <label>
                <input type="checkbox" name="authoriseTermsException" />{" "}
                Authorise a terms-only exception
              </label>
              <label>
                <input type="checkbox" name="returnForRevision" /> Return to
                Coordination for revision
              </label>
              {notes}
            </Action>
          ) : (
            <p>
              Waiting for Management’s decision. No IPO or confirmed BOQ has
              been issued.
            </p>
          )}
        </section>
      )}
      {design &&
        ["survey_requested", "survey_scheduled", "report_received"].includes(
          r.stage,
        ) && (
          <Action
            title="Return request to Coordination"
            onSubmit={(f) =>
              action("request-return", {
                notes: f.get("notes"),
                category: f.get("category"),
              })
            }
          >
            {category}
            {notes}
          </Action>
        )}
      {!design && r.stage === "issued" && (
        <section className="pz-panel">
          <h3>Issued documents</h3>
          <p>
            {r.data.amendmentId
              ? `Revised PO linked to ${r.data.originalIpoReference} and delivered to Accounts. The original financial documents and material demand remain preserved.`
              : "IPO delivered to Accounts and confirmed BOQ delivered to Operations. Their document history is preserved."}
          </p>
          {r.data.amendmentId && (
            <a
              href={`/api/project-workflow/${r.id}/documents/${r.data.amendmentId}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Open revised PO amendment
            </a>
          )}
          {r.data.ipoId && (
            <div className="pz-action-row">
              <a
                href={`/api/orders/${r.data.ipoId}/ipo.pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Open IPO
              </a>
              <a
                href={`/api/orders/${r.data.ipoId}/peachtree.pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Open PT breakup
              </a>
            </div>
          )}
        </section>
      )}
      {!design &&
        !requestReview &&
        !["request_review", "issued", "order_exception"].includes(r.stage) && (
          <Action
            title="Return for technical revision"
            onSubmit={(f) =>
              action("technical-return", {
                notes: f.get("notes"),
                category: f.get("category"),
              })
            }
          >
            {category}
            {notes}
          </Action>
        )}
      {!design && ["commercial_revision", "deferred"].includes(r.stage) && (
        <Action
          title="Resume corrected work"
          onSubmit={(f) => action("resume", { notes: f.get("notes") })}
        >
          {notes}
        </Action>
      )}
      {r.stage === "request_review" && (
        <section className="pz-panel">
          <h3>Move Back / Edit Request</h3>
          <p>
            Reopen the entered request to adjust its customer, site details or
            notes before sending to Design.
          </p>
          <Button
            variant="neutral"
            onClick={() => {
              if (confirmLeaveWorkspace()) setEditingRequest(true);
            }}
          >
            Move Back / Edit Request
          </Button>
        </section>
      )}
      {!requestReview && !["issued", "order_exception"].includes(r.stage) && (
        <Action
          title="Move Back / Undo internal handoff"
          onSubmit={async (f) => {
            const previous = [...detail.events]
              .reverse()
              .find(
                (event: any) =>
                  event.version < r.version &&
                  event.stage &&
                  event.stage !== r.stage,
              );
            if (!previous)
              throw new Error(
                "No earlier workflow stage is available to undo.",
              );
            const from = design
              ? r.stage === "survey_scheduled" && !r.data.surveyDispatchId
                ? "Schedule saved — Awaiting Dispatch"
                : r.designBucket
              : label(r.stage);
            const to =
              previous.stage === "request_review"
                ? "Atif — Survey Requests Awaiting Review"
                : previous.stage === "survey_requested"
                  ? "Design — Survey Requests Awaiting Scheduling"
                  : label(previous.stage);
            if (
              !confirmTransition(
                "Undo this handoff",
                `${r.customerCode} · ${r.site} (${r.siteCode})\n\nFrom: ${from}\nTo: ${to}\n\nReason: ${String(f.get("notes"))}\nSaved documents and history will be preserved.`,
              )
            )
              return false;
            await action("undo", {
              notes: f.get("notes"),
              category: f.get("category"),
              targetStage: previous.stage,
            });
          }}
        >
          <p>
            Available only before downstream work starts. A controlled return is
            required once documents have been issued or dispatched.
          </p>
          {category}
          {notes}
        </Action>
      )}
      {!design && showDocumentRegister && !ublSurveyReview && (
        <>
          <section className="pz-panel">
            <h3>Documents & evidence</h3>
            {detail.files
              .filter(
                (file: any) => !design || file.kind !== "Request evidence",
              )
              .map((f: any) => (
                <p key={f.id}>
                  <a
                    href={`/api/project-workflow/${r.id}/files/${f.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {f.kind} · {f.filename}
                  </a>
                </p>
              ))}
            {detail.documents.map((d: any) => (
              <p key={d.id}>
                <a
                  href={`/api/project-workflow/${r.id}/documents/${d.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {d.kind} · {d.number} · v{d.version}
                </a>
              </p>
            ))}
            {detail.legacy?.attachments.map((f: any) => (
              <p key={f.id}>
                <a
                  href={`/api/ubl-workflow/attachments/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Original {f.kind} · {f.filename}
                </a>
              </p>
            ))}
          </section>
          <section className="pz-panel">
            <h3>Immutable transition history</h3>
            <div className="pz-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Action</th>
                    <th>By / date</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.events.map((e: any) => (
                    <tr key={e.id}>
                      <td>{e.version}</td>
                      <td>{e.action}</td>
                      <td>
                        {e.actor}
                        <br />
                        {day(e.created_at)}
                      </td>
                      <td>{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {designOutputReview &&
        !ublSurveyReview &&
        !r.data.noFeasibleSolution &&
        r.task && (
          <div className="pz-action-row">
            <Button
              variant="primary"
              onClick={() =>
                onOpen?.({
                  target: "newboq",
                  id: r.id,
                  kind: "Create quotation",
                  context: {
                    ...(detail.review?.survey ?? r.data.surveyInputs ?? {}),
                    brands: {},
                    preparedBy: session.user.displayName,
                    workflowRecordId: r.id,
                    family:
                      detail.review?.survey?.family ??
                      r.data.surveyInputs?.family,
                    customerId: r.customerId,
                    siteName: r.site,
                    siteCode: r.siteCode,
                    location:
                      detail.masterReview.site.location ??
                      r.data.siteAddress ??
                      "",
                  },
                })
              }
            >
              Create Quotation
            </Button>
          </div>
        )}
      {design && ["survey_requested", "survey_scheduled"].includes(r.stage) && (
        <AwaitingSurveyRequests records={records} onOpen={onRequestOpen} />
      )}
    </div>
  );
}
export function SentSurveyQuotation({session,record,onOpen}:{session:Session;record:any;onOpen?:(task:any)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function prepare(){if(busy)return;setBusy(true);setError('');try{const result=await api<any>(`/project-workflow/${record.id}/prepare-sent-quotation`,{csrf:session.csrfToken,body:{version:record.version}});onOpen?.({...result.task,...(!result.task?{draft_id:result.draftId,kind:'Survey / BOQ'}:{}),target:!result.task||result.task.target==='boqs'?'newboq':result.task.target,workflow_id:result.recordId});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="pz-panel"><h3>Sent survey request</h3><p>Awaiting Design. Prepare your own BOQ and quotation for this site while the survey remains pending.</p><Button variant="primary" loading={busy} onClick={()=>void prepare()}>{record.data.sentQuotationDraftId?'Open BOQ / Quotation':'Create BOQ / Quotation'}</Button>{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}
