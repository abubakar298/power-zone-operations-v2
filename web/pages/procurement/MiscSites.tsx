import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import "./procurement.css";
import type { MiscCatalogue, MiscCatItem } from "./MiscItemsBoq.js";
import { fmtAt, fmtDay, qty } from "./types.js";

interface MiscSite {
  recordId: string; siteName: string; siteCode: string; customer: string | null; region: string | null;
  optionKey: string | null; optionLabel: string | null; version: number; updatedBy: string; updatedAt: string;
  po: "received" | "upcoming" | "survey" | "delivered"; expectedDelivery: string | null;
  sentAt: string | null; sentBy: string | null; sentNote: string;
  lines: { itemKey: string; name: string; unit: string; quantity: string }[];
}
const PO_CHIP: Record<MiscSite["po"], { cls: string; text: string }> = {
  received: { cls: "sw-chip sw-chip--danger", text: "Customer PO received" },
  upcoming: { cls: "sw-chip sw-chip--warning", text: "Upcoming PO" },
  survey: { cls: "sw-chip", text: "Survey stage" },
  delivered: { cls: "sw-chip sw-chip--ok", text: "Main material delivered" },
};

/**
 * Misc items BOQs from Design, site by site (Moaz, 24 Oct 2026). Hamza sees what each site needs and keeps the misc
 * items list tidy; Shaigan sees what to send and marks it sent. No prices are shown here.
 */
