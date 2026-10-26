import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import "../ops/ops.css";
import "./procurement.css";
import { fmtAt, fmtDay, qty } from "./types.js";

type Level = "ok" | "on_order" | "plan" | "urgent";
interface WatchRow {
  itemKey: string; name: string; unit: string; inStock: string; receivedNeed: string; upcomingNeed: string; onOrder: string;
  minStock: string; leadDays: number; short: string; urgentShort: string; level: Level;
  firstShort: { label: string; kind: string; date: string | null } | null; orderBy: string | null; late: boolean;
  sites: { label: string; kind: "received" | "upcoming"; date: string | null; quantity: string }[];
}
interface Order {
  id: string; number: string; vendor: string; orderReference: string; expectedOn: string | null; status: string; orderedAt: string;
  orderedBy: string | null; receivedAt: string | null; overdue: boolean;
  lines: { itemKey: string; name: string; quantity: string; received: string; unit: string }[];
}
interface Watch { today: string; rows: WatchRow[]; orders: Order[]; defaults: { leadDays: number; summaryHour: number }; can: { change: boolean } }
const CHIP: Record<Level, { cls: string; text: string }> = {
  urgent: { cls: "sw-chip sw-chip--danger", text: "Needed now" },
  plan: { cls: "sw-chip sw-chip--warning", text: "Order ahead" },
  on_order: { cls: "sw-chip", text: "Covered by orders" },
  ok: { cls: "sw-chip sw-chip--ok", text: "Enough" },
};
type OrderLine = { itemKey: string; quantity: string; rate: string };

/**
 * Abu Bakar's inverter, battery and BMS watch (Moaz, 24 Oct 2026): what the coming sites need against Store's stock
 * and his orders, the site that runs out first and the date to order by. He records his orders here; Store receives them.
 */
