import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api.js";
import "../ops/ops.css";
import "../procurement/procurement.css";
import { fmtAt } from "../procurement/types.js";

interface Kpi { month: string; onTime: number; late: number; missing: number; rate: number | null; items: { site: string; document: string; dueAt: string; submittedAt: string | null; status: "on_time" | "late" | "missing" }[] }
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

/**
 * Quality Control KPI (Moaz, 26 Oct 2026): solar and BESS delivery papers within the first three working hours of the
 * next working day; BESS installation papers within three days of BESS delivery. Missing = past the deadline and still not in.
 */
export function QcKpi() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Kpi | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (m: string) => {
    try { setData(await api<Kpi>(`/qc/kpi?month=${m}`)); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The KPI could not be loaded."); }
  }, []);
  useEffect(() => { void load(month); }, [load, month]);
  return (
    <div className="pr">
      {error && <p className="ops-feedback" role="alert">{error}</p>}
      <div className="ops-banner">Delivery papers (solar DC + pictures, inverter &amp; battery DC) are on time if submitted by 12:00 on the next working day (Mon–Fri). BESS installation papers: within 3 days of BESS delivery.</div>
      <label className="pr-muted">Month <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
      <div className="qc-kpis">
        <section className="ops-card ops-kc"><div className="ops-kc-l">On time</div><div className="ops-kc-v">{data?.onTime ?? "…"}</div><div className="ops-kc-p">{data?.rate != null ? `${data.rate}% of deadlines` : "no deadlines yet"}</div></section>
        <section className="ops-card ops-kc"><div className="ops-kc-l">Late</div><div className="ops-kc-v">{data?.late ?? "…"}</div><div className="ops-kc-p">submitted after the deadline</div></section>
        <section className="ops-card ops-kc"><div className="ops-kc-l">Missing</div><div className="ops-kc-v">{data?.missing ?? "…"}</div><div className="ops-kc-p">past the deadline, not in</div></section>
      </div>
      <section className="ops-card">
        <div className="ops-tc-h"><h3>Deadlines this month</h3><span className="pr-muted">newest first</span></div>
        <div className="pz-table-scroll">
          <table className="ops-table">
            <thead><tr><th>Site</th><th>Document</th><th>Due</th><th>Submitted</th><th>Result</th></tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={5} className="ops-empty">Loading…</td></tr> : data.items.length === 0 ? <tr><td colSpan={5} className="ops-empty">No deadlines in this month.</td></tr> : data.items.map((i, n) => (
                <tr key={n} className={i.status === "missing" ? "qc-red" : undefined}>
                  <td className="site"><b>{i.site}</b></td><td>{i.document}</td><td className="date">{fmtAt(i.dueAt)}</td>
                  <td className="date">{i.submittedAt ? fmtAt(i.submittedAt) : "—"}</td>
                  <td>{i.status === "on_time" ? <span className="sw-chip sw-chip--ok">On time</span> : i.status === "late" ? <span className="sw-chip sw-chip--warning">Late</span> : <span className="sw-chip sw-chip--danger">Missing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
