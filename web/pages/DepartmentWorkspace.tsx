import { SurveyDispatchPlan, DispatchViewer, SurveySchedulePlan } from "./department-workspace/SurveyDispatch.js";
import { CreateRecord } from "./department-workspace/CreateRecord.js";
import { SurveySubmissionGroups, UblSurveyPackageActions, SurveyReportAttachments } from "./department-workspace/SurveyAttachments.js";
import { CustomerSurveySummary } from "./department-workspace/CustomerSurveyForm.js";
import { SurveyCompletion, SurveyReviewInputs, AwaitingSurveyRequests } from "./department-workspace/SurveyCompletion.js";
import { ErrorText, label, day, Action, Input, People, ApprovedQuoteSelect, FrameworkSelect } from "./department-workspace/parts.js";
import { QuickSurveyCableComparison, TechnicalReview, CableQuantityComparison } from "./department-workspace/TechnicalReview.js";
import { FrameworkEditor, PoEntry, DifferenceTable } from "./department-workspace/PoEntry.js";
import {ApprovedConfigurationBatch} from '../components/ApprovedConfigurationBatch.js';
import {useBackStep} from '../navigation/useBackStep.js';
import {sharedDepartmentList,workflowReferences} from '../workspaces/workflow-list-reuse.js';
import {recentFirst} from '../../shared/recent-records.js';
import {PagedTableBody} from '../ui/PagedTableBody.js';
import {CustomerSiteRegister} from '../components/CustomerSiteRegister.js';
import './department-lists.css';
import {sentSurveyAwaitingDesign,surveyRequestInCoordination} from '../../shared/sent-survey-requests.js';
import {UblTechnicalReviewSummary} from '../components/UblTechnicalReviewSummary.js';
import {FileUpload} from '../ui/FileUpload.js';
import {DocumentListDetails} from '../components/DocumentListDetails.js';
import {DirectPo} from "../components/DirectPoUpload.js";
import { IposSharedList, IpoSharedPreview } from "../components/IposSharedList.js";
import {QuotationApproval} from "../components/QuotationApproval.js";
import {SiteCodeUpdate} from "../components/SiteCodeUpdate.js";
import {EditCustomer} from '../components/EditCustomer.js';
import {InformationalTechnicalReport} from '../components/InformationalTechnicalReport.js';
import {CoordinatorQuotationReview} from "../components/CoordinatorQuotationReview.js";
import { CustomerFollowupList } from "../components/CustomerFollowupList.js";
import { ConfirmSaleForm } from "../components/ConfirmSaleForm.js";
import { followupGroups, isCustomerFollowup } from "../workspaces/followup-groups.js";
import {
  RecordHeadsup,
  SavedHeadsupReports,
} from "../components/RecordHeadsup.js";
import {
  ReadySendGroups,
  ReadySendReview,
} from "../components/ReadySendReview.js";
import { solutionValues } from "../../server/boq/solution-identity.js";
import { RevisionEntry } from "../components/RevisionEntry.js";
import { bucketCounts } from "../workspaces/bucket-counts.js";
import { Decimal } from "decimal.js";
import { coordinationBucket as legacyBucket } from "../workspaces/tasks.js";
import { confirmLeaveWorkspace } from "../hooks/useUnsavedChanges.js";
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { MiscItemsBoq } from "./procurement/MiscItemsBoq.js";
import { money, decimalDisplay } from "../numbers.js";
import {
  WorkspaceFilters,
  emptyWorkspaceFilters,
  matchesWorkspace,
} from "../components/WorkspaceFilters.js";
import { bucketLabel, designBuckets, coordinationBuckets, visibleCoordinationBuckets, iposSharedBucket } from "../workspaces/project-routes.js";
import { confirmTransition } from "../confirm.js";const followupPage = coordinationBuckets[5];
const oldPoReceiptPage = coordinationBuckets[6];
const directPoPage = "Direct PO";
const currentCoordinationPage = (page: string) => page === oldPoReceiptPage ? followupPage : page;
const isDirectPoDraft = (record: any) =>
  record.route === "direct-framework" && record.stage === "po_receipt" && !record.data.originalOrderPreserved;

