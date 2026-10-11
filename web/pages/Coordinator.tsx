import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { StatusBadge } from "../ui/StatusBadge.js";
import { confirmTransition, confirmRevision } from "../confirm.js";
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
export type CoordinatorTarget =
  "boqs" | "pricing" | "quotes" | "orders" | "operations";
const stages = [
  "Survey & Costing Preparation",
  "Quotation approval",
  "Revision required",
  "Customer confirmation",
  "IPO approval",
  "Operations & Accounts Handoff",
  "Approved quotations awaiting send",
];
export function Coordinator({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: (task: any) => void;
}) {
  const manager = ["Admin", "Management"].includes(session.user.role);
  const [workGroup, setWorkGroup] = useState("action"),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("priority");
  const stageLabel = (stage: string) =>
    stage === "Survey & Costing Preparation"
      ? "Survey & BOQ Preparation"
      : stage === "Quotation approval"
        ? "Quotation Approval"
        : stage === "Revision required"
          ? "Revision Required"
          : stage === "Customer confirmation"
            ? "Customer Confirmation"
            : stage === "IPO approval"
              ? "IPO Approval"
              : stage;
  const needsAction = (t: any) =>
    [stages[0], stages[2], stages[5], stages[6]].includes(t.stage);
  const nextAction = (t: any) =>
    t.stage === stages[6]
      ? "Confirm quotation sent"
      : manager
        ? "Open workflow"
        : t.stage === stages[2]
          ? "Revise document"
          : t.stage === stages[5]
            ? "Complete handoff"
            : t.stage === stages[0]
              ? t.target === "boqs"
                ? "Prepare BOQ"
                : t.target === "pricing"
                  ? "Calculate selling price"
                  : "Prepare quotation"
              : t.stage === stages[3]
                ? "Record customer confirmation"
                : "View approval";
  const [includeTraining, setIncludeTraining] = useState(false);
  const [scope, setScope] = useState(manager ? "team" : "mine"),
    [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("All"),
    [approvalsOnly, setApprovalsOnly] = useState(false),
    [overdueOnly, setOverdueOnly] = useState(false),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api<any>(
          `/coordinator?scope=${scope}&includeTraining=${includeTraining}`,
        );
        if (!cancelled) {
          setData(r);
          setError("");
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Unable to load work.");
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15000);
    window.addEventListener("focus", load);
    window.addEventListener("pz:workspace-open", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("pz:workspace-open", load);
    };
  }, [scope, tick, includeTraining]);
  const minutes = (d: string) =>
    Number.isFinite(new Date(d).getTime())
      ? Math.max(0, (Date.now() - new Date(d).getTime()) / 60000)
      : 0;
  const duration = (m: number) =>
    m < 60
      ? `${Math.floor(m)} min`
      : m < 1440
        ? `${Math.floor(m / 60)} hr ${Math.floor(m % 60)} min`
        : `${Math.floor(m / 1440)} days ${Math.floor((m % 1440) / 60)} hr`;
  const overdue = (t: any) =>
    (t.target_minutes && minutes(t.started_at) > t.target_minutes) ||
    (t.preparation_minutes != null &&
      t.preparation_minutes > 15 &&
      t.responsibility === "Coordinator");
  const visibleTasks = (data?.tasks ?? [])
    .filter(
      (t: any) =>
        (filter === "All" || t.stage === filter) &&
        (!overdueOnly || overdue(t)) &&
        (!approvalsOnly || t.responsibility === "Management") &&
        (manager ||
          workGroup === "all" ||
          (workGroup === "action" ? needsAction(t) : !needsAction(t))) &&
        (!search.trim() ||
          [t.customer, t.site, t.reference, stageLabel(t.stage)].some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
          )),
    )
    .sort((a: any, b: any) => {
      if (sort === "customer")
        return (
          String(a.customer ?? "").localeCompare(String(b.customer ?? "")) ||
          String(a.site ?? "").localeCompare(String(b.site ?? ""))
        );
      if (sort === "priority") {
        const difference =
          Number(Boolean(overdue(b))) - Number(Boolean(overdue(a)));
        if (difference) return difference;
      }
      const difference = minutes(b.started_at) - minutes(a.started_at);
      return (
        (sort === "newest" ? -difference : difference) ||
        String(a.id).localeCompare(String(b.id))
      );
    });
  const [feedbackTask, setFeedbackTask] = useState<any>();
  const [feedback, setFeedback] = useState("");
  const action = async (t: any, kind: string, suppliedNotes?: string) => {
    if (kind === "Changes requested" && suppliedNotes === undefined) {
      setFeedbackTask(t);
      setFeedback("");
      return;
    }
    const notes =
      kind === "Changes requested"
        ? (suppliedNotes ?? "")
        : kind === "PO received"
          ? (window.prompt(
              "Enter PO / approval reference. This records receipt; upload evidence in Customer PO & IPO.",
            ) ?? "")
          : "";
    if (["Changes requested", "PO received"].includes(kind) && !notes.trim())
      return;
    if (
      !(await (
        kind === "Changes requested"
          ? confirmRevision
          : async (a: string, d: string) => confirmTransition(a, d)
      )(
        kind === "Submitted"
          ? "Send quotation for approval"
          : kind === "Approved"
            ? "Approve quotation"
            : kind === "PO received"
              ? "Record sale confirmation received"
              : "Request quotation revision",
        `${t.reference ?? "This quotation"} will move to its next workflow stage. ${kind === "PO received" ? "Sale evidence still needs to be uploaded for IPO approval." : ""}`,
      ))
    )
      return;
    setBusy(true);
    try {
      await api("/coordinator/events", {
        body: { quotationId: t.id, kind, notes },
        csrf: session.csrfToken,
      });
      setFeedbackTask(undefined);
      setTick((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to move document.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="coordinator-panel">
      {feedbackTask && (
        <form
          className="survey-form"
          aria-label="Request quotation revision"
          onSubmit={(e) => {
            e.preventDefault();
            void action(feedbackTask, "Changes requested", feedback);
          }}
        >
          <h3>Request revision · {feedbackTask.reference}</h3>
          <label>
            Revision feedback
            <textarea
              aria-label="Revision feedback"
              required
              maxLength={2000}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !feedback.trim()}>
            Confirm revision request
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setFeedbackTask(undefined)}
          >
            Cancel revision request
          </button>
        </form>
      )}

      {manager && (
        <div className="coordination-heading">
          <div>
            <h2>
              {manager ? "Management document hub" : "Operations Coordination"}
            </h2>
            <p>
              {manager
                ? "Review documents by bucket, open the exact record and complete the next approval action."
                : "Choose a work bucket, open a document and complete its next action."}
            </p>
          </div>
          {manager && (
            <label>
              Work scope
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setFilter("All");
                  setData(undefined);
                }}
              >
                <option value="mine">My work</option>
                <option value="team">Team work</option>
              </select>
            </label>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data?.tasks?.some((t: any) => t.training) && (
        <p>
          Identified training records remain visible for practice. Performance
          totals exclude them unless selected below.
        </p>
      )}
      <label className="approval-filter">
        <input
          type="checkbox"
          checked={includeTraining}
          onChange={(e) => setIncludeTraining(e.target.checked)}
        />
        Include identified training records in performance totals
      </label>
      <p className="pz-caption">
        Waiting times show total elapsed time. Existing targets are unchanged; a
        business-hours calendar has not been configured.
      </p>
      <h3>Work stages</h3>
      {manager && (
        <label className="approval-filter">
          <input
            type="checkbox"
            checked={approvalsOnly}
            onChange={(e) => setApprovalsOnly(e.target.checked)}
          />
          Show documents awaiting management action only
        </label>
      )}
      <div className="stage-grid">
        {stages.map((stage) => (
          <button
            key={stage}
            className={`stage-card ${filter === stage ? "selected" : ""}`}
            onClick={() => {
              setFilter(filter === stage ? "All" : stage);
              setWorkGroup("all");
            }}
            aria-pressed={filter === stage}
          >
            <span>{manager ? stage : stageLabel(stage)}</span>
            <strong>
              {
                (data?.tasks ?? []).filter(
                  (t: any) =>
                    t.stage === stage &&
                    (!approvalsOnly || t.responsibility === "Management"),
                ).length
              }
            </strong>
            <small>
              {["Quotation approval", "IPO approval"].includes(stage)
                ? "Management"
                : "Customer confirmation" === stage
                  ? "Customer"
                  : "Coordinator"}
            </small>
            <small>
              {
                (data?.tasks ?? []).filter(
                  (t: any) =>
                    t.stage === stage &&
                    overdue(t) &&
                    (!approvalsOnly || t.responsibility === "Management"),
                ).length
              }{" "}
              overdue
            </small>
          </button>
        ))}
      </div>
      {!manager && (
        <div
          className="pz-action-row workspace-groups"
          role="group"
          aria-label="Work priority"
        >
          {[
            ["action", "Needs My Action"],
            ["waiting", "Waiting on Others"],
          ].map(([value, label]) => (
            <Button
              key={value}
              variant="neutral"
              aria-pressed={workGroup === value}
              onClick={() => {
                setWorkGroup(value);
                setFilter("All");
              }}
            >
              {label} (
              {data
                ? (data.tasks ?? []).filter((t: any) =>
                    value === "action" ? needsAction(t) : !needsAction(t),
                  ).length
                : "—"}
              )
            </Button>
          ))}
        </div>
      )}
      <section className="detail-panel">
        <div className="coordination-heading">
          <h3>
            {manager
              ? "Pending tasks"
              : workGroup === "action"
                ? "My Next Actions"
                : workGroup === "waiting"
                  ? "Waiting on Others"
                  : "Pending tasks"}
            {data ? ` (${visibleTasks.length})` : ""}
          </h3>
          <Button
            variant="neutral"
            onClick={() => {
              setFilter("All");
              setWorkGroup("all");
            }}
            aria-pressed={filter === "All" && (manager || workGroup === "all")}
          >
            All pending tasks
          </Button>
          <label>
            Stage
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setWorkGroup("all");
              }}
            >
              <option>All</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {manager ? s : stageLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="workspace-overdue">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />{" "}
            Overdue only
          </label>
        </div>
        <div className="workspace-filters">
          <Field id="workspace-search" label="Search work">
            <input
              id="workspace-search"
              type="search"
              placeholder="Customer, site, document or stage"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field id="workspace-sort" label="Sort by">
            <select
              id="workspace-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="priority">
                Overdue first, then longest waiting
              </option>
              <option value="oldest">Longest waiting</option>
              <option value="newest">Newest first</option>
              <option value="customer">Customer / site</option>
            </select>
          </Field>
        </div>
        {!manager && (
          <p className="workspace-help">
            {workGroup === "action"
              ? "Prepare BOQs, complete revisions and send ready departmental handoffs."
              : workGroup === "waiting"
                ? "Track Management and customer responses. Open a document when you need to follow up or record confirmation."
                : "All pending work in the selected basket and filters."}
          </p>
        )}
        {!data ? (
          <p>Loading pending work…</p>
        ) : data.total === 0 ? (
          <p>No pending work in this scope.</p>
        ) : (
          <div className="order-table-scroll">
            <table className="order-table">
              <thead>
                <tr>
                  <th>Customer / site</th>
                  <th>Document</th>
                  <th>Stage / responsibility</th>
                  <th>Stage aging</th>
                  <th>Target / status</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((t: any) => (
                  <tr
                    key={`${t.kind}-${t.id}`}
                    className={overdue(t) ? "task-overdue" : ""}
                  >
                    <td>
                      <strong>{t.customer || "Customer not entered"}</strong>
                      <br />
                      {t.site || "Site not entered"}
                      {t.site?.startsWith("SAMPLE") && (
                        <>
                          <br />
                          <small className="sample-badge">
                            Training sample
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {t.reference || "Survey draft"}
                      {t.kind === "IPO evidence" && (
                        <small>
                          Submission {t.id.slice(0, 8)} · PO{" "}
                          {t.po_reference || "Not supplied"} ·{" "}
                          {t.evidence_filename || t.evidence_type} · Received{" "}
                          {new Date(t.started_at).toLocaleString()}
                        </small>
                      )}
                      {t.training && <small>Training record</small>}
                    </td>
                    <td>
                      {manager ? t.stage : stageLabel(t.stage)}
                      <br />
                      <small>{t.responsibility}</small>
                    </td>
                    <td>
                      {duration(minutes(t.started_at))}
                      {t.preparation_minutes != null && (
                        <>
                          <br />
                          <small>
                            Survey → quote active:{" "}
                            {duration(t.preparation_minutes)}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {t.target_minutes
                        ? `${t.target_minutes} min target`
                        : t.preparation_minutes != null
                          ? "15 min survey → quote target"
                          : "Tracking elapsed time"}
                      <br />
                      <StatusBadge tone={overdue(t) ? "warning" : "pending"}>
                        {overdue(t)
                          ? "Overdue"
                          : t.responsibility === "Management"
                            ? "Waiting on Management"
                            : t.responsibility === "Customer"
                              ? "Waiting on customer"
                              : "Action required"}
                      </StatusBadge>
                    </td>
                    <td>
                      <Button variant="secondary" onClick={() => onOpen(t)}>
                        {nextAction(t)}
                      </Button>
                      {t.kind === "Sale confirmation" && (
                        <div className="bucket-actions">
                          {t.status ===
                            "Quotation ready: submit for approval" && (
                            <button
                              disabled={busy}
                              onClick={() => void action(t, "Submitted")}
                            >
                              Send for approval
                            </button>
                          )}
                          {t.status === "Awaiting quotation approval" &&
                            manager && (
                              <>
                                <button
                                  disabled={busy}
                                  onClick={() => void action(t, "Approved")}
                                >
                                  Approve quotation
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void action(t, "Changes requested")
                                  }
                                >
                                  Request revision
                                </button>
                              </>
                            )}
                          {t.status === "Awaiting PO / sale confirmation" && (
                            <button
                              disabled={busy}
                              onClick={() => void action(t, "PO received")}
                            >
                              Record PO / approval received
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleTasks.length === 0 && (
              <p>
                No documents match these filters. Try another stage or clear
                your search and overdue filter.
              </p>
            )}
          </div>
        )}
      </section>
      {manager && (
        <>
          <h3>Performance and turnaround</h3>
          <div className="summary-grid">
            {["BOQs", "Quotations", "IPOs", "Operations handoffs"].map(
              (name, i) => (
                <section className="summary-card" key={name}>
                  <span>{name}</span>
                  <strong>
                    {data?.activity?.[
                      ["boqs", "quotations", "ipos", "handoffs"][i]
                    ] ?? "—"}
                  </strong>
                  <p>Completed in the last 30 days</p>
                </section>
              ),
            )}
            <section className="summary-card">
              <span>Survey → quotation within 15 min</span>
              <strong>
                {data?.performance?.preparation?.onTime ?? 0} /{" "}
                {data?.performance?.preparation?.completed ?? 0}
              </strong>
              <p>
                Recorded completed surveys; excludes costing review waiting time
              </p>
            </section>
          </div>
          <div className="summary-grid">
            {[
              ["approval", "Management quotation review"],
              ["ipo", "PO → IPO preparation"],
              ["handoff", "IPO → Operations handoff"],
            ].map(([key, label]) => (
              <section className="summary-card" key={key}>
                <span>{label}</span>
                <strong>
                  {data?.performance?.[key]?.onTime ?? 0} /{" "}
                  {data?.performance?.[key]?.completed ?? 0}
                </strong>
                <p>
                  Within {data?.performance?.[key]?.target ?? "—"} min ·
                  recorded completed transitions
                </p>
              </section>
            ))}
          </div>
          <p>
            Targets: survey to quotation 15 min of active elapsed time;
            management quotation approval 20 min; PO receipt to IPO preparation
            15 min; saved IPO to Operations handoff 30 min. Timers run
            continuously from recorded events, including outside office hours.
            Management and customer waiting are shown separately. Receipt
            tracking does not replace sale evidence or IPO approval.
          </p>
        </>
      )}
    </section>
  );
}
