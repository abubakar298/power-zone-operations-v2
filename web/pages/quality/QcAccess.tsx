import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import "../ops/ops.css";
import "../procurement/procurement.css";
import { fmtAt } from "../procurement/types.js";

interface Access {
  grants: { email: string; name: string; role: string; active: boolean; reason: string; since: string }[];
  events: { action: string; reason: string; ip: string; device: string; at: string; email: string; name: string; actor: string }[];
  people: { email: string; name: string; role: string }[];
}

/** Admin names who sees Quality Control's site documents and is told on each submission: Shaigan and Accounts people (26 Oct 2026). */
export function QcAccess({ session }: { session: Session }) {
  const [data, setData] = useState<Access | null>(null);
  const [form, setForm] = useState({ email: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try { setData(await api<Access>("/qc/access")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not load."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = async (body: { email: string; action: "grant" | "remove"; reason: string }, done: string) => {
    setBusy(true);
    try { setData(await api<Access>("/qc/access/change", { body, csrf: session.csrfToken })); setNotice(done); setError(""); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : "Not saved."); setNotice(""); return false; }
    finally { setBusy(false); }
  };
  return (
    <div className="ops ops-embed">
      <div className="pr">
        {error && <p className="ops-feedback" role="alert">{error}</p>}
        {notice && !error && <p className="pr-notice" role="status">{notice}</p>}
        <section className="ops-card">
          <div className="ops-tc-h"><h3>Who sees site documents</h3><span className="pr-muted">Store and Accounts logins · they are told on every submission and can view, not change</span></div>
          <div className="pz-table-scroll">
            <table className="ops-table">
              <thead><tr><th>Person</th><th>Since</th><th>Reason</th><th></th></tr></thead>
              <tbody>
                {!data ? <tr><td colSpan={4} className="ops-empty">Loading…</td></tr> : data.grants.length === 0 ? <tr><td colSpan={4} className="ops-empty">Nobody yet. Add Shaigan and the Accounts people below.</td></tr> : data.grants.map((g) => (
                  <tr key={g.email}>
                    <td className="site"><b>{g.name}</b><small>{g.email} · {g.role}{g.active ? "" : " · login switched off"}</small></td>
                    <td className="date">{fmtAt(g.since)}</td><td>{g.reason}</td>
                    <td><button type="button" className="sw-link" disabled={busy} onClick={() => {
                      const reason = window.prompt(`Why stop sharing site documents with ${g.email}?`);
                      if (reason && reason.trim().length >= 3) void change({ email: g.email, action: "remove", reason: reason.trim() }, `${g.email} no longer sees site documents.`);
                    }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pr-additem">
            <b>Share with</b>
            <datalist id="qc-people">{data?.people.map((p) => <option key={p.email} value={p.email}>{p.name} · {p.role}</option>)}</datalist>
            <div className="pr-addrow">
              <input aria-label="Exact email" list="qc-people" placeholder="Exact email of the Store or Accounts login" value={form.email} maxLength={254} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input aria-label="Reason" placeholder="Reason" value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              <Button variant="primary" loading={busy} disabled={!form.email.trim() || form.reason.trim().length < 3}
                onClick={async () => { if (await change({ email: form.email.trim(), action: "grant", reason: form.reason.trim() }, `${form.email.trim()} now sees site documents.`)) setForm({ email: "", reason: "" }); }}>Share</Button>
            </div>
          </div>
        </section>
        <section className="ops-card">
          <div className="ops-tc-h"><h3>History</h3><span className="pr-muted">cannot be changed or deleted</span></div>
          <div className="pz-table-scroll">
            <table className="ops-table">
              <thead><tr><th>When</th><th>Change</th><th>For</th><th>By</th><th>Reason</th></tr></thead>
              <tbody>{!data || data.events.length === 0 ? <tr><td colSpan={5} className="ops-empty">No changes yet.</td></tr> : data.events.map((e, i) => (
                <tr key={i}><td className="date">{fmtAt(e.at)}</td><td>{e.action === "grant" ? "Shared" : "Stopped"}</td><td className="site"><b>{e.name}</b><small>{e.email}</small></td><td>{e.actor}</td><td>{e.reason}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