export function DepartmentWorkspace({
  session,
  department,
  onOpen,
}: {
  session: Session;
  department: "design" | "coordination";
  onOpen?: (task: any) => void;
}) {
  const [refs, setRefs] = useState<any>(),
    [rows, setRows] = useState<any[]>([]),
    [legacy, setLegacy] = useState<any[]>([]),
    [error, setError] = useState(""),
    [page, setPage] = useState(() => {
      const requested = new URLSearchParams(location.hash.slice(1)).get("page") || "Workspace";
      return department === "coordination" ? currentCoordinationPage(requested) : "Workspace";
    }),
    [detail, setDetail] = useState<any>(),
    [saleReview, setSaleReview] = useState(false),
    [directPoDraft,setDirectPoDraft]=useState<any>(),
    [filters, setFilters] = useState({ ...emptyWorkspaceFilters }),
    [creating, setCreating] = useState<string>(),
    [performance, setPerformance] = useState<any>(),
    [notice, setNotice] = useState("");
  const [headsupRefresh, setHeadsupRefresh] = useState(0);
  const [siteCodeTarget,setSiteCodeTarget]=useState<any>();
  const [customerEditId,setCustomerEditId]=useState<number>();
  const [quotationReview, setQuotationReview] = useState<any>();
  const [approvalTarget,setApprovalTarget]=useState<any>();
  async function approvalRecorded(){setApprovalTarget(undefined);setQuotationReview(undefined);await load();window.dispatchEvent(new CustomEvent("pz:workflow-completed",{detail:{message:"Approval recorded — moved to Ready to Send."}}));}
  const [revisionRecord, setRevisionRecord] = useState<any>();
  const [selectedSite, setSelectedSite] = useState<any>();
  const [selectedDispatch, setSelectedDispatch] = useState<string>();
  const [dispatchPlanning, setDispatchPlanning] = useState(false);
  const [showUblSummary,setShowUblSummary]=useState(false);
  const [submissionGroups, setSubmissionGroups] = useState<any[]>([]);
  const [groupActionError, setGroupActionError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [removingGroupSite, setRemovingGroupSite] = useState<string | null>(
    null,
  );
  // An opened record is a Back step: Back returns to the list.
  useBackStep(!!detail,()=>{if(!confirmLeaveWorkspace())return;setDetail(undefined);setNotice("");});
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("pz:department-active", { detail: page }),
    );
    if (page !== "Workspace") setFilters((f) => ({ ...f, period: "all" }));
  }, [page]);
  const manager = ["Admin", "Management"].includes(session.user.role),
    buckets =
      department === "design" ? designBuckets : visibleCoordinationBuckets,
    scopeDefault = manager ? "team" : "mine";
  const [scope, setScope] = useState(scopeDefault);
  // `share` only when the page opens: it may join the sidebar's request already on its way. After any
  // save or action the list is always requested fresh, so it never shows the state before the change.
  async function load(share = false) {
    const r = share
      ? await sharedDepartmentList<any>(department, scope, {takeLeft: true})
      : await api<any>(`/project-workflow?department=${department}&scope=${scope}`);
    setRows(r.records);
    setLegacy(r.legacyTasks);
    window.dispatchEvent(
      new CustomEvent("pz:bucket-records", {
        detail: {
          department,
          scope,
          records: r.records,
          legacyTasks: r.legacyTasks,
        },
      }),
    );
    if (department === "coordination") {
      const groups = await api<any>(
        "/project-workflow/survey-submission-groups",
      );
      setSubmissionGroups(groups.groups);
    }
  }
  async function openRevision(record: any) {
    if (!confirmLeaveWorkspace()) return;
    setError("");
    try {
      const revisionDetail = record.sourceQuotationId
        ? undefined
        : await api<any>(`/project-workflow/${record.id}`);
      setRevisionRecord({ ...record, ...revisionDetail?.record, revisionDetail });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function removeFromGroup(record: any) {
    if (
      !window.confirm(
        `Remove ${record.siteCode} · ${record.site} from its Survey Submission Group? It will be unlocked and its action will return to Review.`,
      )
    )
      return;
    setGroupActionError(null);
    setRemovingGroupSite(record.id);
    try {
      await api(`/project-workflow/${record.id}/remove-from-survey-group`, {
        csrf: session.csrfToken,
        body: {
          groupId: record.data.surveySubmissionGroupId,
          version: record.version,
          confirmed: true,
        },
      });
      await load();
    } catch (e) {
      setGroupActionError({ id: record.id, message: (e as Error).message });
    } finally {
      setRemovingGroupSite(null);
    }
  }
  async function unbindApproved(record: any) {
    if (
      !window.confirm(
        `Unbind ${record.siteCode} from its approved survey group? The original Management approval is retained and this site can be reviewed individually.`,
      )
    )
      return;
    setGroupActionError(null);
    try {
      await api(`/project-workflow/${record.id}/unbind-approved-survey`, {
        csrf: session.csrfToken,
        body: { version: record.version, confirmed: true },
      });
      await load();
    } catch (e) {
      setGroupActionError({ id: record.id, message: (e as Error).message });
    }
  }
  async function open(id: string, checkChanges = true, confirmSale = false, quotationId?: string) {
    if (checkChanges && !confirmLeaveWorkspace()) return;
    setError("");
    setCreating(undefined);
    const loaded = await api<any>(`/project-workflow/${id}`);
    const record = loaded.record;
    if (quotationId && record.quotation?.id !== quotationId)
      throw new Error("The active site workflow is linked to a different quotation. Open that site's current record to confirm the sale.");
    const directDraft = isDirectPoDraft(record);
    if (!confirmSale && !directDraft && department === "coordination" &&
        [coordinationBuckets[2], followupPage].includes(page) && record.quotation?.id) {
      setQuotationReview({...record, followupPreview:page===followupPage});
      return;
    }
    setSaleReview(confirmSale || directDraft);
    setDetail(loaded);
    setPage(
      department === "design"
        ? record.designBucket
        : directDraft
          ? directPoPage
          : confirmSale
            ? followupPage
            : currentCoordinationPage(record.coordinationBucket),
    );
  }
  async function confirmFollowupSale(record: any) {
    if (!confirmLeaveWorkspace()) return;
    try {
      if (!record.legacyTask) {
        await open(record.id, false, true);
        return;
      }
      const task = record.legacyTask;
      const cabinet = task.kind === "C&I proposal";
      const adopted = await api<any>(cabinet ? "/project-workflow/adopt-cabinet" : "/project-workflow/adopt", {
        csrf: session.csrfToken,
        body: cabinet ? {proposalId: task.id} : {boqRevisionId: task.boq_revision_id},
      });
      await load();
      await open(adopted.id, false, true, cabinet ? undefined : task.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void Promise.all([workflowReferences(session.user.id), load(true)])
      .then(async ([r]) => {
        setRefs(r);
        const pending = sessionStorage.getItem("pz:workflow-open");
        if (pending) {
          sessionStorage.removeItem("pz:workflow-open");
          await open(pending);
        }
      })
      .catch((e) => setError(e.message));
    const pendingPage = sessionStorage.getItem("pz:department-page");
    if (pendingPage) {
      setPage(currentCoordinationPage(pendingPage));
      sessionStorage.removeItem("pz:department-page");
    }
    const reload = () => {
      void Promise.all([workflowReferences(session.user.id), load(true)])
        .then(([r]) => setRefs(r))
        .catch((e) => setError(e.message));
    };
    window.addEventListener("pz:workspace-open", reload);
    const handle = (e: any) => {
      if (!confirmLeaveWorkspace()) return;
      sessionStorage.removeItem("pz:department-page");
      setShowUblSummary(false);
      setDetail(undefined);
      setRevisionRecord(undefined);
      setQuotationReview(undefined);
      setCreating(undefined);
      setSelectedDispatch(undefined);
      setDispatchPlanning(false);
      setPage(currentCoordinationPage(e.detail ?? 'Workspace'));
    };
    window.addEventListener("pz:department-page", handle);
    return () => {
      window.removeEventListener("pz:department-page", handle);
      window.removeEventListener("pz:workspace-open", reload);
    };
  }, [department, session.user.id, scope]);
  useEffect(() => {
    if (page === "Performance")
      void api<any>(`/project-workflow/performance?department=${department}`)
        .then(setPerformance)
        .catch((e) => setError(e.message));
  }, [page]);
  async function action(name: string, input: any) {
    await api(`/project-workflow/${detail.record.id}/actions`, {
      csrf: session.csrfToken,
      body: {
        action: name,
        input,
        version: detail.record.version,
        requestKey: crypto.randomUUID(),
      },
    });
    const saved = await api<any>(`/project-workflow/${detail.record.id}`);
    const bucketKey =
      department === "design" ? "designBucket" : "coordinationBucket";
    const stayOnForm = [
      "assign",
      "save-survey-inputs",
      "review-survey-inputs",
      "save-customer-survey",
      "import-survey-reading",
      "edit-request",
      "undo",
      "resume",
    ].includes(name);
    await load();
    if (
      name === "save-survey-completion" ||
      (!stayOnForm &&
        (saved.record[bucketKey] !== detail.record[bucketKey] ||
          saved.record.stage !== detail.record.stage))
    ) {
      setDetail(undefined);
      setCreating(undefined);
      setSelectedDispatch(undefined);
      setDispatchPlanning(false);
      setFilters({ ...emptyWorkspaceFilters, period: "all" });
      setNotice(
        name === "save-survey-completion"
          ? input.completeSubmission
            ? "Survey saved and sent for technical review."
            : "Complete survey and BOQ saved. Ready for review in Scheduled Surveys."
          : "Completed and sent to the next stage. This bucket is refreshed.",
      );
    } else {
      setDetail(saved);
      setNotice("Saved. The recorded stage and history are updated.");
    }
  }
  if (!refs)
    return (
      <div className="pz-panel">
        {error ? (
          <ErrorText error={error} />
        ) : (
          <p role="status">Opening department workspace…</p>
        )}
      </div>
    );
  const designTaskStages = [
    "survey_requested",
    "survey_scheduled",
    "report_received",
    "technical_review",
    "technical_revision",
  ];
  const departmentTasks = rows.filter((r) =>
    department === "design"
      ? designTaskStages.includes(r.stage)
      : !designTaskStages.includes(r.stage) &&
        !["issued", "declined"].includes(r.stage),
  );
  const pageFilters = page === iposSharedBucket ? filters : { ...filters, solutionType: "" };
  const filtered = (page === "Workspace" ? departmentTasks : rows).filter((r) =>
    matchesWorkspace(
      {
        ...r,
        reference: [r.siteCode, r.id, r.data.ipoNumber, r.data.sharedPoReference, ...(r.references ?? []), r.location].join(
          " ",
        ),
        site: `${r.site} ${r.siteCode}`,
      },
      pageFilters,
    ),
  );
  const allCombinedFollowups = followupGroups(rows);
  const filteredIds = new Set(filtered.map((r) => r.id));
  const combinedFollowups = allCombinedFollowups
    .map((group) => ({
      ...group,
      sites: group.sites.filter((site) => filteredIds.has(site.id)),
    }))
    .filter((group) => group.sites.length);
  const combinedFollowupIds = new Set(
    allCombinedFollowups.flatMap((group) => group.sites.map((site) => site.id)),
  );
  const visible = filtered
    .filter(
      (r) =>
        !(
          department === "coordination" &&
          page === coordinationBuckets[5] &&
          combinedFollowupIds.has(r.id)
        ),
    )
    .filter((r) =>
      department === "coordination" && page === iposSharedBucket
        ? r.stage === "issued" && r.data.ipoShared
        : department === "coordination" && page === coordinationBuckets[0]
          ? surveyRequestInCoordination(r)
          : department === "coordination" && page === followupPage
            ? isCustomerFollowup(r)
            : page === "Workspace" ||
            (page === "Survey History" && r.route.startsWith("survey")) ||
            page === "Customer & Site Search" ||
            r[
              department === "design" ? "designBucket" : "coordinationBucket"
            ] === page,
    );
  const visibleLegacy = legacy.filter(
    (t) =>
      page !== iposSharedBucket &&
      !(department === "coordination" && page === coordinationBuckets[0]) &&
      (page === "Workspace" ||
        page === "Customer & Site Search" ||
        legacyBucket(t) === page) &&
      matchesWorkspace(
        {
          ...t,
          reference: t.number ?? t.reference,
          route: t.route ?? "Quick BOQ → quotation",
        },
        filters,
      ),
  );
  const readyToSend = department === "coordination" && page === coordinationBuckets[4];
  const readyIndividuals = visible.filter(r => !r.data.readySendGrouped);
  async function schedulingSaved() {
    await load();
    setDetail(undefined);
    setCreating(undefined);
    setSelectedDispatch(undefined);
    setDispatchPlanning(false);
    setFilters({ ...emptyWorkspaceFilters, period: "all" });
    setNotice("Dispatch approved. This bucket is refreshed.");
    setRefs(await workflowReferences(session.user.id,{fresh:true}));
  }
  if (creating === 'Approved survey batch') return <ApprovedConfigurationBatch refs={refs} session={session} route="survey-framework" onCancel={()=>setCreating(undefined)} onOpen={async(id:string)=>{await load();await open(id,false);}}/>;
  if (department === "coordination" && page === directPoPage && !detail)
    return <div className="pz-stack">
      <DirectPo {...{refs, session}} records={rows}
        onCancel={() => { if (confirmLeaveWorkspace()) setPage("Workspace"); }}
        onPrepared={async (id: string, draft: any) => {
          setDirectPoDraft(draft);
          await load();
          await open(id, false);
        }}/>
      {rows.some(isDirectPoDraft) && <section className="pz-panel pz-stack">
        <h3>Saved Direct PO drafts</h3>
        <div className="pz-table-scroll"><table className="pz-table">
          <thead><tr><th>Customer</th><th>Site / Branch code</th><th>Action</th></tr></thead>
          <PagedTableBody label="drafts">
            {recentFirst(rows.filter(isDirectPoDraft)).map(record => <tr key={record.id}>
              <td>{record.customer}</td>
              <td>{record.site} · {record.siteCode}</td>
              <td><Button variant="secondary" onClick={() => void open(record.id).catch(e=>setError(e.message))}>Review IPO</Button></td>
            </tr>)}
          </PagedTableBody>
        </table></div>
      </section>}
      <ErrorText error={error}/>
    </div>;
  if(approvalTarget) return <div className="pz-stack"><Button variant="neutral" onClick={()=>setApprovalTarget(undefined)}>Back to Management Review</Button><h2>Record Quotation Approval</h2><p>{approvalTarget.number}</p><QuotationApproval session={session} quotationId={approvalTarget.quotationId} cniId={approvalTarget.cniId} onApproved={approvalRecorded}/></div>;
  if (quotationReview) return <CoordinatorQuotationReview session={session} record={quotationReview} onApproved={approvalRecorded} onBack={()=>setQuotationReview(undefined)} onOpen={onOpen}/>;
  if (revisionRecord)
    return (
      <RevisionEntry
        session={session}
        record={revisionRecord}
        onOpen={onOpen}
        onBack={() => setRevisionRecord(undefined)}
      >
        {revisionRecord.revisionDetail?.record.data.designHandoffAt && (
          <CoordinationTechnicalSummary
            session={session}
            detail={revisionRecord.revisionDetail}
          />
        )}
      </RevisionEntry>
    );
  if (dispatchPlanning)
    return (
      <SurveyDispatchPlan
        session={session}
        refs={refs}
        records={rows}
        onAssigned={schedulingSaved}
        onBack={() => setDispatchPlanning(false)}
      />
    );
  if (selectedDispatch)
    return (
      <DispatchViewer
        session={session}
        dispatchId={selectedDispatch}
        onBack={() => setSelectedDispatch(undefined)}
      />
    );
  if(showUblSummary && department==='design') return <UblTechnicalReviewSummary session={session} records={rows} onBatchSaved={()=>load()} onBack={()=>setShowUblSummary(false)} onOpen={id=>{setShowUblSummary(false);void open(id).catch(e=>setError(e.message));}}/>;
  if (detail)
    return (
      <RecordEditor
        key={detail.record.id}
        {...{ session, department, refs, detail, onOpen, action, page, saleReview }}
        initialDirectPo={directPoDraft?.recordId===detail.record.id?directPoDraft:undefined}
        records={rows}
        onRequestOpen={(id: string) => open(id)}
        onDispatched={schedulingSaved}
        onPackageSaved={async (status: string) => {
          await load();
          setDetail(undefined);
          setNotice(
            status === "Submitted for Management"
              ? "Report and UBL Excel sent to Management."
              : "Report and UBL Excel information saved to send together.",
          );
        }}
        onScheduled={async () => {
          const [saved, updatedRefs] = await Promise.all([
            api(`/project-workflow/${detail.record.id}`),
            workflowReferences(session.user.id,{fresh:true}),
            load(),
          ]);
          setDetail(saved);
          setRefs(updatedRefs);
        }}
        refresh={() => open(detail.record.id, false, saleReview)}
        onBack={() => {
          if (!confirmLeaveWorkspace()) return;
          setDetail(undefined);
          setNotice("");
        }}
      />
    );
  if (creating === "Record Customer Heads-up")
    return <RecordHeadsup
      session={session}
      customers={refs.customers}
      onBack={() => {
        if (confirmLeaveWorkspace()) setCreating(undefined);
      }}
      onSaved={() => {
        setHeadsupRefresh((value) => value + 1);
        void load();
      }}
    />;
  return (
    <div className="pz-stack department-workspace">
      <ErrorText error={error} />
      {notice && <p role="status">{notice}</p>}
      {manager && (
        <div className="pz-action-row">
          <Button
            aria-pressed={scope === "mine"}
            onClick={() => setScope("mine")}
          >
            My Tasks
          </Button>
          <Button
            aria-pressed={scope === "team"}
            onClick={() => setScope("team")}
          >
            Team Tasks
          </Button>
        </div>
      )}
      {page === "Workspace" && (
        <>
          <div className="stage-grid workspace-buckets">
            {buckets.map((b) => (
              <button
                key={b}
                type="button"
                className="stage-card"
                onClick={() => setPage(b)}
                onDoubleClick={() => setPage(b)}
              >
                <span>{bucketLabel(b)}</span>
                <strong className="workspace-count">
                  {bucketCounts(department, rows, legacy)[b]}
                </strong>
                <small>Open bucket →</small>
              </button>
            ))}
          </div>
        </>
      )}
      {creating && (
          <CreateRecord onBatch={()=>setCreating("Approved survey batch")}
            {...{ refs, session, creating, manager, onOpen, selectedSite }}
            onCreated={async (id: string) => {
              await load();
              await open(id, false);
            }}
            onCancel={() => setCreating(undefined)}
            onOpen={onOpen}
          />
        )}
      {department === "coordination" &&
        page === coordinationBuckets[0] &&
        !creating && (
          <section className="pz-panel">
            <h2>Create survey request</h2>
            <p>
              Send a new site request to Design. Search previously sent requests
              below.
            </p>
            <Button
              variant="primary"
              onClick={() => {
                setSelectedSite(undefined);
                setCreating("Create survey request");
              }}
            >
              Create survey request
            </Button>
          </section>
        )}
      {manager && department === "coordination" && page === "Workspace" && (
        <FrameworkEditor
          {...{ session, refs }}
          onSaved={async () => {
            setRefs(await workflowReferences(session.user.id,{fresh:true}));
          }}
        />
      )}
      {page === "Performance" ? (
        <section className="pz-panel">
          <h2>Recorded performance</h2>
          {performance ? (
            <>
              <dl>
                <dt>Completed Design handoffs</dt>
                <dd>{performance.recordedHandoffs}</dd>
                <dt>Overdue surveys</dt>
                <dd>{performance.overdue}</dd>
                <dt>Average recorded turnaround</dt>
                <dd>
                  {performance.averageTurnaroundDays === null
                    ? "Not available"
                    : decimalDisplay(performance.averageTurnaroundDays) +
                      " days"}{" "}
                  ({performance.turnaroundObservations} records)
                </dd>
                <dt>First-pass acceptance</dt>
                <dd>
                  {performance.firstPassAcceptance === null
                    ? "Not available"
                    : decimalDisplay(performance.firstPassAcceptance * 100) +
                      "%"}{" "}
                  ({performance.firstPassObservations} records)
                </dd>
              </dl>
              <p>{performance.timingNote}</p>
              <div className="pz-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Revision date</th>
                      <th>Category</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.revisionReasons.map((r: any, i: number) => (
                      <tr key={i}>
                        <td>{day(r.date)}</td>
                        <td>{r.category}</td>
                        <td>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p>Loading recorded transitions…</p>
          )}
        </section>
      ) : (
        <>
          <div className="pz-followup-heading">
            <h2>
              {page === "Workspace"
                ? "Current sites"
                : department === "coordination" && page === coordinationBuckets[0]
                  ? "Survey requests"
                  : bucketLabel(page)}
            </h2>
            {department === "coordination" && page === followupPage && (
              <Button variant="secondary" onClick={() => setCreating("Record Customer Heads-up")}>
                Record Heads-up
              </Button>
            )}
          </div>
          {department === "design" && page === designBuckets[3] && (
            <p>
              Total handed off:{" "}
              {rows.filter((r) => r.data.designHandoffAt).length} · Still in
              process:{" "}
              {
                rows.filter(
                  (r) =>
                    !r.data.designHandoffAt && r.route.startsWith("survey"),
                ).length
              }
            </p>
          )}
          {!(department === "coordination" && page === "Customer & Site Search") && (
          <WorkspaceFilters
            key={`${department}-${page}`}
            rows={page === iposSharedBucket ? rows.filter((r) => r.stage === "issued" && r.data.ipoShared).map((r) => ({...r, site: `${r.site} ${r.siteCode}`})) : page === "Workspace" ? departmentTasks : rows}
            value={filters}
            onChange={setFilters}
            compact
            showJobType={page === iposSharedBucket}
            toolbarActions={department==='design'&&[designBuckets[2],designBuckets[3]].includes(page)?<Button variant="primary" onClick={()=>setShowUblSummary(true)}>UBL Technical Review Summary</Button>:undefined}
            showTaskModes={page === "Workspace"}
            searchLabel={
              page === iposSharedBucket
                ? "Search IPOs — customer, site, branch code or reference"
                : department === "coordination" && page === coordinationBuckets[5]
                ? "Search customer follow-up"
                : department === "design"
                  ? "Search survey requests"
                  : page === coordinationBuckets[0]
                    ? "Search survey requests"
                    : "Search tasks"
            }
          />
          )}
          {department === "coordination" && page === "Customer & Site Search" && <section className="pz-panel pz-stack">
            <h3>Master customer and site register</h3>
            {customerEditId!==undefined&&<EditCustomer key={customerEditId} customerId={customerEditId} session={session} onCancel={()=>setCustomerEditId(undefined)} onSaved={async()=>{setRefs(await workflowReferences(session.user.id,{fresh:true}));await load();setCustomerEditId(undefined);}}/>}
            {siteCodeTarget&&<SiteCodeUpdate site={siteCodeTarget} session={session} onCancel={()=>setSiteCodeTarget(undefined)} onSaved={async()=>{setRefs(await workflowReferences(session.user.id,{fresh:true}));await load();setSiteCodeTarget(undefined);}}/>}
            <CustomerSiteRegister session={session} customers={refs.customers} sites={refs.sites} records={rows} onEditCustomer={setCustomerEditId} onEditSite={setSiteCodeTarget} onWorkflow={(site,record)=>{if(record)void open(record.id).catch(e=>setError(e.message));else{setSelectedSite(site);setCreating("Create survey request");}}}/>
          </section>}


          {department === "coordination" && page === coordinationBuckets[5] && (
            <CustomerFollowupList
              records={[...visible,...visibleLegacy.map(t=>({...t,id:`legacy:${t.id}`,data:{},siteCode:t.site_code??"",sourceQuotationId:t.kind==="Sale confirmation"?t.id:undefined,route:"quotation",routeLabel:t.kind==="C&I proposal"?"C&I cabinet":"Quick BOQ → quotation",legacyTask:t}))]}
              groups={combinedFollowups}
              onConfirmSale={(record) => void confirmFollowupSale(record)}
              onRevise={(record) => {
                if (record.legacyTask?.kind === "C&I proposal") {
                  onOpen?.({...record.legacyTask, followupPreview: true, startCniRevision: true});
                } else void openRevision(record);
              }}
              onOpen={(record) => {
                const task = record.legacyTask;
                if (!task) void open(record.id).catch((e) => setError(e.message));
                else if (task.kind === "Sale confirmation") setQuotationReview({...task, sourceQuotationId:task.id, followupPreview:true});
                else onOpen?.({...task, followupPreview:true});
              }}
            />
          )}
          {department === "coordination" && page === followupPage && (
            <SavedHeadsupReports session={session} refresh={headsupRefresh} />
          )}
          {department === "coordination" && page === iposSharedBucket && <IposSharedList records={visible} onPreview={(id) => void open(id).catch((e) => setError(e.message))} />}
          {page !== "Customer & Site Search" && page !== iposSharedBucket && !readyToSend && !(
            department === "coordination" && page === coordinationBuckets[5]
          ) &&
            (department !== "design" || page !== designBuckets[1]) && (
              <div className="pz-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Customer / site</th>
                      <th>Stage / route</th>
                      <th>Responsibility</th>
                      <th>Age</th>
                      <th>Blocker</th>
                      <th>Next action</th>
                    </tr>
                  </thead>
                  <PagedTableBody label="sites and documents">
                    {visible
                      .filter(
                        (r) =>
                          !(
                            department === "design" &&
                            r.stage === "survey_scheduled" &&
                            r.data.surveyDispatchId
                          ),
                      )
                      .map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>
                              {r.customerCode} · {r.site}
                            </strong>
                            {r.data.headsupReceived && (
                              <p className="pz-caption">
                                <span className="pz-headsup-tag">
                                  Heads-up Received
                                </span>
                                {r.data.headsupSolution
                                  ? ` · ${r.data.headsupSolution}`
                                  : ""}
                                {r.data.headsupDate
                                  ? ` · ${new Date(r.data.headsupDate).toLocaleDateString("en-PK", { timeZone: "Asia/Karachi" })}`
                                  : ""}
                                {r.data.advanceBoqSent
                                  ? " · Advance BOQ Sent"
                                  : ""}
                              </p>
                            )}
                            <br />
                            {r.siteCode}
                            {department === "coordination"&&<DocumentListDetails record={r}/>}
                          </td>
                          <td>
                            {department === "design" &&
                            r.stage === "survey_scheduled" &&
                            !r.data.surveyDispatchId
                              ? "Schedule saved — awaiting dispatch"
                              : department === "coordination" && sentSurveyAwaitingDesign(r) ? "Sent survey request - awaiting Design" : label(r.stage)}
                            {department === "design" &&
                              r.stage === "survey_scheduled" &&
                              !r.data.surveyDispatchId && (
                                <span> · Dispatch not assigned</span>
                              )}
                            {r.stage === "technical_revision" && (
                              <strong> · Revision required</strong>
                            )}
                            <br />
                            {r.routeLabel}
                          </td>
                          <td>{r.person}</td>
                          <td>
                            {Math.max(
                              0,
                              Math.floor(
                                (Date.now() - +new Date(r.started_at)) /
                                  86400000,
                              ),
                            )}{" "}
                            days{r.overdue ? " · Overdue" : ""}
                          </td>
                          <td>{r.blocker || "No recorded blocker"}</td>
                          <td>
                            <Button
                              variant="secondary"
                              loading={removingGroupSite === r.id}
                              onClick={() =>
                                department === "coordination" &&
                                page === coordinationBuckets[4] &&
                                r.data.readySendGrouped
                                  ? void unbindApproved(r)
                                  : department === "coordination" &&
                                      page === coordinationBuckets[3]
                                    ? void openRevision(r)
                                    : r.data.surveySubmissionGroupId &&
                                        department === "coordination"
                                      ? void removeFromGroup(r)
                                      : void open(r.id).catch((e) =>
                                          setError(e.message),
                                        )
                              }
                            >
                              {department === "coordination" &&
                              page === coordinationBuckets[4] &&
                              r.data.readySendGrouped
                                ? "Unbind"
                                : department === "coordination" &&
                                    page === coordinationBuckets[4] &&
                                    r.customerCode === "UBL" &&
                                    r.route === "survey-framework"
                                  ? "Review Approved Survey"
                                  : department === "design" &&
                                      r.designBucket === designBuckets[3]
                                    ? "Preview"
                                    : department === "coordination" &&
                                        page === coordinationBuckets[3]
                                      ? "Create Revision"
                                      : r.data.surveySubmissionGroupId &&
                                          department === "coordination"
                                        ? "Remove from Group"
                                        : department === "coordination" &&
                                            [coordinationBuckets[1], coordinationBuckets[2]].includes(page)
                                          ? "Review"
                                          : department === "coordination" && page === coordinationBuckets[0] ? "View" : r.nextAction}
                            </Button>
                            {department === "coordination" && page === coordinationBuckets[2] && r.quotation?.id && <Button variant="success" onClick={()=>setApprovalTarget({quotationId:r.quotation.id,number:r.quotation.number})}>Record Approval</Button>}
                            {groupActionError?.id === r.id && (
                              <ErrorText
                                error={groupActionError?.message ?? ""}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    {department === "coordination" && recentFirst(visibleLegacy).map((t: any) => (
                      <tr key={`commercial-${t.id}`}>
                        <td>
                          <strong>{t.customer || "Customer not recorded"} · {t.site}</strong>
                          <br />{t.number ?? t.reference ?? ""}<DocumentListDetails record={t}/>
                        </td>
                        <td>{t.status ?? t.stage}<br />{t.route ?? "Quick BOQ → quotation"}</td>
                        <td>{t.person ?? t.responsibility ?? "Management"}</td>
                        <td>{Number.isFinite(+new Date(t.started_at))
                          ? `${Math.max(0, Math.floor((Date.now() - +new Date(t.started_at)) / 86400000))} days`
                          : "Not recorded"}</td>
                        <td>{t.blocker || "No recorded blocker"}</td>
                        <td><Button variant="secondary" onClick={() => page === coordinationBuckets[3] ? (t.kind==="Quotation revision"?onOpen?.(t):void openRevision({...t,sourceQuotationId:t.id})) : t.kind === "Sale confirmation" ? setQuotationReview({...t,sourceQuotationId:t.id}) : onOpen?.(t)}>{page === coordinationBuckets[3] ? (t.kind==="Quotation revision"?"Continue Revision":"Create Revision") : "Review"}</Button>{page === coordinationBuckets[2] && ["Sale confirmation","C&I proposal"].includes(t.kind)&&<Button variant="success" onClick={()=>setApprovalTarget({quotationId:t.kind==="Sale confirmation"?t.id:undefined,cniId:t.kind==="C&I proposal"?t.id:undefined,number:t.number})}>Record Approval</Button>}</td>
                      </tr>
                    ))}
                  </PagedTableBody>
                </table>
                {!visible.length && !(department === "coordination" && visibleLegacy.length) && <p>No sites match these filters.</p>}
              </div>
            )}

          {readyToSend && <>
            <ReadySendGroups
              key={rows.map((r) => r.version).join("-")}
              session={session}
              visibleRecordIds={visible.map(r => r.id)}
              onUnbind={(id:string)=>{const record=rows.find(r=>r.id===id);if(record)void unbindApproved(record);}}
              onRevise={(id:string)=>{const record=rows.find(r=>r.id===id);if(record)void openRevision(record);}}
            />
            <section className="pz-panel pz-stack">
              <h3>Approved Individual Documents</h3>
              <div className="pz-table-scroll"><table className="pz-table">
                <thead><tr><th>Customer / Site</th><th>Document</th><th>Status</th><th>Next action</th></tr></thead>
                <PagedTableBody label="sites and documents">
                  {recentFirst(readyIndividuals).map(r=><tr key={r.id}>
                    <td><strong>{r.customerCode} · {r.site}</strong><br/>{r.siteCode}</td>
                    <td>{r.quotation?.number ?? r.references?.join(" · ") ?? r.routeLabel}<DocumentListDetails record={r}/></td>
                    <td>Approved · Awaiting dispatch</td>
                    <td style={{verticalAlign:"top"}}><div className="pz-action-row pz-quotation-revision-actions"><Button variant="secondary" onClick={()=>void open(r.id).catch(e=>setError(e.message))}>Review</Button><Button variant="secondary" onClick={()=>void openRevision(r)}>Create Revision</Button></div></td>
                  </tr>)}
                  {recentFirst(visibleLegacy).map((t:any)=><tr key={`commercial-${t.id}`}>
                    <td><strong>{t.customer} · {t.site}</strong></td>
                    <td>{t.number ?? t.reference}<DocumentListDetails record={t}/></td>
                    <td>{t.status}</td>
                    <td style={{verticalAlign:"top"}}><div className="pz-action-row pz-quotation-revision-actions"><Button variant="secondary" onClick={()=>onOpen?.(t)}>Review</Button>{t.kind==="Sale confirmation"&&<Button variant="secondary" onClick={()=>void openRevision({...t,sourceQuotationId:t.id})}>Create Revision</Button>}</div></td>
                  </tr>)}
                </PagedTableBody>
              </table></div>
              {!readyIndividuals.length&&!visibleLegacy.length&&<p>No approved individual documents match these filters.</p>}
            </section>
          </>}
          {department === "coordination" && page === coordinationBuckets[1] && (
            <SurveySubmissionGroups
              session={session}
              groups={submissionGroups}
              onSent={async () => {
                await load();
                setNotice(
                  "Survey submission group sent to Management with its report and Excel.",
                );
              }}
            />
          )}
          {department === "design" &&
            page === designBuckets[1] &&
            !visible.length && (
              <p>No surveys have been assigned to an approved dispatch yet.</p>
            )}
          {department === "design" &&
            [
              ...new Set<string>(
                visible
                  .filter(
                    (r) =>
                      r.stage === "survey_scheduled" && r.data.surveyDispatchId,
                  )
                  .map((r) => r.data.surveyDispatchId),
              ),
            ].map((dispatchId) => {
              const sites = visible.filter(
                (r) => r.data.surveyDispatchId === dispatchId,
              );
              return (
                <section className="pz-panel" key={dispatchId}>
                  <h3>
                    {sites[0].data.surveyDispatchNumber} · {sites.length} site
                    {sites.length === 1 ? "" : "s"}
                  </h3>
                  <p>Scheduled: {sites[0].data.scheduledSurveyDate}</p>
                  <div className="pz-table-scroll">
                    <table className="pz-table">
                      <thead>
                        <tr>
                          <th>Customer / site</th>
                          <th>Next action</th>
                        </tr>
                      </thead>
                      <PagedTableBody label="sites and documents">
                        {sites.map((site) => (
                          <tr key={site.id}>
                            <td>
                              {site.customerCode} · {site.site} ({site.siteCode}
                              )
                            </td>
                            <td>
                              <Button
                                variant="secondary"
                                onClick={() => void open(site.id)}
                              >
                                {site.data?.surveyInputsSavedAt &&
                                (!(
                                  site.customerCode?.toUpperCase() === "UBL" &&
                                  site.route === "survey-framework"
                                ) ||
                                  site.data?.customerSurveyForms?.[
                                    "ubl-solar-survey"
                                  ])
                                  ? "Review & Send"
                                  : "Open Survey"}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </PagedTableBody>
                    </table>
                  </div>
                  {page !== designBuckets[1] && (
                    <Button
                      variant="secondary"
                      onClick={() => setSelectedDispatch(dispatchId)}
                    >
                      View Dispatch
                    </Button>
                  )}
                </section>
              );
            })}

        </>
      )}
    </div>
  );
}function Upload({
  files = [],
  removableRequestFiles = false,
  session,
  id,
  onSaved,
  initialKind = "Survey report",
  surveyReporting = false,
  dispatchEvidence = false,
}: any) {
  const [kind, setKind] = useState(initialKind),
    [file, setFile] = useState<File>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="pz-panel pz-workflow-form">
      <h3>
        {dispatchEvidence
          ? "Dispatch Evidence"
          : surveyReporting
            ? "Survey report & photos"
            : "Attach source evidence"}
      </h3>
      <p className="pz-caption">
        {dispatchEvidence
          ? "Attach the customer or salesperson delivery confirmation for the approved document."
          : surveyReporting
            ? "Upload the completed survey report and site photographs. These files remain linked to the site."
            : "Attach the original request or supporting document for this site. Saved evidence stays in the document history."}
      </p>
      <div className="pz-form-grid">
        <Field id={`evidence-kind-${id}`} label="Document type">
          <select
            id={`evidence-kind-${id}`}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {(dispatchEvidence
              ? ["Recommendation sending evidence"]
              : surveyReporting
                ? ["Survey report", "Survey photo"]
                : [
                    "Request evidence",
                    "Survey report",
                    "Survey photo",
                    "Recommendation sending evidence",
                    "PO / confirmation",
                    "Heads-up evidence",
                    "Revision evidence",
                  ]
            ).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field
          id={`evidence-file-${id}`}
          label="Attachment"
          hint="PDF, PNG or JPEG · maximum 8 MB"
        >
          <FileUpload selectedFiles={file?[file]:[]} onClear={()=>setFile(undefined)}
            id={`evidence-file-${id}`}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </Field>
      </div>
      <Button
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setError("");
          setBusy(true);
          try {
            if (!file) throw new Error("Choose an attachment.");
            if (file.size > 8388608) throw new Error("Use a file up to 8 MB.");
            const base64 = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result).split(",")[1]);
              r.onerror = reject;
              r.readAsDataURL(file);
            });
            await api(`/project-workflow/${id}/files`, {
              csrf: session.csrfToken,
              body: { kind, filename: file.name, mime: file.type, base64 },
            });
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Attach evidence
      </Button>
      {removableRequestFiles && (
        <div className="pz-stack" aria-label="Saved request attachments">
          <h4>Attached files ({files.filter((f: any) => f.kind === "Request evidence").length})</h4>
          <div className="pz-table-scroll"><table><thead><tr><th>File name</th><th>Action</th></tr></thead><tbody>
          {files.filter((f: any) => f.kind === "Request evidence").map((saved: any) => (
            <tr key={saved.id}><td>
              <a href={`/api/project-workflow/${id}/files/${saved.id}`} target="_blank" rel="noreferrer">
                {saved.filename}
              </a></td><td>
              <Button variant="danger" disabled={busy} aria-label={`Remove ${saved.filename}`} onClick={async () => {
                if (!window.confirm(`Remove “${saved.filename}” from this survey request? You can attach it again if needed.`)) return;
                setBusy(true);
                setError("");
                try {
                  await api(`/project-workflow/${id}/files/${saved.id}/remove`, { csrf: session.csrfToken, body: {} });
                  await onSaved();
                } catch (e) { setError((e as Error).message); }
                finally { setBusy(false); }
              }}>Remove</Button>
            </td></tr>
          ))}
          </tbody></table></div>
          {!files.some((f: any) => f.kind === "Request evidence") && <p className="pz-caption">No files attached yet.</p>}
        </div>
      )}
      <ErrorText error={error} />
    </section>
  );
}function RecordEditor({
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
function CoordinationTechnicalSummary({ session, detail }: any) {
  const r = detail.record;
  const [summary, setSummary] = useState<any>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setSummary(undefined);
    setError("");
    void api<any>(`/project-workflow/${r.id}/preview`, {
      csrf: session.csrfToken,
      body: { kind: "technical-summary" },
    })
      .then((data) => {
        if (live) setSummary(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [r.id, r.version, attempt]);
  const recommended =
    summary?.survey ?? detail.review?.survey ?? r.data.surveyInputs;
  let recommendedSolution = "Not available";
  if (recommended) {
    try {
      recommendedSolution = solutionValues(recommended).solutionId;
    } catch {
      recommendedSolution = "Needs review";
    }
  }
  const difference = (row: any) => {
    try {
      const delta = new Decimal(row.entered).sub(row.approved);
      const unit = row.field.includes("(W)") ? " W" : "";
      return delta.isZero()
        ? "No change"
        : `${decimalDisplay(delta.abs().toString())}${unit} ${delta.gt(0) ? "more" : "less"}`;
    } catch {
      return "N/A";
    }
  };
  return (
    <details className="pz-form-section pz-technical-summary">
      <summary>
        <span className="pz-technical-summary-heading">
          <h3>Submitted Technical Review Summary</h3>
          <span>
            Recommended Solution ID: <strong>{recommendedSolution}</strong>
          </span>
        </span>
      </summary>
      <div className="pz-stack pz-technical-summary-content">
        <ErrorText error={error} />
        {error && (
          <div>
            <Button
              variant="secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry Summary
            </Button>
          </div>
        )}
        {summary?.pending && <p>{summary.pending}</p>}
        {summary?.survey && (
          <>
            <p>
              <strong>{summary.status}</strong>
              {summary.reviewNumber ? ` · ${summary.reviewNumber}` : ""}
            </p>
            <div className="pz-table-scroll">
              <table className="pz-table">
                <tbody>
                  {[
                    ["panelQty", "Panel quantity"],
                    ["panelWattage", "Panel wattage (W)"],
                    ["totalWattage", "Total wattage (W)"],
                    ["bessId", "BESS configuration"],
                    ["inverter", "Inverter capacity"],
                    ["batteryKwh", "Battery capacity (kWh)"],
                    ["structure", "Structure"],
                  ].map(([key, title]) => (
                    <tr key={key}>
                      <th>{title}</th>
                      <td>{summary.survey[key] ?? "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{summary.remarks}</p>
            <h3>Panel Difference</h3>
            <div className="pz-table-scroll">
              <table className="pz-table">
                <thead>
                  <tr>
                    <th>Panel requirement</th>
                    <th>{summary.panelBaselineLabel}</th>
                    <th>Technical review</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.panels.map((row: any) => (
                    <tr
                      key={row.field}
                      className={
                        row.different ? "pz-survey-difference" : undefined
                      }
                    >
                      <th>{row.field}</th>
                      <td>{row.approved}</td>
                      <td>{row.entered}</td>
                      <td>{difference(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CableQuantityComparison
              rows={summary.cableRows}
              title="Cable Differences"
              baselineLabel={summary.baselineLabel}
            />
            <p>{summary.comparisonNote}</p>
          </>
        )}
      </div>
    </details>
  );
}function SentSurveyQuotation({session,record,onOpen}:{session:Session;record:any;onOpen?:(task:any)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function prepare(){if(busy)return;setBusy(true);setError('');try{const result=await api<any>(`/project-workflow/${record.id}/prepare-sent-quotation`,{csrf:session.csrfToken,body:{version:record.version}});onOpen?.({...result.task,...(!result.task?{draft_id:result.draftId,kind:'Survey / BOQ'}:{}),target:!result.task||result.task.target==='boqs'?'newboq':result.task.target,workflow_id:result.recordId});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="pz-panel"><h3>Sent survey request</h3><p>Awaiting Design. Prepare your own BOQ and quotation for this site while the survey remains pending.</p><Button variant="primary" loading={busy} onClick={()=>void prepare()}>{record.data.sentQuotationDraftId?'Open BOQ / Quotation':'Create BOQ / Quotation'}</Button>{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}

