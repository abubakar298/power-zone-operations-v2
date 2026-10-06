import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
export type CoordinatorTarget =
  "boqs" | "pricing" | "quotes" | "orders" | "operations";
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
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const r = await api<any>(`/coordinator?scope=${scope}`);
        if (!cancelled) {
          setData(r);
          setError("");
        }
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Unable to load pending work.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 60000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [scope]);
  const age = (date: string) => {
    const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
    return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
  };
  return (
    <section className="coordinator-panel">
      <div className="coordination-heading">
        <div>
          <h2>Operations Coordination</h2>
          <p>Your work from survey through IPO and BOQ handoff.</p>
        </div>
        {["Admin", "Management"].includes(session.user.role) && (
          <label>
            Work scope
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setData(undefined);
                setFilter("All");
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
      <div className="summary-grid">
        <section className="summary-card">
          <span>Pending work</span>
          <strong>{data?.total ?? "—"}</strong>
          <p>Tasks awaiting action</p>
        </section>
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
      </div>
      <section className="detail-panel">
        <div className="coordination-heading">
          <h3>Pending tasks</h3>
          <label>
            Task type
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option>All</option>
              {Object.keys(data?.counts ?? {}).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>
        {!data ? (
          <p>
            {loading ? "Loading pending work…" : "Pending work unavailable."}
          </p>
        ) : data.total === 0 ? (
          <p>No pending work in this scope.</p>
        ) : (
          <div className="order-table-scroll">
            <table className="order-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Reference / site</th>
                  <th>Status</th>
                  <th>Waiting</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.tasks
                  .filter((t: any) => filter === "All" || t.kind === filter)
                  .map((t: any) => (
                    <tr key={`${t.kind}-${t.id}`}>
                      <td>{t.kind}</td>
                      <td>
                        {t.reference}
                        <br />
                        {t.site}
                      </td>
                      <td>{t.status}</td>
                      <td>{age(t.started_at)}</td>
                      <td>
                        <button
                          className="workflow-button"
                          onClick={() => onOpen(t)}
                        >
                          Open workflow
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {data.total > 200 && <p>Showing the 200 oldest pending tasks.</p>}
          </div>
        )}
      </section>
      <p>
        Activity counts are recorded work, not KPI scores. Targets and
        turnaround goals can be configured after you define them.
      </p>
    </section>
  );
}