export function MiscSites({ session, mode }: { session: Session; mode: "buyer" | "store" }) {
  const [data, setData] = useState<{ sites: MiscSite[]; can: { send: boolean } } | null>(null);
  const [cat, setCat] = useState<MiscCatalogue | null>(null);
  const [tab, setTab] = useState<"open" | "sent" | "all">("open");
  const [filter, setFilter] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api<{ sites: MiscSite[]; can: { send: boolean } }>("/procurement/misc/sites"), api<MiscCatalogue>("/procurement/misc/catalogue")]);
      setData(s); setCat(c); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "The misc items could not be loaded."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sites = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data?.sites ?? [])
      .filter((s) => (tab === "all" ? true : tab === "sent" ? Boolean(s.sentAt) : !s.sentAt))
      .filter((s) => !f || [s.siteName, s.siteCode, s.customer ?? "", ...s.lines.map((l) => l.name)].some((x) => x.toLowerCase().includes(f)));
  }, [data, tab, filter]);
  // Everything still to send, added up across sites: what Store must have ready.
  const totals = useMemo(() => {
    const m = new Map<string, { name: string; unit: string; quantity: number; sites: number }>();
    for (const s of data?.sites ?? []) if (!s.sentAt) for (const l of s.lines) {
      const row = m.get(l.itemKey) ?? { name: l.name, unit: l.unit, quantity: 0, sites: 0 };
      row.quantity += Number(l.quantity); row.sites += 1; m.set(l.itemKey, row);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [data]);
  const open = (data?.sites ?? []).filter((s) => !s.sentAt).length;

  const sent = async (s: MiscSite) => {
    if (!window.confirm(`Mark the misc items for ${s.siteName} as sent to site? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/procurement/misc/sites/${s.recordId}/sent`, { body: { note: notes[s.recordId] ?? "" }, csrf: session.csrfToken });
      setNotice(`${s.siteName}: misc items marked as sent to site.`); setError(""); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "This was not saved."); setNotice(""); }
    finally { setBusy(false); }
  };

  return (
    <div className="pr">
      {error && <p className="ops-feedback" role="alert">{error}</p>}
      {notice && !error && <p className="pr-notice" role="status">{notice}</p>}
      <section className="ops-card">
        <div className="ops-tc-h">
          <h3>{mode === "store" ? "Misc items to send" : "Misc items by site"}</h3>
          <span className="pr-muted">{mode === "store" ? "filled by Design with the survey report · send them with the site's material" : "filled by Design with the survey report · they count into Inventory status like any other item"}</span>
        </div>
        <div className="ops-tools">
          <div className="ops-tabs">
            {([["open", "To send", open], ["sent", "Sent", (data?.sites.length ?? 0) - open], ["all", "All", data?.sites.length ?? 0]] as const).map(([k, label, n]) => (
              <button type="button" key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label} <span className="n">{n}</span></button>
            ))}
          </div>
          <input className="sto-filter" aria-label="Filter sites" placeholder="Filter: site, code, customer, item…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {!data ? <p className="ops-empty">Loading…</p> : sites.length === 0 ? <p className="ops-empty">{tab === "open" ? "No misc items waiting to be sent." : "No sites here."}</p> : (
          <div className="sto-receive">
            {sites.map((s) => (
              <div key={s.recordId} className="sto-order">
                <div className="sto-order-head">
                  <div>
                    <b>{s.siteName}{s.siteCode ? ` (${s.siteCode})` : ""} <span className={PO_CHIP[s.po].cls}>{PO_CHIP[s.po].text}</span>{s.sentAt && <> <span className="sw-chip sw-chip--ok">Sent to site</span></>}</b>
                    <small>
                      {s.customer ?? "—"}{s.region ? ` · ${s.region}` : ""}{s.optionLabel ? ` · ${s.optionLabel}` : ""} · filled by {s.updatedBy} {fmtAt(s.updatedAt)}
                      {s.expectedDelivery && !s.sentAt ? ` · delivery expected ${fmtDay(s.expectedDelivery)}` : ""}
                      {s.sentAt ? ` · sent by ${s.sentBy} ${fmtAt(s.sentAt)}${s.sentNote ? ` · ${s.sentNote}` : ""}` : ""}
                    </small>
                  </div>
                </div>
                <details className="pr-misc-lines" open={mode === "store" && !s.sentAt}>
                  <summary>{s.lines.length} item{s.lines.length === 1 ? "" : "s"}</summary>
                  <div className="pz-table-scroll">
                    <table className="ops-table">
                      <thead><tr><th>Item</th><th className="num">Quantity</th></tr></thead>
                      <tbody>{s.lines.map((l) => <tr key={l.itemKey}><td className="site"><b>{l.name}</b><small>{l.itemKey}</small></td><td className="num">{qty(l.quantity)} {l.unit}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
                {data.can.send && !s.sentAt && (
                  <div className="sto-order-foot">
                    <input aria-label={`${s.siteName} note`} placeholder="Note (optional): vehicle, anything short" value={notes[s.recordId] ?? ""} maxLength={1000} onChange={(e) => setNotes({ ...notes, [s.recordId]: e.target.value })} />
                    <Button variant="primary" loading={busy} onClick={() => void sent(s)}>Sent to site</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {totals.length > 0 && (
        <section className="ops-card">
          <details>
            <summary className="ops-tc-h"><h3>Totals still to send</h3><span className="pr-muted">{totals.length} items across {open} site{open === 1 ? "" : "s"}</span></summary>
            <div className="pz-table-scroll">
              <table className="ops-table">
                <thead><tr><th>Item</th><th className="num">Total</th><th className="num">Sites</th></tr></thead>
                <tbody>{totals.map(([k, t]) => <tr key={k}><td className="site"><b>{t.name}</b><small>{k}</small></td><td className="num">{qty(t.quantity)} {t.unit}</td><td className="num">{t.sites}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {mode === "buyer" && cat?.can.editItems && <MiscItemsList session={session} cat={cat} onChanged={(items) => setCat({ ...cat, items })} />}
    </div>
  );
}

/** The buyer keeps the misc items list tidy: correct a name or unit, take an item off for new sites, add one. */
function MiscItemsList({ session, cat, onChanged }: { session: Session; cat: MiscCatalogue; onChanged: (items: MiscCatItem[]) => void }) {
  const [edit, setEdit] = useState<Record<string, { name: string; unit: string }>>({});
  const [add, setAdd] = useState({ name: "", unit: "Nos" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const replace = (item: MiscCatItem) => onChanged(cat.items.some((i) => i.itemKey === item.itemKey) ? cat.items.map((i) => (i.itemKey === item.itemKey ? item : i)) : [...cat.items, item]);
  const post = async (path: string, body: object) => {
    setBusy(true); setError("");
    try { const item = await api<MiscCatItem>(path, { body, csrf: session.csrfToken }); replace(item); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : "Not saved."); return false; }
    finally { setBusy(false); }
  };
  return (
    <section className="ops-card">
      <details>
        <summary className="ops-tc-h"><h3>Misc items list</h3><span className="pr-muted">{cat.items.filter((i) => i.active).length} in use · Design picks from this list and can add to it on the spot</span></summary>
        {error && <p className="ops-feedback" role="alert">{error}</p>}
        <div className="pz-table-scroll">
          <table className="ops-table">
            <thead><tr><th>ID</th><th>Name</th><th>Unit</th><th>In use</th><th></th></tr></thead>
            <tbody>
              {cat.items.map((i) => {
                const e = edit[i.itemKey];
                return (
                  <tr key={i.itemKey}>
                    <td>{i.itemKey}</td>
                    <td>{e ? <input aria-label={`${i.itemKey} name`} value={e.name} maxLength={200} onChange={(x) => setEdit({ ...edit, [i.itemKey]: { ...e, name: x.target.value } })} /> : i.name}</td>
                    <td>{e ? <input className="pz-misc-unit" aria-label={`${i.itemKey} unit`} value={e.unit} maxLength={30} onChange={(x) => setEdit({ ...edit, [i.itemKey]: { ...e, unit: x.target.value } })} /> : i.unit}</td>
                    <td><button type="button" className="sw-link" disabled={busy} onClick={() => void post(`/procurement/misc/items/${i.itemKey}/update`, { active: !i.active })}>{i.active ? "Yes · take off" : "No · put back"}</button></td>
                    <td>
                      {e ? (
                        <span className="pr-actions">
                          <Button variant="secondary" loading={busy} disabled={!e.name.trim() || !e.unit.trim()} onClick={async () => {
                            if (await post(`/procurement/misc/items/${i.itemKey}/update`, { name: e.name.trim(), unit: e.unit.trim() })) { const n = { ...edit }; delete n[i.itemKey]; setEdit(n); }
                          }}>Save</Button>
                          <button type="button" className="sw-link" onClick={() => { const n = { ...edit }; delete n[i.itemKey]; setEdit(n); }}>Cancel</button>
                        </span>
                      ) : <button type="button" className="sw-link" onClick={() => setEdit({ ...edit, [i.itemKey]: { name: i.name, unit: i.unit } })}>Edit</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pr-additem">
          <span className="pr-muted">Add an item</span>
          <div className="pr-addrow">
            <input aria-label="New misc item name" placeholder="Name, e.g. Junction Box 4x4" value={add.name} maxLength={200} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            <input className="pz-misc-unit" aria-label="New misc item unit" value={add.unit} maxLength={30} onChange={(e) => setAdd({ ...add, unit: e.target.value })} />
            <Button variant="primary" loading={busy} disabled={!add.name.trim() || !add.unit.trim()} onClick={async () => { if (await post("/procurement/misc/items", { name: add.name.trim(), unit: add.unit.trim() })) setAdd({ name: "", unit: "Nos" }); }}>Add item</Button>
          </div>
        </div>
      </details>
    </section>
  );
}
