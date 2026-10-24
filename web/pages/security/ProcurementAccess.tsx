import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import "../ops/ops.css";
import "../procurement/procurement.css";
import { fmtAt } from "../procurement/types.js";

interface Access {
  grants: { capability: "buyer" | "approver"; reason: string; since: string; email: string; name: string; role: string; active: boolean }[];
  events: { capability: string; action: string; reason: string; ip: string; device: string; at: string; email: string; name: string; actor: string }[];
  people: { email: string; name: string; role: string }[];
}
const LABEL = { buyer: "Buyer (buys and asks for quotations)", approver: "Approver (approves purchase requests)" } as const;

/** Admin grants or removes Procurement buyer and approver by exact email; every change is kept (Moaz, 24 Oct 2026). */
export function ProcurementAccess({ session }: { session: Session }) {
  const [data, setData] = useState<Access | null>(null);
  const [form, setForm] = useState({ email: "", capability: "buyer" as "buyer" | "approver", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try { setData(await api<Access>("/procurement/access")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Procurement access could not be loaded."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = async (body: { email: string; capability: "buyer" | "approver"; action: "grant" | "remove"; reason: string }, done: string) => {
    setBusy(true);
    try { setData(await api<Access>("/procurement/access/change", { body, csrf: session.csrfToken })); setNotice(done); setError(""); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : "Not saved."); setNotice(""); return false; }
    finally { setBusy(false); }
  };

  return (
    <div className="ops ops-embed">
      <div className="pr">
        {error && <p className="ops-feedback" role="alert">{error}</p>}
        {notice && !error && <p className="pr-notice" role="status">{notice}</p>}
        <section className="ops-card">
          <div className="ops-tc-h"><h3>Who has Procurement access</h3><span className="pr-muted">the buyer is an Operations login; the approver is Admin or Management</span></div>
          <div className="pz-table-scroll">
            <table className="ops-table">
              <thead><tr><th>Person</th><th>Access</th><th>Since</th><th>Reason</th><th></th></tr></thead>
              <tbody>
                {!data ? <tr><td colSpan={5} className="ops-empty">Loading…</td></tr> : data.grants.length === 0 ? <tr><td colSpan={5} className="ops-empty">Nobody has Procurement access.</td></tr> : data.grants.map((g) => (
                  <tr key={`${g.email}-${g.capability}`}>
                    <td className="site"><b>{g.name}</b><small>{g.email} · {g.role}{g.active ? "" : " · login switched off"}</small></td>
                    <td>{g.capability === "buyer" ? "Buyer" : "Approver"}</td>
                    <td className="date">{fmtAt(g.since)}</td>
                    <td>{g.reason}</td>
                    <td><button type="button" className="sw-link" disabled={busy} onClick={() => {
                      const reason = window.prompt(`Why remove ${g.capability} access from ${g.email}?`);
                      if (reason && reason.trim().length >= 3) void change({ email: g.email, capability: g.capability, action: "remove", reason: reason.trim() }, `${g.email}: ${g.capability} access removed.`);
                    }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pr-additem">
            <b>Grant access</b>
            <datalist id="pa-people">{data?.people.map((p) => <option key={p.email} value={p.email}>{p.name} · {p.role}</option>)}</datalist>
            <div className="pr-addrow">
              <input aria-label="Exact email" list="pa-people" placeholder="Exact email of the login" value={form.email} maxLength={254} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <select aria-label="Access" value={form.capability} onChange={(e) => setForm({ ...form, capability: e.target.value as "buyer" | "approver" })}>
                <option value="buyer">{LABEL.buyer}</option><option value="approver">{LABEL.approver}</option>
              </select>
            </div>
            <input aria-label="Reason" placeholder="Reason, e.g. new buyer from 1 November" value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <div className="pr-actions">
              <Button variant="primary" loading={busy} disabled={!form.email.trim() || form.reason.trim().length < 3}
                onClick={async () => { if (await change({ email: form.email.trim(), capability: form.capability, action: "grant", reason: form.reason.trim() }, `${form.email.trim()}: ${form.capability} access granted.`)) setForm({ email: "", capability: form.capability, reason: "" }); }}>Grant access</Button>
            </div>
          </div>
        </section>
        <section className="ops-card">
          <div className="ops-tc-h"><h3>History</h3><span className="pr-muted">every grant and removal; it cannot be changed or deleted</span></div>
          <div className="pz-table-scroll">
            <table className="ops-table">
              <thead><tr><th>When</th><th>Change</th><th>For</th><th>By</th><th>Reason</th><th>From</th></tr></thead>
              <tbody>
                {!data || data.events.length === 0 ? <tr><td colSpan={6} className="ops-empty">{data ? "No changes yet. Access given by the original setup is listed above." : "Loading…"}</td></tr> : data.events.map((e, i) => (
                  <tr key={i}>
                    <td className="date">{fmtAt(e.at)}</td>
                    <td>{e.action === "grant" ? "Granted" : "Removed"} {e.capability}</td>
                    <td className="site"><b>{e.name}</b><small>{e.email}</small></td>
                    <td>{e.actor}</td><td>{e.reason}</td><td>{[e.device, e.ip].filter(Boolean).join(" · ")}</td>
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
