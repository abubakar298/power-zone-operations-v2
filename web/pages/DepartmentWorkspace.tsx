import {CoordinatorQuotationReview} from "../components/CoordinatorQuotationReview.js";
import { CustomerFollowupList } from "../components/CustomerFollowupList.js";
import { ConfirmSaleForm } from "../components/ConfirmSaleForm.js";
import { PoReceiptSearch } from "../components/PoReceiptSearch.js";
import { followupGroups } from "../workspaces/followup-groups.js";
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
import { surveySharedValues } from "../../server/project-workflow/survey-shared-values.js";
import { coordinationBucket as legacyBucket } from "../workspaces/tasks.js";
import {
  confirmLeaveWorkspace,
  useUnsavedChanges,
} from "../hooks/useUnsavedChanges.js";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { DocumentPreview } from "../components/DocumentPreview.js";
import { NewCustomer } from "../components/NewCustomer.js";
import { canWriteMaster } from "../../server/masters/permissions.js";
import { money, decimalDisplay } from "../numbers.js";
import {
  WorkspaceFilters,
  emptyWorkspaceFilters,
  matchesWorkspace,
} from "../components/WorkspaceFilters.js";
import { SurveyQuantityFields } from "../components/SurveyQuantityFields.js";
import { BessSelector } from "../components/BessSelector.js";
import {
  bucketLabel,
  designBuckets,
  coordinationBuckets,
  visibleCoordinationBuckets,
  iposSharedBucket,
  routeNames,
} from "../workspaces/project-routes.js";
import { confirmTransition } from "../confirm.js";
const day = (value: any) => (value ? String(value).slice(0, 10) : "");
const label = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
function Input({
  name,
  title,
  value = "",
  type = "text",
  required = false,
  readOnly = false,
}: {
  name: string;
  title: string;
  value?: any;
  type?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label>
      {title}
      <input
        name={name}
        type={type}
        step={type === "number" ? "any" : undefined}
        min={type === "number" ? 0 : undefined}
        defaultValue={value}
        required={required}
        readOnly={readOnly}
      />
    </label>
  );
}
function Action({
  title,
  submitLabel,
  onSubmit,
  children,
  disabled = false,
  formId,
  hideSubmit = false,
  alternateSubmitLabel,
}: {
  title: string;
  submitLabel?: string;
  onSubmit: (f: FormData, intent?: string) => Promise<void | boolean>;
  children?: any;
  disabled?: boolean;
  formId?: string;
  hideSubmit?: boolean;
  alternateSubmitLabel?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  return (
    <form
      id={formId}
      onChange={() => setDirty(true)}
      className="pz-panel pz-stack pz-workflow-form"
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError("");
        setBusy(true);
        try {
          const submitter = (e.nativeEvent as SubmitEvent)
            .submitter as HTMLButtonElement | null;
          const result = await onSubmit(f, submitter?.value ?? "save");
          if (result !== false) setDirty(false);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{title}</h3>
      {children}
      <div>
        <div
          className={
            alternateSubmitLabel ? "pz-survey-save-actions" : "pz-action-row"
          }
        >
          {!hideSubmit && (
            <Button
              type="submit"
              name="intent"
              value="save"
              variant={alternateSubmitLabel ? "secondary" : "primary"}
              loading={busy}
              disabled={disabled}
            >
              {submitLabel ?? title}
            </Button>
          )}
          {alternateSubmitLabel && (
            <Button
              type="submit"
              name="intent"
              value="complete"
              variant="primary"
              loading={busy}
              disabled={disabled}
            >
              {alternateSubmitLabel}
            </Button>
          )}
        </div>
        <ErrorText error={error} />
      </div>
    </form>
  );
}
function People({
  refs,
  name,
  title,
  role,
  value = "",
  multiple = false,
}: {
  refs: any;
  name: string;
  title: string;
  role: string;
  value?: any;
  multiple?: boolean;
}) {
  return (
    <label>
      {title}
      <select name={name} defaultValue={value} required multiple={multiple}>
        {!multiple && <option value="">Select person</option>}
        {refs.people
          .filter((p: any) => p.role === role)
          .map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
      </select>
    </label>
  );
}
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
    [page, setPage] = useState("Workspace"),
    [detail, setDetail] = useState<any>(),
    [filters, setFilters] = useState({ ...emptyWorkspaceFilters }),
    [creating, setCreating] = useState<string>(),
    [performance, setPerformance] = useState<any>(),
    [notice, setNotice] = useState("");
  const [headsupRefresh, setHeadsupRefresh] = useState(0);
  const [quotationReview, setQuotationReview] = useState<any>();
  const [revisionRecord, setRevisionRecord] = useState<any>();
  const [selectedSite, setSelectedSite] = useState<any>();
  const [selectedDispatch, setSelectedDispatch] = useState<string>();
  const [dispatchPlanning, setDispatchPlanning] = useState(false);
  const [submissionGroups, setSubmissionGroups] = useState<any[]>([]);
  const [groupActionError, setGroupActionError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [removingGroupSite, setRemovingGroupSite] = useState<string | null>(
    null,
  );
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
  async function load() {
    const r = await api<any>(
      `/project-workflow?department=${department}&scope=${scope}`,
    );
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
      setRevisionRecord({ ...record, revisionDetail });
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
  async function open(id: string, checkChanges = true) {
    if (checkChanges && !confirmLeaveWorkspace()) return;
    setError("");
    setCreating(undefined);
    const loaded = await api<any>(`/project-workflow/${id}`);
    if (department === "coordination" && page === coordinationBuckets[2] && loaded.record.quotation?.id) {
      setQuotationReview(loaded.record);
      return;
    }
    setDetail(loaded);
    setPage(
      department === "coordination" && page === coordinationBuckets[6]
        ? coordinationBuckets[6]
        : department === "design"
          ? loaded.record.designBucket
          : loaded.record.coordinationBucket,
    );
  }
  useEffect(() => {
    void Promise.all([api("/project-workflow/references"), load()])
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
      setPage(pendingPage);
      sessionStorage.removeItem("pz:department-page");
    }
    const reload = () => {
      void Promise.all([api("/project-workflow/references"), load()])
        .then(([r]) => setRefs(r))
        .catch((e) => setError(e.message));
    };
    window.addEventListener("pz:workspace-open", reload);
    const handle = (e: any) => {
      if (!confirmLeaveWorkspace()) return;
      sessionStorage.removeItem("pz:department-page");
      setDetail(undefined);
      setRevisionRecord(undefined);
      setQuotationReview(undefined);
      setCreating(undefined);
      setSelectedDispatch(undefined);
      setDispatchPlanning(false);
      setPage(e.detail ?? "Workspace");
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
  const filtered = (page === "Workspace" ? departmentTasks : rows).filter((r) =>
    matchesWorkspace(
      {
        ...r,
        reference: [r.siteCode, r.id, ...(r.references ?? []), r.location].join(
          " ",
        ),
        site: `${r.site} ${r.siteCode}`,
      },
      filters,
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
          ? r.stage === "request_review"
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
  const mergedReview = department === "coordination" && page === coordinationBuckets[2];
  async function schedulingSaved() {
    await load();
    setDetail(undefined);
    setCreating(undefined);
    setSelectedDispatch(undefined);
    setDispatchPlanning(false);
    setFilters({ ...emptyWorkspaceFilters, period: "all" });
    setNotice("Dispatch approved. This bucket is refreshed.");
    setRefs(await api("/project-workflow/references"));
  }
  if (
    department === "coordination" &&
    page === coordinationBuckets[6] &&
    !creating &&
    !detail
  )
    return (
      <div className="pz-stack">
        <section className="pz-panel">
          <h2>PO Receipt / Heads-up</h2>
          <div className="pz-action-row">
            <Button
              variant="secondary"
              onClick={() => setCreating("Record Customer Heads-up")}
            >
              Record Heads-up
            </Button>
          </div>
        </section>
        <PoReceiptSearch
          records={rows}
          onConfirm={(id: string) => void open(id)}
        />
        <SavedHeadsupReports session={session} refresh={headsupRefresh} />
      </div>
    );
  if (quotationReview) return <CoordinatorQuotationReview session={session} record={quotationReview} onBack={()=>setQuotationReview(undefined)} onOpen={onOpen}/>;
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
  if (detail)
    return (
      <RecordEditor
        key={detail.record.id}
        {...{ session, department, refs, detail, onOpen, action, page }}
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
            api("/project-workflow/references"),
            load(),
          ]);
          setDetail(saved);
          setRefs(updatedRefs);
        }}
        refresh={() => open(detail.record.id, false)}
        onBack={() => {
          if (!confirmLeaveWorkspace()) return;
          setDetail(undefined);
          setNotice("");
        }}
      />
    );
  return (
    <div className="pz-stack">
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
      {creating === "Record Customer Heads-up" && (
        <RecordHeadsup
          session={session}
          customers={refs.customers}
          onBack={() => {
            if (confirmLeaveWorkspace()) setCreating(undefined);
          }}
          onSaved={() => {
            setHeadsupRefresh((value) => value + 1);
            void load();
          }}
        />
      )}
      {creating === "Record PO / Customer Confirmation" && (
        <PoRecordSelect
          session={session}
          customers={refs.customers}
          onCancel={() => setCreating(undefined)}
          onOpen={(id: string) => void open(id, false)}
        />
      )}
      {creating &&
        ![
          "Record Customer Heads-up",
          "Record PO / Customer Confirmation",
        ].includes(creating) && (
          <CreateRecord
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
        page === coordinationBuckets[6] &&
        !creating && (
          <section className="pz-panel">
            <h2>PO Receipt / Heads-up</h2>
            <div className="pz-action-row">
              {[
                "Record PO / Customer Confirmation",
                "Record Customer Heads-up",
              ].map((task) => (
                <Button
                  key={task}
                  variant="secondary"
                  onClick={() => {
                    setSelectedSite(undefined);
                    setCreating(task);
                  }}
                >
                  {task}
                </Button>
              ))}
            </div>
          </section>
        )}
      {department === "coordination" &&
        page === coordinationBuckets[6] &&
        !creating && (
          <SavedHeadsupReports session={session} refresh={headsupRefresh} />
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
            setRefs(await api("/project-workflow/references"));
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
          <h2>
            {page === "Workspace"
              ? "Current sites"
              : department === "coordination" && page === coordinationBuckets[0]
                ? "Survey requests awaiting review and sending to Design"
                : bucketLabel(page)}
          </h2>
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
          <WorkspaceFilters
            key={`${department}-${page}`}
            rows={page === "Workspace" ? departmentTasks : rows}
            value={filters}
            onChange={setFilters}
            compact
            showTaskModes={page === "Workspace"}
            searchLabel={
              department === "coordination" && page === coordinationBuckets[5]
                ? "Search customer follow-up"
                : department === "design"
                  ? "Search survey requests"
                  : page === coordinationBuckets[0]
                    ? "Search survey requests"
                    : "Search tasks"
            }
          />
          {department === "coordination" &&
            page === "Customer & Site Search" && (
              <section className="pz-panel">
                <h3>Master customer and site register</h3>
                <div className="pz-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Site / code</th>
                        <th>Location</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refs.sites
                        .filter((site: any) => {
                          const c = refs.customers.find(
                            (c: any) => c.id === site.customer_id,
                          );
                          return (
                            c &&
                            (!filters.search ||
                              [
                                c.short_code,
                                c.name,
                                site.name,
                                site.code,
                                site.location,
                              ]
                                .join(" ")
                                .toLowerCase()
                                .includes(filters.search.toLowerCase()))
                          );
                        })
                        .map((site: any) => {
                          const c = refs.customers.find(
                              (c: any) => c.id === site.customer_id,
                            ),
                            record = rows.find((r) => r.siteId === site.id);
                          return (
                            <tr key={site.id}>
                              <td>
                                {c.short_code} · {c.name}
                              </td>
                              <td>
                                {site.name} · {site.code}
                              </td>
                              <td>{site.location}</td>
                              <td>
                                <Button
                                  onClick={() => {
                                    if (record)
                                      void open(record.id).catch((e) =>
                                        setError(e.message),
                                      );
                                    else {
                                      setSelectedSite(site);
                                      setCreating("Create survey request");
                                    }
                                  }}
                                >
                                  {record
                                    ? "Open workflow"
                                    : "Create workflow for this site"}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

          {department === "coordination" && page === coordinationBuckets[5] && (
            <CustomerFollowupList
              records={visible}
              groups={combinedFollowups}
              onOpen={(id: string) =>
                void open(id).catch((e) => setError(e.message))
              }
            />
          )}
          {!readyToSend && !(
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
                  <tbody>
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
                          </td>
                          <td>
                            {department === "design" &&
                            r.stage === "survey_scheduled" &&
                            !r.data.surveyDispatchId
                              ? "Schedule saved — awaiting dispatch"
                              : label(r.stage)}
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
                                          : r.nextAction}
                            </Button>
                            {groupActionError?.id === r.id && (
                              <ErrorText
                                error={groupActionError?.message ?? ""}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    {mergedReview && visibleLegacy.map((t: any) => (
                      <tr key={`commercial-${t.id}`}>
                        <td>
                          <strong>{t.customer || "Customer not recorded"} · {t.site}</strong>
                          <br />{t.number ?? t.reference ?? ""}
                        </td>
                        <td>{t.status ?? t.stage}<br />{t.route ?? "Quick BOQ → quotation"}</td>
                        <td>{t.person ?? t.responsibility ?? "Management"}</td>
                        <td>{Number.isFinite(+new Date(t.started_at))
                          ? `${Math.max(0, Math.floor((Date.now() - +new Date(t.started_at)) / 86400000))} days`
                          : "Not recorded"}</td>
                        <td>{t.blocker || "No recorded blocker"}</td>
                        <td><Button variant="secondary" onClick={() => t.kind === "Sale confirmation" ? setQuotationReview({...t,sourceQuotationId:t.id}) : onOpen?.(t)}>Review</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && !(mergedReview && visibleLegacy.length) && <p>No sites match these filters.</p>}
              </div>
            )}

          {readyToSend && <>
            <ReadySendGroups
              key={rows.map((r) => r.version).join("-")}
              session={session}
              visibleRecordIds={visible.map(r => r.id)}
              onUnbind={(id:string)=>{const record=rows.find(r=>r.id===id);if(record)void unbindApproved(record);}}
            />
            <section className="pz-panel pz-stack">
              <h3>Approved Individual Documents</h3>
              <div className="pz-table-scroll"><table className="pz-table">
                <thead><tr><th>Customer / Site</th><th>Document</th><th>Status</th><th>Next action</th></tr></thead>
                <tbody>
                  {readyIndividuals.map(r=><tr key={r.id}>
                    <td><strong>{r.customerCode} · {r.site}</strong><br/>{r.siteCode}</td>
                    <td>{r.quotation?.number ?? r.references?.join(" · ") ?? r.routeLabel}</td>
                    <td>Approved · Awaiting dispatch</td>
                    <td><Button variant="secondary" onClick={()=>void open(r.id).catch(e=>setError(e.message))}>Review</Button></td>
                  </tr>)}
                  {visibleLegacy.map((t:any)=><tr key={`commercial-${t.id}`}>
                    <td><strong>{t.customer} · {t.site}</strong></td>
                    <td>{t.number ?? t.reference}</td>
                    <td>{t.status}</td>
                    <td><Button variant="secondary" onClick={()=>onOpen?.(t)}>Review</Button></td>
                  </tr>)}
                </tbody>
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
                      <tbody>
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
                      </tbody>
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
          {department === "coordination" &&
            page !== coordinationBuckets[1] &&
            !mergedReview &&
            !readyToSend &&
            visibleLegacy.length > 0 && (
              <section className="pz-panel">
                <h3>Existing commercial work</h3>
                <p>
                  Preserved records use their current BOQ, costing and quotation
                  actions. Approved orders can join this shared route.
                </p>
                {visibleLegacy.map((t: any) => (
                  <div className="pz-action-row" key={t.id}>
                    <span>
                      {t.number} · {t.site} · {t.status ?? t.stage}
                    </span>
                    <Button
                      onClick={() =>
                        page === coordinationBuckets[3]
                          ? void openRevision({ ...t, sourceQuotationId: t.id })
                          : onOpen?.(t)
                      }
                    >
                      {page === coordinationBuckets[3]
                        ? "Create Revision"
                        : "Open existing work"}
                    </Button>
                    {t.boq_revision_id && page !== coordinationBuckets[3] && (
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          try {
                            const r = await api<any>(
                              "/project-workflow/adopt",
                              {
                                csrf: session.csrfToken,
                                body: { boqRevisionId: t.boq_revision_id },
                              },
                            );
                            await load();
                            await open(r.id);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Open shared PO route
                      </Button>
                    )}
                  </div>
                ))}
              </section>
            )}
        </>
      )}
    </div>
  );
}
function DispatchPdfReview({
  session,
  plan,
  onBack,
  onScheduled,
  canApprove = false,
}: any) {
  const frame = useRef<HTMLDivElement>(null);
  const [documentLoaded, setDocumentLoaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewOpened, setPreviewOpened] = useState(false);
  const kind = "dispatch";
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/project-workflow/survey-dispatch-previews/${plan.id}/pdf?kind=${kind}`;
  return (
    <div className="pz-stack">
      <Button variant="neutral" onClick={onBack}>
        Back
      </Button>
      <section className="pz-panel">
        <h2>
          {plan.number} · {plan.sites.length} site
          {plan.sites.length === 1 ? "" : "s"}
        </h2>
        <p>
          Scheduled date: {plan.date} · Surveyors:{" "}
          {plan.surveyors.map((person: any) => person.display_name).join(", ")}
        </p>
        <p>
          {plan.closed
            ? "Dispatch closed"
            : plan.approved
              ? "Dispatch approved and assigned"
              : "Dispatch preview only — schedules are already saved; dispatch has not been assigned."}
        </p>
        <div className="pz-table-scroll">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Customer / site</th>
                <th>Address</th>
                <th>Site contact</th>
              </tr>
            </thead>
            <tbody>
              {plan.sites.map((site: any) => (
                <tr key={site.recordId}>
                  <td>
                    {site.customerCode} · {site.site} ({site.code})
                  </td>
                  <td>{site.address || "Not entered"}</td>
                  <td>
                    {site.contact || "Not entered"} ·{" "}
                    {site.phone || "Not entered"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Button
        variant="secondary"
        aria-expanded={previewOpen}
        aria-pressed={previewOpen}
        aria-controls={`dispatch-preview-${plan.id}`}
        onClick={() => {
          setPreviewOpen(!previewOpen);
          setPreviewOpened(true);
        }}
      >
        Preview Dispatch
      </Button>
      {previewOpened && (
        <div
          id={`dispatch-preview-${plan.id}`}
          ref={frame}
          hidden={!previewOpen}
        >
          <DocumentPreview
            url={url}
            title={`${plan.number} - Survey Dispatch Order`}
            onReady={() => setDocumentLoaded(true)}
          />
        </div>
      )}
      <label className="pz-review-check">
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
        />
        I have reviewed the sites, surveyors, date and document preview.
      </label>
      <div className="pz-action-row">
        <Button
          variant="secondary"
          disabled={!verified || !documentLoaded}
          onClick={() => {
            const images = Array.from(
              frame.current?.querySelectorAll<HTMLImageElement>(
                ".ipo-preview-pages img",
              ) ?? [],
            );
            const printWindow = window.open("", "_blank");
            if (!printWindow || !images.length) {
              setError(
                "Allow the print window, or download the reviewed PDF to print it.",
              );
              return;
            }
            printWindow.document.write(
              "<!doctype html><html><head><title>Survey Dispatch</title><style>@page{size:A4;margin:0}body{margin:0}img{display:block;width:210mm;height:auto;break-after:page}img:last-child{break-after:auto}</style></head><body>" +
                images
                  .map(
                    (image) =>
                      `<img src="${image.src}" alt="Survey document page">`,
                  )
                  .join("") +
                "</body></html>",
            );
            printWindow.document.close();
            Promise.all(
              Array.from(printWindow.document.images).map((image) =>
                image.complete
                  ? Promise.resolve()
                  : new Promise((resolve) => {
                      image.onload = resolve;
                      image.onerror = resolve;
                    }),
              ),
            ).then(() => {
              printWindow.focus();
              printWindow.print();
            });
          }}
        >
          Print {kind === "dispatch" ? "Dispatch Order" : "Survey Forms"}
        </Button>
        {canApprove && !plan.approved && !plan.closed && (
          <Button
            variant="primary"
            loading={busy}
            disabled={!verified || !documentLoaded}
            onClick={async () => {
              setError("");
              setBusy(true);
              try {
                await api(
                  `/project-workflow/survey-dispatch-previews/${plan.id}/approve`,
                  { csrf: session.csrfToken, body: {} },
                );
                await onScheduled();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve Dispatch
          </Button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}
function DispatchViewer({ session, dispatchId, onBack }: any) {
  const [plan, setPlan] = useState<any>();
  const [error, setError] = useState("");
  const reload = () =>
    api(`/project-workflow/survey-dispatches/${dispatchId}`).then(setPlan);
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [dispatchId]);
  return plan ? (
    <div className="pz-stack">
      <DispatchPdfReview session={session} plan={plan} onBack={onBack} />
      {!plan.closed && (
        <Action
          title="Close Dispatch"
          disabled={!plan.canClose}
          onSubmit={async (f) => {
            await api(
              `/project-workflow/survey-dispatches/${dispatchId}/close`,
              { csrf: session.csrfToken, body: { reason: f.get("reason") } },
            );
            await reload();
          }}
        >
          <p>
            Close the dispatch when all its survey reports have been submitted.
            Closed dispatches cannot receive more sites; their documents remain
            available.
          </p>
          {!plan.canClose && (
            <p>Complete or return all surveys before closing this dispatch.</p>
          )}
          <Field id="dispatch-closure-reason" label="Closure remarks">
            <textarea id="dispatch-closure-reason" name="reason" required />
          </Field>
        </Action>
      )}
    </div>
  ) : (
    <section className="pz-panel">
      <Button onClick={onBack}>Back</Button>
      {error ? <ErrorText error={error} /> : <p>Opening survey dispatch…</p>}
    </section>
  );
}
function SurveySchedulePlan({ session, refs, detail, onScheduled }: any) {
  const r = detail.record;
  const [editing, setEditing] = useState(false);
  const saved = r.stage === "survey_scheduled" && !editing;
  return (
    <Action
      title="Schedule & Assign Surveyors"
      submitLabel={saved ? "Schedule Saved" : "Save Schedule & Surveyors"}
      disabled={saved}
      onSubmit={async (f) => {
        const team = f.getAll("team").map(String);
        if (!team.length) throw new Error("Select at least one surveyor.");
        await api(`/project-workflow/${r.id}/actions`, {
          csrf: session.csrfToken,
          body: {
            action: "assign",
            version: r.version,
            requestKey: crypto.randomUUID(),
            input: {
              date: f.get("date"),
              team,
              notes:
                "Survey date and surveyors saved by Design. Dispatch assignment is a separate step.",
            },
          },
        });
        await onScheduled();
      }}
    >
      <div className="pz-survey-assignment">
        <Input
          name="date"
          title="Scheduled date"
          type="date"
          value={r.data.scheduledSurveyDate || ""}
          readOnly={saved}
          required
        />
        <SurveyorPicker
          refs={refs}
          session={session}
          value={r.data.surveyTeam ?? []}
          disabled={saved}
        />
      </div>
      {saved ? (
        <>
          <p role="status">
            Schedule saved. The date and selected surveyors are recorded.
          </p>
          <Button variant="neutral" onClick={() => setEditing(true)}>
            Edit Schedule
          </Button>
        </>
      ) : (
        <p className="pz-caption">
          Save the date and surveyors. This module stays on the page with a
          Saved confirmation; dispatch is reviewed separately below.
        </p>
      )}
    </Action>
  );
}
function SurveyDispatchPlan({
  session,
  refs,
  records = [],
  initialId,
  onAssigned,
  onBack,
  embedded = false,
}: any) {
  const [selected, setSelected] = useState<string[]>(
    initialId ? [initialId] : [],
  );
  const [mode, setMode] = useState("new");
  const [dispatch, setDispatch] = useState("");
  const [createdDispatch, setCreatedDispatch] = useState<any>();
  const creationKey = useRef(crypto.randomUUID());
  const [creatingDispatch, setCreatingDispatch] = useState(false);
  const [creationError, setCreationError] = useState("");
  const [plan, setPlan] = useState<any>();
  const eligible = records.filter(
    (site: any) =>
      site.stage === "survey_scheduled" &&
      !site.data.surveyDispatchId &&
      !site.data.surveyInProgress,
  );
  const people = refs.surveyors ?? refs.people;
  if (plan)
    return (
      <DispatchPdfReview
        session={session}
        plan={plan}
        canApprove
        onScheduled={onAssigned}
        onBack={() => setPlan(undefined)}
      />
    );
  return (
    <div className="pz-stack">
      {!embedded && (
        <Button
          variant="neutral"
          onClick={() => {
            if (confirmLeaveWorkspace()) onBack();
          }}
        >
          Back to Scheduled Surveys
        </Button>
      )}
      <Action
        title="Create / Assign Dispatch"
        submitLabel="Review Dispatch"
        disabled={!eligible.length}
        onSubmit={async () => {
          if (!selected.length)
            throw new Error("Select at least one scheduled site.");
          const dispatchId =
            mode === "existing" ? dispatch : createdDispatch?.id;
          if (!dispatchId)
            throw new Error(
              mode === "existing"
                ? "Choose an open dispatch."
                : "Create the dispatch number first.",
            );
          setPlan(
            await api("/project-workflow/survey-dispatches/preview", {
              csrf: session.csrfToken,
              body: { recordIds: selected, dispatchId },
            }),
          );
        }}
      >
        <p>
          Choose the scheduled sites travelling together. Their saved dates and
          surveyors must match. This action does not change their schedules.
        </p>
        {!eligible.length ? (
          <p>No scheduled sites are waiting for dispatch.</p>
        ) : (
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Customer / site</th>
                  <th>Scheduled date</th>
                  <th>Surveyors</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((site: any) => (
                  <tr key={site.id}>
                    <td>
                      <label className="pz-review-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${site.siteCode}`}
                          checked={selected.includes(site.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, site.id]
                                : selected.filter((id) => id !== site.id),
                            )
                          }
                        />
                      </label>
                    </td>
                    <td>
                      {site.customerCode} · {site.site} ({site.siteCode})
                    </td>
                    <td>{site.data.scheduledSurveyDate}</td>
                    <td>
                      {site.data.surveyTeam
                        .map(
                          (id: string) =>
                            people.find((p: any) => p.id === id)
                              ?.display_name ?? "Unconfirmed surveyor",
                        )
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div
          className="pz-action-row"
          role="group"
          aria-label="Dispatch action"
        >
          <Button
            variant="neutral"
            loading={creatingDispatch}
            aria-pressed={mode === "new"}
            onClick={async () => {
              setMode("new");
              setCreationError("");
              if (createdDispatch) return;
              setCreatingDispatch(true);
              try {
                setCreatedDispatch(
                  await api("/project-workflow/survey-dispatches", {
                    csrf: session.csrfToken,
                    body: { requestKey: creationKey.current },
                  }),
                );
              } catch (e) {
                setCreationError((e as Error).message);
              } finally {
                setCreatingDispatch(false);
              }
            }}
          >
            Create new dispatch
          </Button>
          <ErrorText error={creationError} />
          <Button
            variant="neutral"
            aria-pressed={mode === "existing"}
            onClick={() => setMode("existing")}
          >
            Add to existing dispatch
          </Button>
        </div>
        {mode === "new" ? (
          <Field id="created-survey-dispatch-number" label="Dispatch number">
            <input
              id="created-survey-dispatch-number"
              readOnly
              value={createdDispatch?.number ?? ""}
              placeholder="Click Create new dispatch"
            />
          </Field>
        ) : (
          <Field id="survey-dispatch-number" label="Open dispatch">
            <select
              id="survey-dispatch-number"
              value={dispatch}
              onChange={(e) => setDispatch(e.target.value)}
            >
              <option value="">Choose open dispatch</option>
              {(refs.surveyDispatches ?? []).map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.number} · {item.date || "Not yet assigned"} ·{" "}
                  {item.siteCount} sites
                  {item.surveyors ? ` · ${item.surveyors}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {createdDispatch && mode === "new" && (
          <p role="status">
            Dispatch {createdDispatch.number} created. Review it below before
            approving the site assignment.
          </p>
        )}
        <p className="pz-caption">
          Review the dispatch order and survey forms, then Approve Dispatch to
          group these sites.
        </p>
      </Action>
    </div>
  );
}
function SurveyorPicker({ refs, session, value = [], disabled = false }: any) {
  const [people, setPeople] = useState<any[]>(
    refs.surveyors ?? refs.people.filter((p: any) => p.role === "Design"),
  );
  const [selected, setSelected] = useState<string[]>(value);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="pz-stack surveyor-picker">
      <span className="surveyor-label">Surveyors — select one or more</span>
      <div className="surveyor-list">
        {people.map((person) => (
          <label className="pz-review-check" key={person.id}>
            <input
              type="checkbox"
              name="team"
              value={person.id}
              disabled={disabled}
              checked={selected.includes(person.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, person.id]
                    : selected.filter((id) => id !== person.id),
                )
              }
            />
            {person.display_name}
            {person.member_code ? ` · ${person.member_code}` : ""}
          </label>
        ))}
      </div>
      {!disabled && (
        <Button variant="secondary" onClick={() => setAdding(!adding)}>
          Add Team Member
        </Button>
      )}
      {adding && (
        <section className="pz-panel">
          <h3>Add surveyor</h3>
          <Field id="surveyor-name" label="Name">
            <input
              id="surveyor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id="surveyor-phone" label="Contact number (optional)">
            <input
              id="surveyor-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setError("");
              setBusy(true);
              try {
                if (!name.trim())
                  throw new Error("Enter the team member's name.");
                const member = await api<any>("/project-workflow/surveyors", {
                  csrf: session.csrfToken,
                  body: { name, phone },
                });
                setPeople((rows) =>
                  rows.some((row) => row.id === member.id)
                    ? rows
                    : [...rows, member].sort((a, b) =>
                        a.display_name.localeCompare(b.display_name),
                      ),
                );
                setSelected((ids) =>
                  ids.includes(member.id) ? ids : [...ids, member.id],
                );
                setName("");
                setPhone("");
                setAdding(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save Team Member
          </Button>
          <ErrorText error={error} />
        </section>
      )}
    </div>
  );
}
function CreateRecord({
  refs,
  session,
  creating,
  manager,
  onCreated,
  onCancel,
  onOpen,
  selectedSite,
  existingRequest,
  onEdited,
}: any) {
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [customers, setCustomers] = useState(
    existingRequest?.masterReview.customer
      ? [
          existingRequest.masterReview.customer,
          ...refs.customers.filter(
            (c: any) => c.id !== existingRequest.masterReview.customer.id,
          ),
        ]
      : refs.customers,
  );
  const [addedCustomerId, setAddedCustomerId] = useState<string>();
  const [siteChoice, setSiteChoice] = useState(
    String(selectedSite?.id ?? "new"),
  );
  const [customer, setCustomer] = useState(
      String(selectedSite?.customer_id ?? ""),
    ),
    [route, setRoute] = useState(
      existingRequest
        ? existingRequest.record.route
        : creating === "Record PO / Customer Confirmation"
          ? "direct-framework"
          : creating.includes("Pre-agreed")
            ? "survey-framework"
            : creating === "Create BOQ"
              ? "quick-quote"
              : "survey-quote",
    );
  const availableSites = selectedSite
    ? [selectedSite, ...refs.sites.filter((s: any) => s.id !== selectedSite.id)]
    : refs.sites;
  const chosenSite = availableSites.find(
    (s: any) =>
      String(s.id) === siteChoice && String(s.customer_id) === customer,
  );
  return (
    <>
      <Action
        title={
          route.startsWith("survey")
            ? "Review Survey Request"
            : "Create site workflow"
        }
        submitLabel={
          route.startsWith("survey") ? "Review Survey Request" : undefined
        }
        onSubmit={async (f) => {
          if (
            !customer ||
            !customers.some((c: any) => String(c.id) === customer)
          )
            throw new Error("Select a customer before submitting the request.");
          if (siteChoice === "existing")
            throw new Error("Select an existing site first.");
          const siteValues = [
            "siteName",
            "siteCode",
            "region",
            "siteAddress",
            "siteContact",
            "sitePhone",
          ].map((key) => String(f.get(key) ?? "").trim());
          const originalValues = chosenSite
            ? [
                chosenSite.name,
                chosenSite.code,
                chosenSite.region,
                chosenSite.location,
                chosenSite.contact_person,
                chosenSite.contact_phone,
              ].map((v) => String(v ?? "").trim())
            : [];
          const siteChanged =
            !!chosenSite &&
            JSON.stringify(siteValues) !== JSON.stringify(originalValues);
          if (
            siteChanged &&
            (!confirmTransition(
              "Update existing site?",
              "You edited the saved site details. Saving will update the master site and pass the revised details to Design.",
            ) ||
              !confirmTransition(
                "Confirm site changes again",
                "Confirm that these revised site details are correct and should be saved to this customer's existing site.",
              ))
          )
            throw new Error("Site changes were not saved.");
          const payload = {
            requestKey: crypto.randomUUID(),
            customerId: Number(customer),
            siteId:
              chosenSite?.customer_id === Number(customer)
                ? chosenSite.id
                : undefined,
            siteVersion: chosenSite?.version,
            confirmSiteChange: siteChanged,
            customerAddedHere: addedCustomerId === customer,
            siteName: f.get("siteName"),
            siteCode: f.get("siteCode"),
            region: f.get("region"),
            siteAddress: f.get("siteAddress"),
            siteContact: f.get("siteContact"),
            sitePhone: f.get("sitePhone"),
            route,
            frameworkId: f.get("frameworkId") || undefined,
            planningOwnerId: f.get("planningOwnerId") || undefined,
            coordinatorId: f.get("coordinatorId") || undefined,
            notes: f.get("notes"),
            headsup: creating === "Record Customer Heads-up",
          };
          if (onEdited) {
            await onEdited(payload);
            return;
          }
          const r = await api<any>("/project-workflow", {
            csrf: session.csrfToken,
            body: payload,
          });
          await onCreated(r.id);
        }}
      >
        <p>{creating}</p>
        {creating === "Create BOQ" && (
          <Button
            variant="secondary"
            onClick={() => onOpen?.({ target: "boqs" })}
          >
            Open existing New / Revise BOQ form
          </Button>
        )}
        <div className="pz-form-grid">
          <label>
            Customer
            <select
              aria-label="Customer"
              value={customer}
              onChange={(e) => {
                setCustomer(e.target.value);
                setSiteChoice("new");
              }}
              required
            >
              <option value="">Select customer</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.short_code} · {c.name}
                </option>
              ))}
            </select>
            {canWriteMaster(session.user.role, "customers", "new") && (
              <Button
                variant="secondary"
                onClick={() => setAddingCustomer(true)}
              >
                Add customer
              </Button>
            )}
          </label>
          <label>
            Workflow route
            <select value={route} onChange={(e) => setRoute(e.target.value)}>
              {Object.entries(routeNames)
                .filter(
                  ([v]) =>
                    creating !== "Create survey request" ||
                    v.startsWith("survey-"),
                )
                .map(([v, n]) => (
                  <option key={v} value={v}>
                    {n as string}
                  </option>
                ))}
            </select>
          </label>
          <div
            className="pz-field-wide pz-action-row workspace-groups"
            role="group"
            aria-label="Site entry mode"
          >
            <Button
              aria-pressed={siteChoice === "new"}
              onClick={() => setSiteChoice("new")}
            >
              Create new site
            </Button>
            <Button
              aria-pressed={siteChoice !== "new"}
              onClick={() => setSiteChoice("existing")}
            >
              Choose existing site
            </Button>
          </div>
          {siteChoice !== "new" && (
            <label className="pz-field-wide">
              Existing site
              <select
                aria-label="Site selection"
                value={siteChoice}
                onChange={(e) => setSiteChoice(e.target.value)}
              >
                <option value="existing">Select existing site</option>
                {availableSites
                  .filter(
                    (s: any) =>
                      String(s.customer_id) === customer &&
                      s.status === "Active",
                  )
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.code}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <Input
            key={`name-${siteChoice}`}
            name="siteName"
            title="Site name"
            value={chosenSite?.name}
            required
          />
          <Input
            key={`code-${siteChoice}`}
            name="siteCode"
            title="Site / branch code"
            value={chosenSite?.code}
            required
          />
          <Input
            key={`region-${siteChoice}`}
            name="region"
            title="Region"
            value={chosenSite?.region}
          />
          <Input
            key={`address-${siteChoice}`}
            name="siteAddress"
            title="Site address"
            value={chosenSite?.location}
            required={!chosenSite}
          />
          <Input
            key={`contact-${siteChoice}`}
            name="siteContact"
            title="Site contact person"
            value={chosenSite?.contact_person}
          />
          <Input
            key={`phone-${siteChoice}`}
            name="sitePhone"
            title="Site contact number"
            value={chosenSite?.contact_phone}
          />
          {route === "direct-framework" && (
            <label>
              Approved configuration and price version
              <select name="frameworkId" required>
                <option value="">Select approved agreement</option>
                {refs.frameworks
                  .filter(
                    (f: any) =>
                      f.customer_id === Number(customer) &&
                      f.routes?.includes(route),
                  )
                  .map((f: any) => (
                    <option key={f.id} value={f.id}>
                      {f.configuration_key} · v{f.version}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {manager && (
            <People
              {...{ refs }}
              name="coordinatorId"
              title="Coordination owner"
              role="Coordinator"
            />
          )}
        </div>
        <label>
          Original request / notes
          <textarea
            name="notes"
            required
            defaultValue={existingRequest?.record.data.notes ?? ""}
          />
        </label>
        <Button onClick={onCancel}>Cancel</Button>
      </Action>
      {addingCustomer && (
        <NewCustomer
          session={session}
          context="survey request"
          onClose={() => setAddingCustomer(false)}
          onLogout={() => window.location.reload()}
          onCreated={async (id: string) => {
            const updated = await api<any>("/project-workflow/references");
            setCustomers(updated.customers);
            setCustomer(String(id));
            setAddedCustomerId(String(id));
            setSiteChoice("new");
          }}
        />
      )}
    </>
  );
}
function Upload({
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
          <input
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
      <ErrorText error={error} />
    </section>
  );
}
function SurveyReportAttachments({ session, id, files = [], onSaved }: any) {
  return (
    <section className="pz-panel pz-stack">
      <h3>Survey Form & Site Pictures</h3>
      <p>
        Upload the completed survey form and site pictures separately, then
        submit the report for technical review.
      </p>
      <div className="pz-form-grid">
        <SurveyAttachmentGroup
          session={session}
          id={id}
          kind="Survey report"
          title="Attach Survey Report"
          existing={files.filter((f: any) => f.kind === "Survey report")}
          onSaved={onSaved}
        />
        <SurveyAttachmentGroup
          session={session}
          id={id}
          kind="Survey photo"
          title="Attach Site Pictures"
          existing={files.filter((f: any) => f.kind === "Survey photo")}
          onSaved={onSaved}
        />
      </div>
    </section>
  );
}
function SurveyAttachmentGroup({
  session,
  id,
  kind,
  title,
  existing,
  onSaved,
}: any) {
  const [selected, setSelected] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useUnsavedChanges(selected.length > 0);
  const pictures = kind === "Survey photo";
  return (
    <section className="pz-stack">
      <h4>{title}</h4>
      <Field
        id={`survey-upload-${id}-${pictures ? "photos" : "report"}`}
        label={pictures ? "Site pictures" : "Survey report files"}
        hint={`${existing.length}/10 files saved · maximum 8 MB per file`}
      >
        <input
          ref={input}
          id={`survey-upload-${id}-${pictures ? "photos" : "report"}`}
          type="file"
          multiple
          disabled={busy}
          accept={
            pictures
              ? "image/png,image/jpeg"
              : "application/pdf,image/png,image/jpeg"
          }
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            setNotice("");
            setError("");
            if (chosen.length + existing.length > 10) {
              setError("You can attach up to 10 files in this section.");
              setSelected([]);
              e.target.value = "";
              return;
            }
            if (chosen.some((f) => f.size > 8388608)) {
              setError("Each file must be 8 MB or smaller.");
              setSelected([]);
              e.target.value = "";
              return;
            }
            setSelected(chosen);
          }}
        />
      </Field>
      {selected.length > 0 && (
        <p>
          {selected.length} selected: {selected.map((f) => f.name).join(", ")}
        </p>
      )}
      <div>
        <Button
          variant="primary"
          loading={busy}
          disabled={!selected.length || existing.length >= 10}
          onClick={async () => {
            setError("");
            setNotice("");
            setBusy(true);
            let uploaded = 0;
            try {
              for (const file of selected) {
                const base64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () =>
                    resolve(String(reader.result).split(",")[1]);
                  reader.onerror = () =>
                    reject(new Error("Unable to read " + file.name));
                  reader.readAsDataURL(file);
                });
                await api(`/project-workflow/${id}/files`, {
                  csrf: session.csrfToken,
                  body: { kind, filename: file.name, mime: file.type, base64 },
                });
                uploaded++;
              }
              setSelected([]);
              if (input.current) input.current.value = "";
              setNotice(
                `${uploaded} file${uploaded === 1 ? "" : "s"} attached.`,
              );
              await onSaved();
            } catch (e) {
              setSelected(selected.slice(uploaded));
              setError((e as Error).message);
              if (uploaded) {
                setNotice(`${uploaded} files saved before the error.`);
                await onSaved().catch(() => {});
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {title}
        </Button>
        <ErrorText error={error} />
      </div>
      {notice && <p role="status">{notice}</p>}
      {existing.length > 0 && (
        <ul>
          {existing.map((file: any) => (
            <li key={file.id}>
              <a
                href={`/api/project-workflow/${id}/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {file.filename}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function SurveySubmissionGroups({ session, groups, onSent }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const request = useRef<{ signature: string; key: string } | null>(null);
  async function send(group: any) {
    if (
      !window.confirm(
        `Send ${group.number} with ${group.siteCount} site(s), its combined report and UBL Excel to Management? Branch codes: ${group.sites.map((s: any) => s.siteCode).join(", ")}`,
      )
    )
      return;
    setBusy(group.id);
    setError(null);
    const ids = group.sites.map((s: any) => s.recordId),
      signature = JSON.stringify({ groupId: group.id, ids });
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    try {
      await api("/project-workflow/ubl-survey-packages", {
        csrf: session.csrfToken,
        body: {
          groupId: group.id,
          recordIds: ids,
          submit: true,
          remarks: `Survey Submission Group ${group.number}`,
          requestKey: request.current!.key,
        },
      });
      await onSent();
    } catch (e) {
      setError({ id: group.id, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="pz-panel">
      <h2>Combined Surveys — Ready for Management</h2>
      {!groups.length ? (
        <p>No survey submission groups waiting to be sent.</p>
      ) : (
        <div className="pz-table-scroll">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Submission Group</th>
                <th>Sites</th>
                <th>Branch Codes / Sites</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group: any) => (
                <tr key={group.id}>
                  <td>
                    <strong>{group.number}</strong>
                  </td>
                  <td>{group.siteCount}</td>
                  <td>
                    {group.sites.map((site: any) => (
                      <div key={site.recordId}>
                        {site.siteCode} · {site.siteName}
                      </div>
                    ))}
                  </td>
                  <td>
                    <div className="pz-action-row">
                      <Button
                        variant="primary"
                        loading={busy === group.id}
                        disabled={!!busy}
                        loadingLabel="Preparing report & Excel…"
                        onClick={() => void send(group)}
                      >
                        Send to Management
                      </Button>
                      <a
                        href={`/api/project-workflow/survey-submission-groups/${group.id}/xlsx`}
                      >
                        Download Excel
                      </a>
                    </div>
                    {error?.id === group.id && (
                      <ErrorText error={error?.message ?? ""} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function UblSurveyPackageActions({ session, record, onSaved }: any) {
  const selected = [record.id];
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<"save" | "send" | null>(null);
  const request = useRef<{ signature: string; key: string } | null>(null);
  async function submit(send: boolean) {
    if (
      send &&
      !window.confirm(
        "Send this site’s report and UBL Excel to Management? This survey will leave Design Outputs.",
      )
    )
      return;
    const mode = send ? "send" : "save";
    setBusy(mode);
    setError("");
    setFailed(null);
    const signature = JSON.stringify({
      recordIds: selected,
      submit: send,
      remarks,
    });
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await api<any>("/project-workflow/ubl-survey-packages", {
        csrf: session.csrfToken,
        body: {
          recordIds: selected,
          submit: send,
          remarks,
          requestKey: request.current!.key,
        },
      });
      await onSaved(result.status);
    } catch (e) {
      setError((e as Error).message);
      setFailed(mode);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="pz-panel">
      <h2>UBL Report & Excel</h2>
      <p>
        Save this site’s report and Excel information for later bulking, or send
        this site individually to Management.
      </p>
      <Field id="ubl-package-remarks" label="Remarks">
        <textarea
          id="ubl-package-remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          disabled={!!busy}
        />
      </Field>
      <div className="pz-survey-save-actions">
        <div>
          <Button
            variant="secondary"
            disabled={!!busy || !selected.length}
            loading={busy === "save"}
            onClick={() => void submit(false)}
          >
            Save to Send Together
          </Button>
          {failed === "save" && <ErrorText error={error} />}
        </div>
        <div>
          <Button
            variant="primary"
            disabled={!!busy || !selected.length}
            loading={busy === "send"}
            loadingLabel="Preparing report & Excel…"
            onClick={() => void submit(true)}
          >
            Send Report & UBL Excel to Management
          </Button>
          {failed === "send" && <ErrorText error={error} />}
        </div>
      </div>
    </section>
  );
}
function CoordinationCommercialSummary({ session, detail }: any) {
  const [summary, setSummary] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSummary(undefined);
    setError("");
    void api<any>(`/project-workflow/${detail.record.id}/preview`, {
      csrf: session.csrfToken,
      body: { kind: "commercial-summary" },
    })
      .then((result) => {
        if (active) setSummary(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [detail.record.id, detail.record.version]);
  const table = (
    rows: any[],
    total: string,
    perWatt: any,
    totalLabel: string,
  ) => (
    <table className="pz-table">
      <thead>
        <tr>
          <th>Costing Phase</th>
          <th className="numeric">Cost (PKR)</th>
          <th className="numeric">Cost/Watt (PKR/W)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row: any) => (
          <tr key={row.name}>
            <td>{row.name}</td>
            <td className="numeric">
              {row.restricted
                ? "Restricted"
                : row.cost == null
                  ? "Not available"
                  : money(row.cost)}
            </td>
            <td className="numeric">
              {row.restricted
                ? "Restricted"
                : row.perWatt == null
                  ? "N/A"
                  : money(row.perWatt)}
            </td>
          </tr>
        ))}
        <tr>
          <th>{totalLabel}</th>
          <th className="numeric">{money(total)}</th>
          <th className="numeric">
            {perWatt == null ? "N/A" : money(perWatt)}
          </th>
        </tr>
      </tbody>
    </table>
  );
  return (
    <section className="pz-panel">
      <h2>Commercial Review</h2>
      <ErrorText error={error} />
      {!summary && !error && <p>Loading saved project costing…</p>}
      {summary?.pending && <p>{summary.pending}</p>}
      {summary?.rows && (
        <>
          <p>Saved BOQ costing · {summary.number}</p>
          {table(
            summary.rows,
            summary.nonBessTotal,
            summary.nonBessPerWatt,
            "Total Non-BESS Cost",
          )}
          <h3>EPC Costing Breakup</h3>
          {table(
            summary.epc ?? [],
            summary.epcTotal ?? "0",
            summary.epcTotalPerWatt,
            "Total EPC Cost",
          )}
        </>
      )}
    </section>
  );
}
function RecordEditor({
  page,
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
    return (
      <div className="pz-stack">
        <div>
          <Button variant="neutral" onClick={onBack}>
            Back to IPOs Shared
          </Button>
        </div>
        <section className="pz-panel pz-stack">
          <h2>
            {r.customerCode} · {r.site} ({r.siteCode})
          </h2>
          <p>
            PO / approval reference: {r.data.sharedPoReference} · PO date:{" "}
            {r.data.sharedPoDate}
          </p>
          <p>
            IPO and PT breakup shared with Accounts. Final BOQ shared with
            Operations.
          </p>
          <div className="pz-action-row">
            <a
              href={`/api/orders/${r.data.ipoId}/ipo.pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Preview IPO
            </a>
            <a
              href={`/api/orders/${r.data.ipoId}/peachtree.pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Preview PT Breakup
            </a>
          </div>
          {detail.sharedFinalBoq && (
            <details className="pz-form-section">
              <summary>Final BOQ · {detail.sharedFinalBoq.number}</summary>
              <div className="pz-table-scroll">
                <table className="pz-table">
                  <thead>
                    <tr>
                      <th>PT Item ID</th>
                      <th>Description</th>
                      <th>Brand</th>
                      <th className="numeric">Quantity</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sharedFinalBoq.items.map(
                      (item: any, index: number) => (
                        <tr key={index}>
                          <td>{item.itemId}</td>
                          <td>{item.description}</td>
                          <td>{item.brand}</td>
                          <td className="numeric">{item.qty}</td>
                          <td>{item.unit}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      </div>
    );
  if (
    !design &&
    page === coordinationBuckets[6] &&
    r.stage === "customer_tracking"
  )
    return <ConfirmSaleForm {...{ session, detail, action, onBack }} />;
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
      </div>
    );
  if (
    !design &&
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
        <Button
          onClick={() => {
            if (confirmLeaveWorkspace()) void refresh();
          }}
        >
          Refresh record
        </Button>
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
          {r.data.noFeasibleSolution && (
            <div className="pz-panel">
              <h3>Needs Review — No Feasible Solution</h3>
              <p>{r.data.noFeasibleSolution.remarks}</p>
            </div>
          )}
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
        page === coordinationBuckets[6] &&
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
}
function SurveyReviewInputs({
  session,
  refs,
  detail,
  action,
  canEdit = true,
}: any) {
  const r = detail.record;
  const reports = (detail.files ?? []).filter(
    (file: any) => file.kind === "Survey report",
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(reports[0]?.id ?? "");
  const file = reports.find((f: any) => f.id === selected);
  const observations =
    r.data.customerSurveyForms?.["ubl-solar-survey"]?.values ?? {};
  const observed = (key: string, unit: string) =>
    observations[key] == null || observations[key] === ""
      ? "N/A"
      : `${decimalDisplay(observations[key])} ${unit}`;
  const savedInputs = r.data.surveyInputs;
  const inputs = savedInputs ? { ...savedInputs } : undefined;
  if (inputs) {
    inputs.totalWattage =
      inputs.panelQty != null &&
      inputs.panelWattage !== "" &&
      inputs.panelWattage != null
        ? `${decimalDisplay(new Decimal(inputs.panelQty).mul(inputs.panelWattage).toString(), 0)} W`
        : "Not entered";
    const sp = inputs.inverter === "6 kW SP",
      dual = String(inputs.inverter ?? "").startsWith("2×");
    const cable = (keys: string[], sizes: string[], fallback: number) => {
      const used = keys
        .map((key, index) => ({ qty: inputs[key], size: sizes[index] }))
        .filter(
          (row) =>
            row.qty != null && row.qty !== "" && new Decimal(row.qty).gt(0),
        );
      if (used.length)
        return used
          .map((row) => `${row.size} · ${decimalDisplay(row.qty)} m`)
          .join("; ");
      return `${sizes[fallback]} · ${decimalDisplay(inputs[keys[fallback]])} m`;
    };
    inputs.inverterCable = sp
      ? cable(["spInverterTerminationMetres"], ["10mm² 1-core"], 0)
      : cable(
          ["acInverter16", "acInverter25"],
          ["16mm² 4-core", "25mm² 4-core"],
          0,
        );
    inputs.loadCable = sp
      ? cable(["spLoadPanelRunMetres"], ["10mm² 1-core, per conductor run"], 0)
      : cable(
          ["acPanel16", "acPanel25"],
          ["16mm² 4-core", "25mm² 4-core"],
          dual ? 1 : 0,
        );
  }
  const fields = [
    ["family", "Solution family"],
    ["panelQty", "Panel quantity"],
    ["panelWattage", "Panel wattage (W)"],
    ["totalWattage", "Total wattage"],
    ["bessId", "BESS configuration"],
    ["inverter", "Inverter capacity"],
    ["batteryKwh", "Battery capacity (kWh)"],
    ["structure", "Structure"],
    ["dcMetres", "DC cable combined (m)"],
    ["inverterCable", "Inverter cable"],
    ["loadCable", "Load cable"],
    ["earth25", "2.5mm² earth cable (m)"],
    ["earth6", "6mm² earth cable (m)"],
    ["earth10", "10mm² earth cable (m)"],
    ["spIncludeEarthingBore", "Include Earthing Bore?"],
    ["smartMeter", "Extra smart meter"],
    ["genset", "Genset synchronisation"],
  ];
  return (
    <>
      <section className="pz-panel pz-stack">
        <Button
          variant="secondary"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Uploaded Survey Form
        </Button>
        {open && (
          <>
            {reports.length > 1 && (
              <label>
                Survey report file
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {reports.map((f: any) => (
                    <option key={f.id} value={f.id}>
                      {f.filename}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {file ? (
              <DocumentPreview
                key={file.id}
                url={`/api/project-workflow/${r.id}/files/${file.id}`}
                title={file.filename}
                mime={file.mime}
              />
            ) : (
              <p>No uploaded survey report is linked to this request.</p>
            )}
          </>
        )}
      </section>
      <section className="pz-panel pz-stack">
        <h3>Standard BOQ Inputs</h3>
        {canEdit && (
          <Button
            variant="secondary"
            onClick={() => {
              if (editing && !confirmLeaveWorkspace()) return;
              setEditing(!editing);
            }}
          >
            {editing ? "Cancel Editing" : "Edit BOQ Inputs"}
          </Button>
        )}
        {editing ? (
          <StandardSurveyBoqInputs
            key={r.version}
            {...{ session, refs, detail }}
            reviewMode
            action={async (name: string, input: any) => {
              await action(name, input);
              setEditing(false);
            }}
          />
        ) : inputs ? (
          <div className="pz-table-scroll">
            <table className="pz-table">
              <tbody>
                {fields
                  .filter(([key]) => inputs[key] != null)
                  .map(([key, title]) => (
                    <tr key={key}>
                      <th>{title}</th>
                      <td>
                        {typeof inputs[key] === "boolean"
                          ? inputs[key]
                            ? "Yes"
                            : "No"
                          : inputs[key] === ""
                            ? "Not entered"
                            : key === "family"
                              ? label(inputs[key])
                              : String(inputs[key])}
                      </td>
                      <td>
                        {key === "panelQty" && (
                          <div>
                            <span>Available roof space</span>
                            <br />
                            <strong>{observed("roofSpace", "sq. ft.")}</strong>
                          </div>
                        )}
                        {key === "panelWattage" && (
                          <div>
                            <Button variant="secondary" disabled>
                              Check Stock Availability
                            </Button>
                            <small>
                              N/A — live warehouse balances are not connected.
                            </small>
                          </div>
                        )}
                        {key === "bessId" && (
                          <span>Confirm from genset and connected load</span>
                        )}
                        {key === "batteryKwh" && (
                          <span>Check load shedding schedule</span>
                        )}
                        {key === "inverter" && (
                          <div className="pz-boq-review-context">
                            <div>
                              <span>Genset capacity</span>
                              <br />
                              <strong>{observed("gensetKva", "kVA")}</strong>
                            </div>
                            <div>
                              <span>Connected load</span>
                              <br />
                              <strong>{observed("connectedLoad", "kW")}</strong>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Standard BOQ inputs have not been saved.</p>
        )}
      </section>
    </>
  );
}
function SurveyCompletion({ session, refs, detail, action }: any) {
  const [standardOpen, setStandardOpen] = useState(true);
  const [customerFormOpen, setCustomerFormOpen] =
    useState<string>("ubl-solar-survey");
  const r = detail.record;
  const ubl =
    r.customerCode?.toUpperCase() === "UBL" && r.route === "survey-framework";
  const customerForms = (refs.surveyFormTemplates ?? []).filter(
    (template: any) =>
      r.route === "survey-framework" &&
      template.customerCode.toUpperCase() === r.customerCode.toUpperCase(),
  );
  return (
    <section className="pz-panel pz-stack">
      <h3>Completion Report</h3>
      {r.data.surveyReading && (
        <details className="pz-panel" open>
          <summary>
            Read from attached survey reports — review before saving
          </summary>
          <p>
            {r.data.surveyReading.method} ·{" "}
            {r.data.surveyReading.sourceFileIds.length} report pages. No master
            records or engineering approvals were changed.
          </p>
          {r.data.surveyReading.flags.length > 0 && (
            <ul>
              {r.data.surveyReading.flags.map((flag: string) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          )}
        </details>
      )}
      <Button
        variant="secondary"
        aria-expanded={standardOpen}
        aria-controls={`standard-survey-boq-${r.id}`}
        onClick={() => setStandardOpen(!standardOpen)}
      >
        Standard BOQ Input Form
      </Button>
      {(standardOpen || ubl) && (
        <div hidden={!standardOpen} id={`standard-survey-boq-${r.id}`}>
          <StandardSurveyBoqInputs
            key={r.data.surveyInputsSavedAt ?? r.id}
            session={session}
            refs={refs}
            detail={detail}
            action={action}
          />
        </div>
      )}
      {ubl && (
        <div className="pz-form-grid">
          <Field id={`ubl-completion-date-${r.id}`} label="Actual survey date">
            <input
              id={`ubl-completion-date-${r.id}`}
              name="date"
              type="date"
              form={`ubl-survey-form-${r.id}`}
              defaultValue={r.data.actualSurveyDate ?? ""}
            />
          </Field>
          <Field
            id={`ubl-completion-remarks-${r.id}`}
            label="Submission remarks"
          >
            <textarea
              id={`ubl-completion-remarks-${r.id}`}
              name="notes"
              form={`ubl-survey-form-${r.id}`}
              defaultValue={r.data.submissionRemarks ?? ""}
            />
          </Field>
        </div>
      )}
      {customerForms.map((template: any) => (
        <div key={template.key} className="pz-stack">
          <Button
            variant="secondary"
            aria-expanded={customerFormOpen === template.key}
            aria-controls={`customer-survey-${r.id}-${template.key}`}
            onClick={() =>
              setCustomerFormOpen(
                customerFormOpen === template.key ? undefined : template.key,
              )
            }
          >
            {template.payload.label}
          </Button>
          {(ubl || customerFormOpen === template.key) && (
            <div
              hidden={customerFormOpen !== template.key}
              id={`customer-survey-${r.id}-${template.key}`}
            >
              <CustomerSurveyForm
                key={
                  r.data.customerSurveyDrafts?.[template.key]?.savedAt ??
                  r.data.customerSurveyForms?.[template.key]?.savedAt ??
                  template.key
                }
                session={session}
                refs={refs}
                detail={detail}
                template={template}
                action={action}
              />
            </div>
          )}
        </div>
      ))}
      {r.data.surveyInputsSavedAt && (
        <p role="status">Standard BOQ inputs saved for technical review.</p>
      )}
      {!ubl && (
        <Action
          formId={`report-submit-${r.id}`}
          disabled={ubl && !r.data.customerSurveyForms?.["ubl-solar-survey"]}
          title="Complete Submission"
          onSubmit={async (f) => {
            const savedBoq = r.data.surveyInputs;
            if (!savedBoq)
              throw new Error(
                "Complete and save the survey BOQ before sending for technical review.",
              );
            const summary = `${r.customerCode} · ${r.site} (${r.siteCode})\nSurvey date: ${f.get("date")}\nPanels: ${savedBoq.panelQty} × ${savedBoq.panelWattage} W\nBESS: ${savedBoq.bessId ?? "Not entered"}\nDC cable: ${savedBoq.dcMetres} m\nStructure: ${savedBoq.structure}\n${ubl ? "UBL details: saved\n" : ""}Remarks: ${f.get("notes")}`;
            if (
              !confirmTransition(
                "Review & Send for Technical Review",
                `${summary}\n\nSend the saved survey from Scheduled Surveys to Technical Review?`,
              )
            )
              return false;
            await action("report", {
              date: f.get("date"),
              notes: f.get("notes"),
            });
          }}
        >
          {!ubl && (
            <>
              <Input
                name="date"
                title="Actual survey date"
                type="date"
                value={r.data.actualSurveyDate || ""}
                required
              />
              <Field id={`completion-remarks-${r.id}`} label="Remarks">
                <textarea
                  id={`completion-remarks-${r.id}`}
                  name="notes"
                  required
                />
              </Field>
            </>
          )}
          {ubl && !r.data.customerSurveyForms?.["ubl-solar-survey"] && (
            <p>Fill and save all UBL survey details before submitting.</p>
          )}
          <p>
            Attach the completed survey report and site pictures above before
            submitting. Saved BOQ inputs stay linked to this survey.
          </p>
        </Action>
      )}
    </section>
  );
}
function CustomerSurveyForm({ session, refs, detail, template, action }: any) {
  const r = detail.record;
  const saved = r.data.customerSurveyForms?.[template.key];
  const [values, setValues] = useState<any>(
    r.data.customerSurveyDrafts?.[template.key]?.values ??
      saved?.values ??
      r.data.surveyReading?.customerFormValues ??
      {},
  );
  const standard =
    r.data.surveyInputs ?? r.data.surveyReading?.standardInputs ?? {};
  const master = detail.masterReview;
  const shared: any = surveySharedValues(
    standard,
    master.customer,
    master.site,
    (r.data.surveyTeam ?? [])
      .map(
        (id: string) =>
          (refs.surveyors ?? refs.people).find((p: any) => p.id === id)
            ?.display_name ?? "Unconfirmed surveyor",
      )
      .join(", "),
  );
  const fields = template.payload.fields.filter(
    (field: any) =>
      ![
        "customerName",
        "branchCode",
        "branchName",
        "address",
        "contact",
        "phone",
        "email",
        "vendor",
      ].includes(field.key),
  );
  return (
    <Action
      formId={`ubl-survey-form-${r.id}`}
      title={template.payload.label}
      submitLabel="Save Only"
      alternateSubmitLabel="Save and Complete Submission"
      onSubmit={async (f, intent) => {
        const entries: any = {};
        for (const field of fields) {
          if (field.type === "load-table") {
            entries[field.key] = field.items.map(
              (_: string, index: number) => ({
                quantity: String(f.get(`${field.key}-${index}-quantity`) ?? ""),
                estimatedKw: String(
                  f.get(`${field.key}-${index}-estimatedKw`) ?? "",
                ),
                totalKw: String(f.get(`${field.key}-${index}-totalKw`) ?? ""),
              }),
            );
          } else entries[field.key] = String(f.get(field.key) ?? "");
        }
        const standardForm = document.getElementById(
          `standard-boq-form-${r.id}`,
        );
        if (!(standardForm instanceof HTMLFormElement))
          throw new Error("Open the Standard BOQ Input Form before saving.");
        if (!standardForm.checkValidity())
          throw new Error(
            "Complete the Standard BOQ Input Form above, then save both forms together.",
          );
        const input = standardSurveySaveInput(
          new FormData(standardForm),
          detail,
          session,
          r.data.surveyInputs ?? {},
        );
        const completeSubmission = intent === "complete";
        const date = String(f.get("date") ?? "");
        const notes = String(f.get("notes") ?? "").trim();
        if (completeSubmission) {
          if (!date || !notes)
            throw new Error(
              "Enter the actual survey date and submission remarks above before completing submission.",
            );
          const summary = `${r.customerCode} · ${r.site} (${r.siteCode})\nSurvey date: ${date}\nPanels: ${input.survey.panelQty} × ${input.survey.panelWattage} W\nBESS: ${input.survey.bessId ?? "Not entered"}\nUBL details: complete\nRemarks: ${notes}`;
          if (
            !confirmTransition(
              "Save and Complete Submission",
              `${summary}\n\nSave these current inputs and send to Technical Review?`,
            )
          )
            return false;
        }
        await action("save-survey-completion", {
          ...input,
          customerForm: {
            templateKey: template.key,
            templateVersion: template.version,
            values: entries,
          },
          completeSubmission,
          date,
          notes,
        });
      }}
    >
      <p>
        Enter the additional UBL observations from the Multan Surveys sheet.
        Connected load is entered as reported; calculation rules will be added
        later.
      </p>
      {r.data.customerSurveyDrafts?.[template.key] && (
        <p role="status">
          Sample values for local walkthrough — review and save. These are not
          verified site findings.
        </p>
      )}
      {saved && (
        <p role="status">
          UBL survey details saved for Solution Engineer review.
        </p>
      )}
      {[...new Set<string>(fields.map((field: any) => field.group))].map(
        (group) => (
          <fieldset className="pz-customer-survey-group" key={group}>
            <legend>{group}</legend>
            <div className="pz-form-grid">
              {fields
                .filter(
                  (field: any) =>
                    field.group === group && field.type !== "load-table",
                )
                .map((field: any) => {
                  const id = `ubl-field-${r.id}-${field.key}`;
                  const value = field.shared
                    ? String(shared[field.shared] ?? "")
                    : (values[field.key] ?? "");
                  return (
                    <Field
                      key={field.key}
                      id={id}
                      label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`}
                      hint={
                        field.shared ? "Autofilled from shared records" : ""
                      }
                    >
                      {field.shared ? (
                        <input
                          id={id}
                          name={field.key}
                          value={value}
                          readOnly
                        />
                      ) : field.type === "select" ? (
                        <select
                          required
                          id={id}
                          name={field.key}
                          value={value}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [field.key]: e.target.value,
                            })
                          }
                        >
                          <option value="">Not entered</option>
                          {field.options.map((option: string) => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      ) : field.type === "textarea" ? (
                        <textarea
                          required
                          id={id}
                          name={field.key}
                          value={value}
                          maxLength={4000}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [field.key]: e.target.value,
                            })
                          }
                        />
                      ) : (
                        <input
                          required
                          id={id}
                          name={field.key}
                          type={
                            field.shared
                              ? "text"
                              : ["number", "integer"].includes(field.type)
                                ? "number"
                                : field.type === "date"
                                  ? "date"
                                  : "text"
                          }
                          min={
                            ["number", "integer"].includes(field.type)
                              ? 0
                              : undefined
                          }
                          step={
                            field.type === "integer"
                              ? 1
                              : field.type === "number"
                                ? 0.0001
                                : undefined
                          }
                          value={value}
                          readOnly={!!field.shared}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [field.key]: e.target.value,
                            })
                          }
                        />
                      )}
                    </Field>
                  );
                })}
            </div>
            {fields
              .filter(
                (field: any) =>
                  field.group === group && field.type === "load-table",
              )
              .map((field: any) => (
                <div className="pz-table-scroll" key={field.key}>
                  <table className="pz-table">
                    <thead>
                      <tr>
                        <th>Equipment</th>
                        <th>Quantity</th>
                        <th>Reported estimated load (kW)</th>
                        <th>Reported total load (kW)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {field.items.map((equipment: string, index: number) => (
                        <tr key={equipment}>
                          <td>{equipment}</td>
                          {["quantity", "estimatedKw", "totalKw"].map(
                            (column) => (
                              <td key={column}>
                                <input
                                  aria-label={`${equipment} ${column}`}
                                  name={`${field.key}-${index}-${column}`}
                                  type="number"
                                  min={0}
                                  step={column === "quantity" ? 1 : 0.0001}
                                  defaultValue={
                                    values[field.key]?.[index]?.[column] ?? ""
                                  }
                                />
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </fieldset>
        ),
      )}
    </Action>
  );
}
function CustomerSurveySummary({ refs, detail }: any) {
  const saved = detail.record.data.customerSurveyForms ?? {};
  return (
    <>
      {Object.entries(saved).map(([key, form]: any) => {
        const template = (refs.surveyFormTemplates ?? []).find(
          (t: any) => t.key === key && t.version === form.templateVersion,
        );
        if (!template) return null;
        return (
          <details className="pz-panel" key={key}>
            <summary>
              {template.payload.label} — saved survey observations
            </summary>
            <p>
              Connected load is manually reported; no automatic sizing
              calculation has been applied.
            </p>
            <div className="pz-table-scroll">
              <table className="pz-table">
                <tbody>
                  {template.payload.fields
                    .filter(
                      (field: any) =>
                        field.type !== "load-table" &&
                        form.values[field.key] !== "" &&
                        form.values[field.key] != null,
                    )
                    .map((field: any) => (
                      <tr key={field.key}>
                        <th>
                          {field.label}
                          {field.unit ? ` (${field.unit})` : ""}
                        </th>
                        <td>{form.values[field.key]}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {template.payload.fields
              .filter((field: any) => field.type === "load-table")
              .map((field: any) => (
                <div className="pz-table-scroll" key={field.key}>
                  <table className="pz-table">
                    <thead>
                      <tr>
                        <th>Equipment</th>
                        <th>Quantity</th>
                        <th>Estimated load (kW)</th>
                        <th>Reported total (kW)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(form.values[field.key] ?? [])
                        .filter(
                          (row: any) =>
                            row.quantity !== "" ||
                            row.estimatedKw !== "" ||
                            row.totalKw !== "",
                        )
                        .map((row: any) => (
                          <tr key={row.equipment}>
                            <td>{row.equipment}</td>
                            <td>{row.quantity || "Not entered"}</td>
                            <td>{row.estimatedKw || "Not entered"}</td>
                            <td>{row.totalKw || "Not entered"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </details>
        );
      })}
    </>
  );
}
function standardSurveySaveInput(
  f: FormData,
  detail: any,
  session: any,
  initial: any,
) {
  const r = detail.record;
  const family = String(f.get("family"));
  const quantityKeys = [
    "dcMetres",
    "acInverter16",
    "acInverter25",
    "acPanel16",
    "acPanel25",
    "earth25",
    "earth6",
    "earth10",
  ];
  const bessOnly = family === "bess-only";
  const survey: any = {
    family,
    sourceMode: "Survey",
    acTerminationMode: "Measured",
    customerId: r.customerId,
    siteName: r.site,
    siteCode: r.siteCode,
    location: detail.masterReview.site.location ?? r.data.siteAddress ?? "",
    panelQty: bessOnly ? 0 : Number(f.get("panelQty")),
    panelWattage: bessOnly ? "0" : String(f.get("panelWattage") ?? ""),
    structure: bessOnly ? "L1" : String(f.get("structure")),
    bessId: f.get("bessId") || undefined,
    inverter: String(f.get("inverter") ?? ""),
    batteryKwh: Number(f.get("batteryKwh")),
    smartMeter: f.get("smartMeter") === "yes",
    genset: f.get("genset") === "yes",
    spIncludeEarthingBore: f.has("spIncludeEarthingBore"),
    brands: Object.fromEntries(
      ["solar", "inverter", "battery", "cable", "switchgear"].map((k) => [
        k,
        initial.brands?.[k] ?? 0,
      ]),
    ),
    preparedBy: session.user.displayName,
  };
  for (const key of quantityKeys) survey[key] = String(f.get(key) || "0");
  if (bessOnly) {
    survey.dcMetres = "0";
    survey.earth25 = "0";
  }
  if (f.get("spInverterTerminationMetres"))
    survey.spInverterTerminationMetres = String(
      f.get("spInverterTerminationMetres"),
    );
  if (f.get("spLoadPanelTotalMetres"))
    survey.spLoadPanelRunMetres = String(
      Number(f.get("spLoadPanelTotalMetres")) / 2,
    );
  const master = detail.masterReview;
  const masterDetails = {
    customerName: master.customer.name,
    siteName: master.site.name,
    address: master.site.location ?? "",
  };
  return {
    survey,
    masterDetails,
    confirmMasterChange: false,
    customerVersion: master.customer.version,
    siteVersion: master.site.version,
  };
}
function StandardSurveyBoqInputs({
  session,
  refs,
  detail,
  action,
  reviewMode = false,
}: any) {
  const r = detail.record;
  const manual =
    r.customerCode?.toUpperCase() === "UBL" && r.route === "survey-framework";
  const initial = useMemo(
    () =>
      r.data.surveyInputs ??
      (manual
        ? { bessId: "", sourceMode: "Survey", acTerminationMode: "Measured" }
        : (r.data.surveyReading?.standardInputs ?? {
            sourceMode: "Survey",
            acTerminationMode: "Measured",
            location: r.data.siteAddress || r.region,
          })),
    [
      r.id,
      r.data.surveyInputs,
      r.data.surveyReading,
      r.data.siteAddress,
      r.region,
    ],
  );
  const [patch] = useState<Record<string, string>>({});
  const [family, setFamily] = useState(
    initial.family ?? (manual ? "" : "solar-hybrid"),
  );
  const [inverter, setInverter] = useState(
    initial.inverter ?? (manual ? "" : "10 kW"),
  );
  const quantityKeys = [
    "dcMetres",
    "acInverter16",
    "acInverter25",
    "acPanel16",
    "acPanel25",
    "earth25",
    "earth6",
    "earth10",
  ];
  return (
    <Action
      formId={`standard-boq-form-${r.id}`}
      hideSubmit={manual && !reviewMode}
      title="Standard BOQ Input Form"
      submitLabel={reviewMode ? "Save Reviewed BOQ Inputs" : "Save BOQ Inputs"}
      onSubmit={async (f) => {
        if (manual && !reviewMode) return false;
        await action(
          reviewMode ? "review-survey-inputs" : "save-survey-inputs",
          standardSurveySaveInput(f, detail, session, initial),
        );
      }}
    >
      {manual && (
        <p>
          Enter the measured survey values manually. Differences from the
          approved UBL BOQ will be highlighted in Technical Review.
        </p>
      )}
      <div className="survey-grid">
        <label>
          Solution family
          <select
            name="family"
            aria-label="Solution family"
            required
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            {manual && <option value="">Select solution family</option>}
            <option value="solar-hybrid">Solar Hybrid</option>
            <option value="bess-only">BESS / UPS only</option>
          </select>
        </label>
        <div aria-hidden="true" />
      </div>
      <SurveyQuantityFields
        key={family}
        initial={initial}
        patch={patch}
        quick={false}
        manual={manual}
        inverter={inverter}
        onInverter={setInverter}
        bessOnly={family === "bess-only"}
      />
      <p className="pz-caption">
        Brand selection will be completed by Atif during BOQ preparation.
      </p>
    </Action>
  );
}
function AwaitingSurveyRequests({ records = [], onOpen }: any) {
  const [filters, setFilters] = useState({ ...emptyWorkspaceFilters });
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string>();
  const [errorRecord, setErrorRecord] = useState<string>();
  const pending = records
    .filter(
      (r: any) =>
        ["survey_requested", "survey_scheduled"].includes(r.stage) &&
        !r.data.surveyDispatchId,
    )
    .map((r: any) => ({
      ...r,
      siteLabel: r.site,
      site: `${r.site} ${r.siteCode}`,
      reference: [r.siteCode, r.id, ...(r.references ?? [])].join(" "),
    }));
  const visible = pending.filter((r: any) => matchesWorkspace(r, filters));
  return (
    <section className="pz-panel pz-stack">
      <h3>Survey requests awaiting scheduling or dispatch</h3>
      <WorkspaceFilters
        rows={pending}
        value={filters}
        onChange={setFilters}
        compact
        showTaskModes={false}
        searchLabel="Search survey requests"
      />
      <div className="pz-table-scroll">
        <table className="pz-table">
          <thead>
            <tr>
              <th>Customer / site</th>
              <th>Next step</th>
              <th>Saved survey date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r: any) => (
              <tr key={r.id}>
                <td>
                  {r.customerCode} · {r.siteLabel} ({r.siteCode})
                </td>
                <td>
                  {r.stage === "survey_requested"
                    ? "Needs scheduling"
                    : "Schedule saved — needs dispatch"}
                </td>
                <td>{r.data.scheduledSurveyDate || "Not scheduled"}</td>
                <td>
                  <Button
                    variant="secondary"
                    loading={opening === r.id}
                    onClick={async () => {
                      setError("");
                      setErrorRecord(undefined);
                      setOpening(r.id);
                      try {
                        await onOpen(r.id);
                      } catch (e) {
                        setError((e as Error).message);
                        setErrorRecord(r.id);
                      } finally {
                        setOpening(undefined);
                      }
                    }}
                  >
                    {r.stage === "survey_requested"
                      ? "Schedule & Assign Surveyors"
                      : "Create / Assign Dispatch"}
                  </Button>
                  {error && errorRecord === r.id && <ErrorText error={error} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p>No requests match these filters.</p>}
    </section>
  );
}
function ApprovedQuoteSelect({
  refs,
  r,
  value,
  optional = false,
  template = false,
}: any) {
  return (
    <label>
      {optional
        ? "Revised approved quotation (optional)"
        : "Exact approved quotation version"}
      <select
        name="quotationId"
        defaultValue={optional ? "" : (value ?? "")}
        required={!optional}
      >
        <option value="">
          {optional
            ? "Keep original approved basis"
            : "Select approved quotation"}
        </option>
        {(refs.quotations ?? [])
          .filter(
            (q: any) =>
              template ||
              (q.customer_id === r.customerId &&
                q.site_code.toLowerCase() === r.siteCode.toLowerCase()),
          )
          .map((q: any) => (
            <option key={q.id} value={q.id}>
              {q.number} · v{q.version} · {q.site_name}
            </option>
          ))}
      </select>
    </label>
  );
}
function FrameworkSelect({
  refs,
  r,
  optional = false,
  onChange,
  finalOnly = false,
}: any) {
  return (
    <label>
      Approved configuration / version
      <select
        name="frameworkId"
        onChange={(e) => onChange?.(e.target.value)}
        defaultValue={optional ? "" : (r.frameworkId ?? "")}
        required={!optional}
      >
        <option value="">
          {optional
            ? "Keep original approved basis"
            : "Select approved version"}
        </option>
        {refs.frameworks
          .filter(
            (f: any) =>
              f.customer_id === r.customerId &&
              (!finalOnly ||
                f.type !== "ubl-solar" ||
                f.pricing_stage === "Revised"),
          )
          .map((f: any) => (
            <option key={f.id} value={f.id}>
              {f.configuration_key} · v{f.version}
            </option>
          ))}
      </select>
    </label>
  );
}
function QuickSurveyCableComparison({ session, detail }: any) {
  const r = detail.record;
  const [comparison, setComparison] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setComparison(undefined);
    setError("");
    void api<any>(`/project-workflow/${r.id}/preview`, {
      csrf: session.csrfToken,
      body: { kind: "quick-cables" },
    })
      .then((p) => {
        if (live) setComparison(p.cableComparison);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [r.id, r.version]);
  return (
    <section className="pz-panel pz-stack">
      <ErrorText error={error} />
      {comparison?.pending && <p>{comparison.pending}</p>}
      {comparison?.rows?.length > 0 && (
        <>
          <CableQuantityComparison
            rows={comparison.rows}
            title="Quick BOQ Cable Quantities"
            baselineLabel="Quick BOQ qty (m)"
          />
          <p>{comparison.notes}</p>
        </>
      )}
    </section>
  );
}
function CableQuantityComparison({
  rows,
  title = "Cable Quantity Comparison",
  baselineLabel = "Standard qty (m)",
}: any) {
  const cables = rows
    .filter((row: any) => row.field.endsWith("(m)"))
    .filter((row: any) => {
      try {
        return (
          !new Decimal(row.approved).isZero() ||
          !new Decimal(row.entered).isZero()
        );
      } catch {
        return true;
      }
    });
  const difference = (row: any) => {
    try {
      const delta = new Decimal(row.entered).sub(row.approved);
      return delta.isZero()
        ? "0.00 m"
        : `${decimalDisplay(delta.abs().toString())} m ${delta.gt(0) ? "more" : "less"}`;
    } catch {
      return "N/A";
    }
  };
  return (
    <div className="pz-stack">
      <h3>{title}</h3>
      <div className="pz-table-scroll">
        <table className="pz-table">
          <thead>
            <tr>
              <th>Cable</th>
              <th>{baselineLabel}</th>
              <th>Survey qty (m)</th>
              <th>Net quantity change</th>
            </tr>
          </thead>
          <tbody>
            {cables.map((row: any) => (
              <tr
                key={row.field}
                className={row.different ? "pz-survey-difference" : undefined}
              >
                <th>{row.field.replace(/ \(m\)$/, "")}</th>
                <td>{decimalDisplay(row.approved)}</td>
                <td>{decimalDisplay(row.entered)}</td>
                <td>{difference(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>Net quantity change = survey quantity − standard quantity.</p>
    </div>
  );
}
function UblSurveyComparison({
  session,
  refs,
  detail,
  frameworkId,
  choose = false,
}: any) {
  const r = detail.record;
  const [selected, setSelected] = useState(frameworkId ?? r.frameworkId ?? "");
  const [comparison, setComparison] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!choose) setSelected(frameworkId ?? "");
  }, [frameworkId, choose]);
  useEffect(() => {
    let live = true;
    setComparison(undefined);
    setError("");
    if (selected)
      void api<any>(`/project-workflow/${r.id}/preview`, {
        csrf: session.csrfToken,
        body: { kind: "framework", frameworkId: selected },
      })
        .then((p) => {
          if (live) setComparison(p.surveyComparison);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [selected, r.id, r.version]);
  return (
    <section className="pz-panel pz-stack">
      <h3>Survey BOQ vs approved UBL BOQ</h3>
      {choose && (
        <label>
          Approved configuration for comparison
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select approved configuration / version</option>
            {refs.frameworks
              .filter(
                (f: any) =>
                  f.customer_id === r.customerId &&
                  (f.type !== "ubl-solar" || f.pricing_stage === "Revised"),
              )
              .map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.configuration_key} · v{f.version}
                </option>
              ))}
          </select>
        </label>
      )}
      {!selected && (
        <p>
          Select the exact approved configuration to compare the manually
          entered survey.
        </p>
      )}
      <ErrorText error={error} />
      {comparison?.pending && <p>{comparison.pending}</p>}
      {comparison?.rows?.length > 0 && (
        <>
          <p>Differences are shaded and labelled for technical review.</p>
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead>
                <tr>
                  <th>Item / requirement</th>
                  <th>Approved BOQ</th>
                  <th>Entered survey</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows
                  .filter((row: any) => !row.field.endsWith("(m)"))
                  .map((row: any) => (
                    <tr
                      key={row.field}
                      className={
                        row.different ? "pz-survey-difference" : undefined
                      }
                    >
                      <th>{row.field}</th>
                      <td>{row.approved}</td>
                      <td>{row.entered}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <CableQuantityComparison rows={comparison.rows} />
          <p>{comparison.notes}</p>
        </>
      )}
    </section>
  );
}
function TechnicalReview({ session, refs, detail, action }: any) {
  const r = detail.record,
    s = detail.review?.survey ?? detail.record.data.surveyInputs ?? {},
    [preview, setPreview] = useState<any>(detail.review?.costing),
    [selections, setSelections] = useState<Record<string, string>>(
      detail.review?.itemSelections ?? {},
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selectedFramework, setSelectedFramework] = useState(
    r.frameworkId ?? "",
  );
  const [noFeasible, setNoFeasible] = useState(false);
  const framework = r.route.endsWith("framework");
  const quantities: Record<string, string> = {
    panelQty: "Panel quantity",
    panelWattage: "Panel watts",
    dcMetres: "DC cable total metres",
    acInverter16: "16 mm² inverter cable metres",
    acPanel16: "16 mm² load cable metres",
    acPanel25: "25 mm² load cable metres",
    earth25: "2.5 mm² earth metres",
    earth6: "6 mm² earth metres",
    earth10: "10 mm² earth metres",
  };
  function review(f: FormData) {
    const parts = String(f.get("profile") ?? "standard-installation|1").split(
        "|",
      ),
      survey: any = {
        ...s,
        customerId: r.customerId,
        siteName: r.site,
        siteCode: r.siteCode,
        location: f.get("location") ?? "",
        family: f.get("family") ?? "solar-hybrid",
        sourceMode: "Survey",
        structure: f.get("structure") ?? "Elevated",
        bessId: f.get("bessId"),
        inverter: f.get("inverter"),
        batteryKwh: Number(f.get("batteryKwh") ?? 0),
        smartMeter: f.has("smartMeter"),
        genset: f.has("genset"),
        brands: { ...(s.brands ?? {}) },
        preparedBy: session.user.displayName,
      };
    for (const k of Object.keys(quantities))
      survey[k] = k === "panelQty" ? Number(f.get(k)) : String(f.get(k) ?? "0");
    return {
      frameworkId: framework
        ? f.get("frameworkId") || r.frameworkId
        : undefined,
      profileKey: parts[0],
      profileVersion: Number(parts[1]),
      itemSelections: selections,
      markups: Object.fromEntries(
        [...f.entries()]
          .filter(([k]) => k.startsWith("markup:"))
          .map(([k, v]) => [k.slice(7), String(v)]),
      ),
      notes: String(f.get("notes") ?? ""),
      ...(!framework ? { survey } : {}),
    };
  }
  return (
    <Action
      title="Technical Review"
      submitLabel="Submit Technical Review"
      onSubmit={async (f) => {
        if (noFeasible) {
          const notes = String(f.get("notes") ?? "").trim();
          if (!notes)
            throw new Error("Explain why no feasible solution is available.");
          if (
            !confirmTransition(
              "Submit — Needs Review",
              `Send ${r.customerCode} · ${r.site} to Atif marked Needs Review — No Feasible Solution?\n\n${notes}`,
            )
          )
            return false;
          await action("no-feasible-solution", { notes });
          return;
        }
        const input = review(f);
        if (
          !confirmTransition(
            "Submit Technical Review",
            `Mark ${r.customerCode} · ${r.site} (${r.siteCode}) as technically reviewed and share to Coordination?\nThis saves the technical review and moves the project to Submitted to Coordination.`,
          )
        )
          return false;
        await action("submit-technical-review", input);
      }}
    >
      <label className="pz-review-check">
        <input
          type="checkbox"
          checked={noFeasible}
          onChange={(e) => setNoFeasible(e.target.checked)}
        />
        No Feasible Solution
      </label>
      {noFeasible && (
        <p>
          This survey and all entered details will be shared to Atif marked
          Needs Review.
        </p>
      )}
      {!noFeasible && (
        <>
          <p>
            {framework
              ? "Review the exact approved customer configuration. Financial snapshots stay fixed."
              : "Review the approved engineering rules, configuration and survey quantities."}
          </p>
          {framework ? (
            <>
              <FrameworkSelect
                {...{ refs, r }}
                finalOnly
                onChange={setSelectedFramework}
              />
              {r.customerCode?.toUpperCase() === "UBL" &&
                r.route === "survey-framework" && (
                  <UblSurveyComparison
                    {...{ session, refs, detail }}
                    frameworkId={selectedFramework}
                  />
                )}
            </>
          ) : (
            <>
              <div className="pz-form-grid">
                <label>
                  Approved engineering profile
                  <select name="profile">
                    {refs.profiles
                      .filter(
                        (p: any) =>
                          p.key === "standard-installation" ||
                          p.payload.customerShortCode === r.customerCode,
                      )
                      .map((p: any) => (
                        <option key={p.key} value={`${p.key}|${p.version}`}>
                          {p.key} · v{p.version}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Solution family
                  <select
                    name="family"
                    defaultValue={s.family ?? "solar-hybrid"}
                  >
                    <option value="solar-hybrid">Solar hybrid</option>
                    <option value="bess-only">BESS / UPS only</option>
                  </select>
                </label>
                <Input
                  name="location"
                  title="Location"
                  value={s.location ?? r.region}
                />
                <BessSelector initial={s} />
                <label>
                  Structure
                  <select
                    name="structure"
                    defaultValue={s.structure ?? "Elevated"}
                  >
                    {["L1", "L2", "L3", "Elevated"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                {Object.entries(quantities).map(([k, n]) => (
                  <Input
                    key={k}
                    name={k}
                    title={n}
                    type="number"
                    value={s[k] ?? "0"}
                    required
                  />
                ))}
              </div>
              <label>
                <input
                  name="smartMeter"
                  type="checkbox"
                  defaultChecked={s.smartMeter}
                />{" "}
                Additional smart meter
              </label>
              <label>
                <input
                  name="genset"
                  type="checkbox"
                  defaultChecked={s.genset}
                />{" "}
                Genset synchronisation
              </label>
            </>
          )}
        </>
      )}
      <label>
        {noFeasible
          ? "Reason no feasible solution is available"
          : "Technical verification and remarks"}
        <textarea name="notes" required />
      </label>
    </Action>
  );
}
function CostingTable({ preview, refs, selections, setSelections }: any) {
  return (
    <>
      <div className="pz-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Item / rule selection</th>
              <th>PT Item ID</th>
              <th>Qty / unit</th>
              <th>Buying rate</th>
              <th>Cost</th>
              <th>Permitted markup %</th>
            </tr>
          </thead>
          <tbody>
            {preview.lines.map((l: any) => (
              <tr key={l.key}>
                <td>
                  {l.description}
                  <br />
                  {l.brand} · {l.specification}
                </td>
                <td>
                  <select
                    aria-label={`Item ID for ${l.description}`}
                    value={selections[l.key] ?? l.itemId ?? ""}
                    onChange={(e) =>
                      setSelections({ ...selections, [l.key]: e.target.value })
                    }
                  >
                    <option value="">Unconfirmed — requires review</option>
                    {refs.catalogue
                      .filter(
                        (i: any) =>
                          i.item_id === l.itemId || i.rate_key === l.key,
                      )
                      .map((i: any) => (
                        <option key={i.item_id} value={i.item_id}>
                          {i.item_id} · {i.payload.brandCategory}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  {l.qty} {l.unit}
                </td>
                <td>{l.restricted ? "Restricted" : money(l.rate)}</td>
                <td>{l.restricted ? "Restricted" : money(l.cost)}</td>
                <td>
                  {l.restricted ? (
                    "Restricted"
                  ) : (
                    <input
                      name={`markup:${l.key}`}
                      defaultValue={l.markup ?? "0"}
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={`Markup for ${l.description}`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>
          {preview.totalLabel}: PKR {money(preview.total)}
        </strong>
      </p>
      {preview.warnings?.map((w: string, i: number) => (
        <p key={i} className="muted-label">
          {w}
        </p>
      ))}
    </>
  );
}
function DifferenceTable({ differences }: any) {
  return differences.length ? (
    <div className="pz-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Difference</th>
            <th>Approved</th>
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {differences.map((d: any) => (
            <tr key={d.field}>
              <td>{d.field}</td>
              <td>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(d.approved, null, 2)}
                </pre>
              </td>
              <td>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(d.received, null, 2)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p>The entered PO matches the selected approved basis.</p>
  );
}
function PoEntry({ session, refs, detail, action }: any) {
  const r = detail.record,
    [basis, setBasis] = useState<any>(detail.basis),
    [actual, setActual] = useState<any>(detail.receipt?.input.actual),
    [differences, setDifferences] = useState<any[]>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const framework = r.route.endsWith("framework");
  return (
    <Action
      title="Complete & Send — compare PO and issue"
      onSubmit={async (f) => {
        if (!actual)
          throw new Error(
            "Load the approved basis and enter the received PO comparison.",
          );
        if (!f.has("reviewed"))
          throw new Error(
            "Confirm that all quantities, brands, values, tax and terms were checked against the attachment.",
          );
        if (
          !confirmTransition(
            "Record PO comparison",
            "A match issues the IPO to Accounts and BOQ to Operations. A mismatch goes to Management.",
          )
        )
          return;
        await action("receipt", {
          reference: f.get("reference"),
          date: f.get("date"),
          evidenceId: f.get("evidenceId"),
          basisType: framework ? "framework" : "quotation",
          frameworkId: framework ? basis?.source.id : undefined,
          quotationId: !framework ? basis?.source.id : undefined,
          actual,
          reviewed: true,
          customerNtn: f.get("customerNtn") ?? "",
          customerStrn: f.get("customerStrn") ?? "",
          notes: f.get("notes"),
        });
      }}
    >
      <p>
        Compare against the exact approved version, including scope, Item IDs,
        quantities, selling values, tax and terms.
      </p>
      <div className="pz-form-grid">
        {framework ? (
          <FrameworkSelect {...{ refs, r }} />
        ) : (
          <ApprovedQuoteSelect
            refs={refs}
            r={r}
            value={r.quotation?.id ?? r.data.basisSource?.id}
          />
        )}
        <Input
          name="reference"
          title="PO number / confirmation reference"
          required
        />
        <Input
          name="date"
          title="PO / confirmation date"
          type="date"
          required
        />
        <label>
          PO evidence
          <select name="evidenceId" required>
            <option value="">Select uploaded PO / confirmation</option>
            {detail.files
              .filter((f: any) => f.kind === "PO / confirmation")
              .map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.filename}
                </option>
              ))}
          </select>
        </label>
        <Input name="customerNtn" title="Customer NTN (Tax Deal)" />
        <Input name="customerStrn" title="Customer STRN (Tax Deal)" />
      </div>
      <Button
        variant="secondary"
        loading={busy}
        onClick={async (e) => {
          setError("");
          setBusy(true);
          try {
            const f = new FormData(e.currentTarget.closest("form")!);
            const b = await api<any>(`/project-workflow/${r.id}/preview`, {
              csrf: session.csrfToken,
              body: framework
                ? { kind: "framework", frameworkId: f.get("frameworkId") }
                : { kind: "quotation", quotationId: f.get("quotationId") },
            });
            setBasis(b);
            setActual(structuredClone(b.comparison));
            setDifferences(undefined);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Load approved basis for comparison
      </Button>
      <ErrorText error={error} />
      {basis && actual && (
        <>
          <p>
            Source: {basis.source.key} · v{basis.source.version}. Initial
            entries below copy the approved basis; review and correct them to
            match the actual PO.
          </p>
          <ComparisonEditor value={actual} onChange={setActual} />
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const p = await api<any>(`/project-workflow/${r.id}/preview`, {
                  csrf: session.csrfToken,
                  body: {
                    kind: framework ? "framework" : "quotation",
                    frameworkId: framework ? basis.source.id : undefined,
                    quotationId: !framework ? basis.source.id : undefined,
                    actual,
                  },
                });
                setDifferences(p.differences);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Show differences before saving
          </Button>
          {differences && <DifferenceTable differences={differences} />}
          <label>
            <input type="checkbox" name="reviewed" required /> I checked the
            entered scope, quantities, prices, taxes and terms against the
            attached PO.
          </label>
        </>
      )}
      <label>
        Comparison remarks
        <textarea name="notes" required />
      </label>
    </Action>
  );
}
function ComparisonEditor({ value, onChange }: any) {
  const update = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="pz-stack">
      {["materials", "billing"].map((k) => (
        <section key={k}>
          <h3>
            {k === "materials"
              ? "PO scope and material quantities"
              : "PO selling amounts excluding GST"}
          </h3>
          <div className="pz-table-scroll">
            <table>
              <thead>
                <tr>
                  {(k === "materials"
                    ? [
                        "Item ID",
                        "Description",
                        "Qty",
                        "Unit",
                        "Brand",
                        "Specification",
                      ]
                    : [
                        "Description",
                        "Qty",
                        "Unit",
                        "Rate",
                        "Amount",
                        "Tax rate %",
                      ]
                  ).map((n) => (
                    <th key={n}>{n}</th>
                  ))}
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {value[k].map((l: any, i: number) => (
                  <tr key={l.lineId}>
                    {(k === "materials"
                      ? [
                          "itemId",
                          "description",
                          "qty",
                          "unit",
                          "brand",
                          "specification",
                        ]
                      : [
                          "description",
                          "qty",
                          "unit",
                          "rate",
                          "amount",
                          "taxRate",
                        ]
                    ).map((field) => (
                      <td key={field}>
                        <input
                          aria-label={`${k} ${i + 1} ${field}`}
                          value={l[field]}
                          onChange={(e) =>
                            update(
                              k,
                              value[k].map((x: any, n: number) =>
                                n === i ? { ...x, [field]: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <Button
                        onClick={() =>
                          update(
                            k,
                            value[k].filter((_: any, n: number) => n !== i),
                          )
                        }
                      >
                        Remove line
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            onClick={() =>
              update(k, [
                ...value[k],
                k === "materials"
                  ? {
                      lineId: crypto.randomUUID(),
                      itemId: "",
                      description: "",
                      qty: "0",
                      unit: "PCS",
                      brand: "",
                      specification: "",
                    }
                  : {
                      lineId: crypto.randomUUID(),
                      description: "",
                      qty: "0",
                      unit: "JOB",
                      rate: "0",
                      amount: "0",
                      taxRate: "18",
                    },
              ])
            }
          >
            Add received PO line
          </Button>
        </section>
      ))}
      <div className="pz-form-grid">
        {["subtotal", "discount", "tax", "total"].map((k) => (
          <label key={k}>
            {label(k)}
            <input
              value={value[k]}
              onChange={(e) => update(k, e.target.value)}
            />
          </label>
        ))}
        <label>
          Deal type
          <select
            value={value.saleType}
            onChange={(e) => update("saleType", e.target.value)}
          >
            <option>Tax Deal</option>
            <option>Cash Deal</option>
          </select>
        </label>
        <label>
          Invoice company
          <input
            value={value.invoiceCompany}
            onChange={(e) => update("invoiceCompany", e.target.value)}
          />
        </label>
        {value.saleType === "Cash Deal" && (
          <label>
            Cash deal GST treatment
            <input
              value={value.cashGstTreatment}
              onChange={(e) => update("cashGstTreatment", e.target.value)}
            />
          </label>
        )}
        {Object.entries(value.terms).map(([k, v]) => (
          <label key={k}>
            {label(k)} terms
            <textarea
              value={String(v)}
              onChange={(e) =>
                update("terms", { ...value.terms, [k]: e.target.value })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function FrameworkEditor({ session, refs, onSaved }: any) {
  return (
    <details className="pz-panel">
      <summary>Approve a pre-agreed customer configuration</summary>
      <Action
        title="Save approved agreement version"
        onSubmit={async (f) => {
          await api("/project-workflow/frameworks", {
            csrf: session.csrfToken,
            body: {
              customerId: Number(f.get("customerId")),
              key: f.get("key"),
              quotationId: f.get("quotationId"),
              sourceReference: f.get("sourceReference"),
              routes: f.getAll("routes"),
            },
          });
          await onSaved();
        }}
      >
        <p>
          Uses an exact approved quotation to freeze scope, Item IDs, amounts,
          taxes, discount and PT allocation for future routes. Existing approved
          versions remain unchanged.
        </p>
        <div className="pz-form-grid">
          <label>
            Customer
            <select name="customerId" required>
              {refs.customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.short_code} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <Input name="key" title="Configuration name / ID" required />
          <ApprovedQuoteSelect refs={refs} template />
          <label>
            <input
              type="checkbox"
              name="routes"
              value="survey-framework"
              defaultChecked
            />{" "}
            Permit survey → recommendation → PO
          </label>
          <label>
            <input
              type="checkbox"
              name="routes"
              value="direct-framework"
              defaultChecked
            />{" "}
            Permit direct PO without survey
          </label>
          <Input
            name="sourceReference"
            title="Agreement / approval evidence reference"
            required
          />
        </div>
      </Action>
    </details>
  );
}

function PoRecordSelect({ session, customers, onOpen, onCancel }: any) {
  const [customer, setCustomer] = useState(""),
    [sources, setSources] = useState<any[]>([]),
    [siteId, setSiteId] = useState(""),
    [headsupOnly, setHeadsupOnly] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSources([]);
    setSiteId("");
    if (customer)
      void api<any>(
        `/project-workflow/po-followup-sources?customerId=${customer}`,
      )
        .then((r) => {
          if (active) setSources(r.sources);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [customer]);
  const sites = sources
    .flatMap((source) => source.sites)
    .filter((site) => !headsupOnly || site.hasHeadsup);
  return (
    <section className="pz-panel pz-stack">
      <h2>Record PO</h2>
      <div className="pz-form-grid">
        <Field id="po-customer" label="Select Customer">
          <select
            id="po-customer"
            value={customer}
            onChange={(e) => {
              setCustomer(e.target.value);
              setError("");
            }}
          >
            <option value="">Select customer</option>
            {customers.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="po-followup-site"
          label="Select Site"
          hint="Only sites currently in Customer Follow-up."
        >
          <select
            id="po-followup-site"
            value={siteId}
            disabled={!customer}
            onChange={(e) => setSiteId(e.target.value)}
          >
            <option value="">Select site</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.siteCode} · {site.siteName}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="pz-review-check">
        <input
          type="checkbox"
          checked={headsupOnly}
          onChange={(e) => {
            setHeadsupOnly(e.target.checked);
            setSiteId("");
          }}
        />
        Heads-up only
      </label>
      {customer && !sites.length && (
        <p>
          No {headsupOnly ? "heads-up " : ""}sites awaiting customer follow-up.
        </p>
      )}
      <div className="pz-action-row">
        <Button variant="neutral" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!siteId}
          onClick={() => onOpen(siteId)}
        >
          Enter PO Details
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