export function StockWatch({ session }: { session: Session }) {
  const [data, setData] = useState<Watch | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [setting, setSetting] = useState<Record<string, { leadDays: string; minStock: string }>>({});
  const [form, setForm] = useState({ vendor: "", orderReference: "", expectedOn: "", note: "" });
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [password, setPassword] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<Watch>("/procurement/stock-watch")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The stock watch could not be loaded."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const post = async (path: string, body: object, done: string) => {
    setBusy(true);
    try { setData(await api<Watch>(path, { body, csrf: session.csrfToken })); setNotice(done); setError(""); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : "Not saved."); setNotice(""); return false; }
    finally { setBusy(false); }
  };
  const orderFor = (r: WatchRow) => {
    if (lines.some((l) => l.itemKey === r.itemKey)) return;
    setLines([...lines, { itemKey: r.itemKey, quantity: Number(r.short) > 0 ? r.short : "", rate: "" }]);
    document.getElementById("sw-order")?.scrollIntoView({ behavior: "smooth" });
  };
  const submit = async () => {
    // Recording an order needs the password again within the last 5 minutes (Moaz, 24 Oct 2026).
    if (password) {
      try { await api("/auth/confirm-password", { body: { password }, csrf: session.csrfToken }); setPassword(""); }
      catch (e) { setError(e instanceof ApiError ? e.message : "Your password could not be checked."); setNotice(""); return; }
    }
    const ok = await post("/procurement/stock-watch/orders", {
      vendor: form.vendor.trim(), orderReference: form.orderReference.trim(), expectedOn: form.expectedOn || null, note: form.note.trim(),
      lines: lines.map((l) => ({ itemKey: l.itemKey, quantity: l.quantity.trim().replace(/,/g, ""), rate: l.rate.trim() ? l.rate.trim().replace(/,/g, "") : null })),
    }, "Order recorded. It counts as on order now, and Store will receive it.");
    if (ok) { setLines([]); setForm({ vendor: "", orderReference: "", expectedOn: "", note: "" }); }
  };

  const rows = data?.rows ?? [];
  const urgent = rows.filter((r) => r.level === "urgent").length, plan = rows.filter((r) => r.level === "plan").length;
  const name = (key: string) => rows.find((r) => r.itemKey === key)?.name ?? key;
  const unit = (key: string) => rows.find((r) => r.itemKey === key)?.unit ?? "";

  return (
    <div className="ops ops-embed">
      <div className="pr">
        {error && <p className="ops-feedback" role="alert">{error}</p>}
        {notice && !error && <p className="pr-notice" role="status">{notice}</p>}
        <div className="ops-banner">
          Hamza does not buy inverters, batteries or BMS. Short = what the received and upcoming POs need, plus the stock to keep, less what Store has and what is on order.
          Order by = the date the first short site needs it, less the lead time. You are alerted in the bell{data ? `, and by email when email is on, with a summary each morning from ${data.defaults.summaryHour}:00` : ""}.
        </div>
        <div className="sw-kpis">
          <span className="sw-chip sw-chip--danger">{urgent} needed now</span>
          <span className="sw-chip sw-chip--warning">{plan} to order ahead</span>
          <span className="sw-chip">{data?.orders.filter((o) => o.status === "ordered").length ?? 0} orders on the way</span>
        </div>

        <section className="ops-card">
          <div className="ops-tc-h"><h3>Inverters, batteries and BMS</h3><span className="pr-muted">received POs first, then upcoming, each by date</span></div>
          <div className="pz-table-scroll">
            <table className="ops-table">
              <thead><tr><th>Item</th><th className="num">In stock</th><th className="num">Received POs</th><th className="num">Upcoming</th><th className="num">On order</th><th className="num">Keep</th><th className="num">Short</th><th>Order by</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {!data ? <tr><td colSpan={10} className="ops-empty">Loading…</td></tr> : rows.length === 0 ? <tr><td colSpan={10} className="ops-empty">No inverters, batteries or BMS are needed or in stock.</td></tr> : rows.flatMap((r) => {
                  const s = setting[r.itemKey] ?? { leadDays: String(r.leadDays), minStock: r.minStock };
                  const main = (
                    <tr key={r.itemKey}>
                      <td className="site"><b>{r.name}</b><small>{r.unit} · lead time {r.leadDays} days{r.firstShort ? ` · first short: ${r.firstShort.label}` : ""}</small></td>
                      <td className="num">{qty(r.inStock)}</td><td className="num">{qty(r.receivedNeed)}</td><td className="num">{qty(r.upcomingNeed)}</td>
                      <td className="num">{qty(r.onOrder)}</td><td className="num">{qty(r.minStock)}</td>
                      <td className="num"><b>{Number(r.short) > 0 ? qty(r.short) : "—"}</b>{Number(r.urgentShort) > 0 && <small className="pr-muted"> {qty(r.urgentShort)} now</small>}</td>
                      <td>{r.orderBy ? (r.level === "urgent" || r.late ? <b>Now</b> : fmtDay(r.orderBy)) : "—"}</td>
                      <td><span className={CHIP[r.level].cls}>{CHIP[r.level].text}</span></td>
                      <td><span className="pr-actions">
                        <button type="button" className="sw-link" onClick={() => setOpen(open === r.itemKey ? null : r.itemKey)}>{open === r.itemKey ? "Hide" : "Sites"}</button>
                        {data.can.change && Number(r.short) > 0 && <button type="button" className="sw-link" onClick={() => orderFor(r)}>Order</button>}
                      </span></td>
                    </tr>
                  );
                  if (open !== r.itemKey) return [main];
                  return [main, (
                    <tr key={`${r.itemKey}-open`} className="sw-open">
                      <td colSpan={10}>
                        {r.sites.length === 0 ? <p className="pr-muted">No received or upcoming PO needs it.</p> : (
                          <ul className="sw-sites">{r.sites.map((x, i) => <li key={i}><b>{x.label}</b> · {x.kind === "received" ? "customer PO" : "upcoming"}{x.date ? ` · ${fmtDay(x.date)}` : " · no date yet"} · {qty(x.quantity)} {r.unit}</li>)}</ul>
                        )}
                        {data.can.change && (
                          <div className="pr-addrow">
                            <label className="pr-muted">Lead time (days) <input aria-label={`${r.name} lead time`} inputMode="numeric" value={s.leadDays} onChange={(e) => setSetting({ ...setting, [r.itemKey]: { ...s, leadDays: e.target.value } })} /></label>
                            <label className="pr-muted">Keep in stock <input aria-label={`${r.name} stock to keep`} inputMode="decimal" value={s.minStock} onChange={(e) => setSetting({ ...setting, [r.itemKey]: { ...s, minStock: e.target.value } })} /></label>
                            <Button variant="secondary" loading={busy} onClick={() => void post(`/procurement/stock-watch/settings/${encodeURIComponent(r.itemKey)}`, { leadDays: Number(s.leadDays), minStock: s.minStock.trim() || "0" }, `${r.name}: saved.`)}>Save</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )];
                })}
              </tbody>
            </table>
          </div>
        </section>

        {data?.can.change && (
          <section className="ops-card" id="sw-order">
            <div className="ops-tc-h"><h3>Record an order</h3><span className="pr-muted">it counts as on order at once; Store receives it item by item</span></div>
            <div className="pr-additem">
              <div className="pr-addrow">
                <input aria-label="Supplier" placeholder="Supplier" value={form.vendor} maxLength={200} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
                <input aria-label="Order reference" placeholder="Order reference" value={form.orderReference} maxLength={500} onChange={(e) => setForm({ ...form, orderReference: e.target.value })} />
                <label className="pr-muted">Expected <input type="date" aria-label="Expected arrival" value={form.expectedOn} onChange={(e) => setForm({ ...form, expectedOn: e.target.value })} /></label>
              </div>
              {lines.length === 0 ? <p className="pr-muted">Press “Order” on an item above to add it.</p> : (
                <table className="ops-table">
                  <thead><tr><th>Item</th><th className="num">Quantity</th><th className="num">Rate (optional)</th><th></th></tr></thead>
                  <tbody>{lines.map((l, i) => (
                    <tr key={l.itemKey}>
                      <td className="site"><b>{name(l.itemKey)}</b><small>{unit(l.itemKey)}</small></td>
                      <td className="num"><input aria-label={`${name(l.itemKey)} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, n) => (n === i ? { ...x, quantity: e.target.value } : x)))} /></td>
                      <td className="num"><input aria-label={`${name(l.itemKey)} rate`} inputMode="decimal" placeholder="PKR" value={l.rate} onChange={(e) => setLines(lines.map((x, n) => (n === i ? { ...x, rate: e.target.value } : x)))} /></td>
                      <td><button type="button" className="sw-link" onClick={() => setLines(lines.filter((_, n) => n !== i))}>Remove</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              <input aria-label="Note" placeholder="Note (optional)" value={form.note} maxLength={2000} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <label className="pr-muted pr-password">Your password, to record the order (asked again after 5 minutes)
                <input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <div className="pr-actions">
                <Button variant="primary" loading={busy} disabled={!form.vendor.trim() || !form.orderReference.trim() || lines.length === 0 || lines.some((l) => !(Number(l.quantity) > 0))} onClick={() => void submit()}>Record order</Button>
              </div>
            </div>
          </section>
        )}

        <section className="ops-card">
          <div className="ops-tc-h"><h3>Your orders</h3><span className="pr-muted">open orders, and those received in the last 30 days</span></div>
          {!data ? <p className="ops-empty">Loading…</p> : data.orders.length === 0 ? <p className="ops-empty">No orders recorded yet.</p> : (
            <div className="sto-receive">
              {data.orders.map((o) => (
                <div key={o.id} className="sto-order">
                  <div className="sto-order-head"><div>
                    <b>{o.number} · {o.vendor || "—"} {o.status === "received" ? <span className="sw-chip sw-chip--ok">Received</span> : o.overdue ? <span className="sw-chip sw-chip--danger">Overdue</span> : <span className="sw-chip">On the way</span>}</b>
                    <small>{o.orderReference} · ordered {fmtAt(o.orderedAt)}{o.expectedOn ? ` · expected ${fmtDay(o.expectedOn)}` : ""}{o.receivedAt ? ` · received ${fmtAt(o.receivedAt)}` : ""}</small>
                  </div></div>
                  <table className="ops-table">
                    <tbody>{o.lines.map((l) => <tr key={l.itemKey}><td className="site"><b>{l.name}</b></td><td className="num">{qty(l.received)} of {qty(l.quantity)} {l.unit} received</td></tr>)}</tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
