import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
export type CoordinatorTarget =
  "boqs" | "pricing" | "quotes" | "orders" | "operations";
const stages = [
  "Survey preparation",
  "Costing review",
  "Quotation preparation",
  "Ready for quotation approval",
  "Quotation approval",
  "Revision required",
  "Customer confirmation",
  "IPO preparation",
  "IPO approval",
  "Operations handoff",
];
export function Coordinator({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: (task: any) => void;
}) {
  const [scope, setScope] = useState("mine"),
    [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("All"),
    [overdueOnly, setOverdueOnly] = useState(false),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(false);
  const manager = ["Admin", "Management"].includes(session.user.role);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api<any>(`/coordinator?scope=${scope}`);
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
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [scope, tick]);
  const minutes = (d: string) =>
    Math.max(0, (Date.now() - new Date(d).getTime()) / 60000);
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
  const action = async (t: any, kind: string) => {
    const notes =
      kind === "Changes requested"
        ? (window.prompt("Enter revision feedback") ?? "")
        : kind === "PO received"
          ? (window.prompt(
              "Enter PO / approval reference. This records receipt; upload evidence in Customer PO & IPO.",
            ) ?? "")
          : "";
    if (["Changes requested", "PO received"].includes(kind) && !notes.trim())
      return;
    setBusy(true);
    try {
      await api("/coordinator/events", {
        body: { quotationId: t.id, kind, notes },
        csrf: session.csrfToken,
      });
      setTick((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to move document.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="coordinator-panel">
      <div className="coordination-heading">
        <div>
          <h2>Operations Coordination</h2>
          <p>
            Choose a work bucket, open a document and complete its next action.
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
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <h3>Work stages</h3>
      <div className="stage-grid">
        {stages.map((stage) => (
          <button
            key={stage}
            className={`stage-card ${filter === stage ? "selected" : ""}`}
            onClick={() => setFilter(filter === stage ? "All" : stage)}
            aria-pressed={filter === stage}
          >
            <span>{stage}</span>
            <strong>{data?.stageCounts?.[stage] ?? 0}</strong>
            <small>
              {[
                "Costing review",
                "Quotation approval",
                "IPO approval",
              ].includes(stage)
                ? "Management"
                : "Customer confirmation" === stage
                  ? "Customer"
                  : "Coordinator"}
            </small>
          </button>
        ))}
      </div>
      <section className="detail-panel">
        <div className="coordination-heading">
          <h3>Pending tasks</h3>
          <label>
            Stage
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option>All</option>
              {stages.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />{" "}
            Overdue only
          </label>
        </div>
        {!data ? (
          <p>Loading pending work…</p>
        ) : data.total === 0 ? (
          <p>No pending work in this scope.</p>
        ) : (
          <div className="order-table-scroll">
            <table className="order-table">
              <thead>
                <tr>
                  <th>Document / site</th>
                  <th>Stage / responsibility</th>
                  <th>Stage aging</th>
                  <th>Target / status</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks
                  .filter(
                    (t: any) =>
                      (filter === "All" || t.stage === filter) &&
                      (!overdueOnly || overdue(t)),
                  )
                  .map((t: any) => (
                    <tr
                      key={`${t.kind}-${t.id}`}
                      className={overdue(t) ? "task-overdue" : ""}
                    >
                      <td>
                        {t.reference}
                        <br />
                        {t.site}
                      </td>
                      <td>
                        {t.stage}
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
                        <strong>
                          {overdue(t) ? "Overdue" : "In progress"}
                        </strong>
                      </td>
                      <td>
                        <button
                          className="workflow-button"
                          onClick={() => onOpen(t)}
                        >
                          Open workflow
                        </button>
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
            {data.tasks.filter(
              (t: any) =>
                (filter === "All" || t.stage === filter) &&
                (!overdueOnly || overdue(t)),
            ).length === 0 && <p>No documents match this bucket.</p>}
          </div>
        )}
      </section>
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
              Within {data?.performance?.[key]?.target ?? "—"} min · recorded
              completed transitions
            </p>
          </section>
        ))}
      </div>
      <p>
        Targets: survey to quotation 15 min of active elapsed time; management
        quotation approval 20 min; PO receipt to IPO preparation 15 min; saved
        IPO to Operations handoff 30 min. Timers run continuously from recorded
        events, including outside office hours. Management and customer waiting
        are shown separately. Receipt tracking does not replace sale evidence or
        IPO approval.
      </p>
    </section>
  );
}
