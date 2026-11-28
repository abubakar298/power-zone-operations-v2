import { CoordinationTechnicalSummary } from "./department-workspace/CoordinationTechnicalSummary.js";
import { RecordEditor } from "./department-workspace/RecordEditor.js";
import { SurveyDispatchPlan, DispatchViewer } from "./department-workspace/SurveyDispatch.js";
import { CreateRecord } from "./department-workspace/CreateRecord.js";
import { SurveySubmissionGroups } from "./department-workspace/SurveyAttachments.js";
import { ErrorText, label, day } from "./department-workspace/parts.js";
import { FrameworkEditor } from "./department-workspace/PoEntry.js";
import {ApprovedConfigurationBatch} from '../components/ApprovedConfigurationBatch.js';
import {useBackStep} from '../navigation/useBackStep.js';
import {sharedDepartmentList,workflowReferences} from '../workspaces/workflow-list-reuse.js';
import {recentFirst,recordedTimestamp} from '../../shared/recent-records.js';
import {PagedTableBody} from '../ui/PagedTableBody.js';
import {CustomerSiteRegister} from '../components/CustomerSiteRegister.js';
import './department-lists.css';
import {sentSurveyAwaitingDesign,surveyRequestInCoordination} from '../../shared/sent-survey-requests.js';
import {UblTechnicalReviewSummary} from '../components/UblTechnicalReviewSummary.js';
import {DocumentListDetails} from '../components/DocumentListDetails.js';
import {DirectPo} from "../components/DirectPoUpload.js";
import { IposSharedList } from "../components/IposSharedList.js";
import {QuotationApproval} from "../components/QuotationApproval.js";
import {SiteCodeUpdate} from "../components/SiteCodeUpdate.js";
import {CloseRevisionDialog} from "../components/CloseRevisionDialog.js";
import {RetireBoqDialog} from "../components/RetireBoqDialog.js";
import {EditCustomer} from '../components/EditCustomer.js';
import {CoordinatorQuotationReview} from "../components/CoordinatorQuotationReview.js";
import { CustomerFollowupList } from "../components/CustomerFollowupList.js";
import { followupGroups, isCustomerFollowup } from "../workspaces/followup-groups.js";
import {
  RecordHeadsup,
  SavedHeadsupReports,
} from "../components/RecordHeadsup.js";
import { ReadySendGroups } from "../components/ReadySendReview.js";
import { RevisionEntry } from "../components/RevisionEntry.js";
import { bucketCounts } from "../workspaces/bucket-counts.js";
import { coordinationBucket as legacyBucket } from "../workspaces/tasks.js";
import { confirmLeaveWorkspace } from "../hooks/useUnsavedChanges.js";
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { decimalDisplay } from "../numbers.js";
import {
  WorkspaceFilters,
  emptyWorkspaceFilters,
  matchesWorkspace,
} from "../components/WorkspaceFilters.js";
import { bucketLabel, designBuckets, coordinationBuckets, visibleCoordinationBuckets, iposSharedBucket, cancelledSitesBucket } from "../workspaces/project-routes.js";
import { CancelledSitesList } from "../components/CancelledSitesList.js";
const followupPage = coordinationBuckets[5];
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
  const [closeRevision, setCloseRevision] = useState<any>();
  const [retireBoq, setRetireBoq] = useState<any>();
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
        reference: [r.siteCode, r.id, r.data.ipoNumber, r.data.latePo?.poNumber || r.data.sharedPoReference, r.data.sharedOrderNumber, r.data.ipoSalesPerson, ...(r.references ?? []), r.location].join(
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
        ? r.stage === "issued" && r.data.ipoShared && !r.data.siteCancelled
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
  const legacyRow = (t: any) => (
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
                        <td><Button variant="secondary" onClick={() => page === coordinationBuckets[3] ? (t.kind==="Quotation revision"?onOpen?.(t):void openRevision({...t,sourceQuotationId:t.id})) : t.kind === "Sale confirmation" ? setQuotationReview({...t,sourceQuotationId:t.id}) : onOpen?.(t)}>{page === coordinationBuckets[3] ? (t.kind==="Quotation revision"?"Continue Revision":"Create Revision") : "Review"}</Button>{page === coordinationBuckets[3] && t.kind==="Quotation revision" && <Button variant="neutral" onClick={() => { setNotice(""); setCloseRevision(t); }}>Close revision</Button>}{page === coordinationBuckets[1] && t.kind==="Commercial pricing" && <Button variant="neutral" onClick={() => { setNotice(""); setRetireBoq(t); }}>Not needed</Button>}{page === coordinationBuckets[2] && ["Sale confirmation","C&I proposal"].includes(t.kind)&&<Button variant="success" onClick={()=>setApprovalTarget({quotationId:t.kind==="Sale confirmation"?t.id:undefined,cniId:t.kind==="C&I proposal"?t.id:undefined,number:t.number})}>Record Approval</Button>}</td>
                      </tr>
  );
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
      {retireBoq&&<RetireBoqDialog task={retireBoq} session={session} onClose={()=>setRetireBoq(undefined)} onRetired={async message=>{setRetireBoq(undefined);setNotice(message);await load();}}/>}
      {closeRevision&&<CloseRevisionDialog task={closeRevision} session={session} onClose={()=>setCloseRevision(undefined)} onClosed={async message=>{setCloseRevision(undefined);setNotice(message);await load();}}/>}
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
          {!(department === "coordination" && (page === "Customer & Site Search" || page === cancelledSitesBucket)) && (
          <WorkspaceFilters
            key={`${department}-${page}`}
            rows={page === iposSharedBucket ? rows.filter((r) => r.stage === "issued" && r.data.ipoShared && !r.data.siteCancelled).map((r) => ({...r, site: `${r.site} ${r.siteCode}`})) : page === "Workspace" ? departmentTasks : rows}
            value={filters}
            onChange={setFilters}
            compact
            showJobType={page === iposSharedBucket}
            toolbarActions={department==='design'&&[designBuckets[2],designBuckets[3]].includes(page)?<Button variant="primary" onClick={()=>setShowUblSummary(true)}>UBL Technical Review Summary</Button>:undefined}
            showTaskModes={page === "Workspace"}
            searchLabel={
              page === iposSharedBucket
                ? "Search IPOs — customer, site, branch code, reference, order no. or salesperson"
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
          {department === "coordination" && page === cancelledSitesBucket && <CancelledSitesList session={session} onOpenRecord={(id) => void open(id).catch((e) => setError(e.message))} onOpen={(task) => onOpen?.(task)} />}
          {department === "coordination" && page === iposSharedBucket && <IposSharedList records={visible} onPreview={(id) => void open(id).catch((e) => setError(e.message))} />}
          {page !== "Customer & Site Search" && page !== iposSharedBucket && page !== cancelledSitesBucket && !readyToSend && !(
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
                    {/* One newest-first list: workflow sites and older commercial tasks are interleaved by latest activity. */}
                    {recentFirst<any>([
                      ...visible.filter(
                        (r) =>
                          !(
                            department === "design" &&
                            r.stage === "survey_scheduled" &&
                            r.data.surveyDispatchId
                          ),
                      ),
                      ...(department === "coordination" ? visibleLegacy.map((t: any) => ({ legacyTask: t })) : []),
                    ], (e: any) => recordedTimestamp(e.legacyTask ?? e))
                      .map((r: any) => r.legacyTask ? legacyRow(r.legacyTask) : (
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
}
