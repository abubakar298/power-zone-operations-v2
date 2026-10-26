import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api.js";
import { Button } from "../../ui/Button.js";
import "../ops/ops.css";
import "../procurement/procurement.css";
import { fmtAt } from "../procurement/types.js";

interface Event { id: string; kind: string; email: string; name: string | null; detail: string; method: string; path: string; status: number | null; ip: string; device: string; at: string }
const KIND: Record<string, string> = {
  "sign-in": "Signed in", "sign-in.failed": "Sign-in failed", "sign-in.locked": "Sign-in locked out", "sign-out": "Signed out", "sign-out.idle": "Signed out (idle)",
  "password-check": "Password re-entered", "password-check.failed": "Password re-entry failed", "password-check.locked": "Password re-entry locked out",
  view: "Viewed prices or costs", export: "Exported prices or costs", approval: "Approval", backup: "Backup download",
  "procurement-access.grant": "Procurement access granted", "procurement-access.remove": "Procurement access removed",
};

/** Admin reads and filters the security log (Moaz, 24 Oct 2026). */
export function SecurityLog() {
  const [data, setData] = useState<{ kinds: string[]; events: Event[] } | null>(null);
  const [f, setF] = useState({ kind: "", user: "", from: "", to: "", q: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (filter = f) => {
    setBusy(true);
    try {
      const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v.trim()) as [string, string][]);
      setData(await api(`/security-events${qs.toString() ? `?${qs}` : ""}`)); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "The security log could not be loaded."); }
    finally { setBusy(false); }
  }, [f]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ops ops-embed">
      <div className="pr">
        {error && <p className="ops-feedback" role="alert">{error}</p>}
        <section className="ops-card">
          <div className="ops-tc-h"><h3>Security log</h3><span className="pr-muted">sign-ins, price and cost views and exports, approvals, access changes and backups · newest first · cannot be changed</span></div>
          <div className="ops-tools">
            <select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="">Everything</option>{data?.kinds.map((k) => <option key={k} value={k}>{KIND[k] ?? k}</option>)}
            </select>
            <input className="sto-filter" aria-label="User" placeholder="User name or email" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} />
            <label className="pr-muted">From <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className="pr-muted">To <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            <input className="sto-filter" aria-label="Text" placeholder="Page, IP or detail" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <Button variant="secondary" loading={busy} onClick={() => void load()}>Filter</Button>
          </div>
          <div className="pz-table-scroll">
            <table className="ops-table">
              <thead><tr><th>When</th><th>What</th><th>Who</th><th>Page or detail</th><th>IP</th><th>Device</th></tr></thead>
              <tbody>
                {!data ? <tr><td colSpan={6} className="ops-empty">Loading…</td></tr> : data.events.length === 0 ? <tr><td colSpan={6} className="ops-empty">Nothing matches.</td></tr> : data.events.map((e) => (
                  <tr key={e.id}>
                    <td className="date">{fmtAt(e.at)}</td>
                    <td>{KIND[e.kind] ?? e.kind}{e.status && e.status >= 400 ? <small className="pr-muted"> · {e.status}</small> : null}</td>
                    <td className="site"><b>{e.name ?? (e.email || "—")}</b>{e.name && <small>{e.email}</small>}</td>
                    <td><small>{[e.method && e.path ? `${e.method} ${e.path}` : "", e.detail].filter(Boolean).join(" · ")}</small></td>
                    <td>{e.ip}</td><td>{e.device}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
