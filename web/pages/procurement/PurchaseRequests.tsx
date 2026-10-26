import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import "./procurement.css";
import { RfqPanel } from "./RfqPanel.js";
import { fmtAt, fmtDay, pkr, qty, STATUS_CHIP, type RequestDetail, type RequestRow, type RequestStatus } from "./types.js";

const TABS: { key: string; label: string; match: (s: RequestStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "draft", label: "Draft", match: (s) => s === "draft" },
  { key: "pending", label: "With Abu Bakar", match: (s) => s === "pending_approval" },
  { key: "approved", label: "Approved", match: (s) => s === "approved" },
  { key: "ordered", label: "Ordered", match: (s) => s === "ordered" },
  { key: "received", label: "Received", match: (s) => s === "received" },
  { key: "closed", label: "Rejected or cancelled", match: (s) => s === "rejected" || s === "cancelled" },
];
const STEPS: { key: RequestStatus | "quotes"; label: string }[] = [
  { key: "draft", label: "Draft" }, { key: "quotes", label: "Quotations in" }, { key: "pending_approval", label: "With Abu Bakar" },
  { key: "approved", label: "Approved by Abu Bakar" }, { key: "ordered", label: "Ordered" }, { key: "received", label: "Received into Store" },
];
const EVENT_TEXT: Record<string, string> = {
  created: "Created", submitted: "Sent to Abu Bakar", approved: "Approved", sent_back: "Sent back for changes", rejected: "Rejected",
  rfq_sent: "Quotations requested", self_approved: "Self-approved by the buyer", ordered: "Marked ordered", part_received: "Part received into Store", received: "Received into Store", cancelled: "Cancelled",
};

/**
 * Purchase requests: the buyer raises them with quotations; Abu Bakar approves; the buyer orders; Store receives.
 * `mode="approver"` is Abu Bakar's view: it opens on the requests waiting for him and shows the decision buttons.
 */
export function PurchaseRequests({ session, mode, openId, onOpened, onChanged }: {
  session: Session; mode: "buyer" | "approver" | "reader"; openId?: string; onOpened?: () => void; onChanged?: () => void;
}) {
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [tab, setTab] = useState(mode === "approver" ? "pending" : "all");
  const [selected, setSelected] = useState<string | undefined>(openId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    try { setRows((await api<{ requests: RequestRow[] }>("/procurement/requests")).requests); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load purchase requests."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (openId) { setSelected(openId); onOpened?.(); } }, [openId, onOpened]);

  const create = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      const r = await api<RequestDetail>(path, { body, csrf: session.csrfToken });
      setNewTitle(""); setSelected(r.id); onChanged?.(); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "The request was not created."); }
    finally { setBusy(false); }
  };
  const counts = useMemo(() => new Map(TABS.map((t) => [t.key, (rows ?? []).filter((r) => t.match(r.status)).length])), [rows]);
  const visible = useMemo(() => (rows ?? []).filter((r) => TABS.find((t) => t.key === tab)!.match(r.status)), [rows, tab]);

  if (selected) return <RequestPage session={session} id={selected} onBack={() => { setSelected(undefined); void load(); }} onChanged={() => { void load(); onChanged?.(); }} />;
  return (
    <div className="pr">
      {error && <p className="ops-feedback" role="alert">{error}</p>}
      <div className="ops-banner">
        <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 16v.01" /></svg>
        Draft → Quotations in → Sent to Abu Bakar → Approved by Abu Bakar (the only approver) → Ordered by Hamza → Received into Store. Items use rate master IDs; the last approved purchase becomes the item's last buying rate.
      </div>
      {mode === "buyer" && (
        <div className="ops-card pr-new">
          <Field id="pr-new-title" label="New request">
            <input id="pr-new-title" placeholder="Title, for example: Cables for Skardu" value={newTitle} maxLength={200} onChange={(e) => setNewTitle(e.target.value)} />
          </Field>
          <Button variant="neutral" loading={busy} disabled={!newTitle.trim()} onClick={() => void create("/procurement/requests", { title: newTitle.trim() })}>Create empty request</Button>
          <Button variant="primary" loading={busy} onClick={() => void create("/procurement/requests/from-to-buy", {})}>Make a request from "To buy"</Button>
        </div>
      )}
      <section className="ops-card">
        <div className="ops-tabs" role="tablist" aria-label="Status">
          {TABS.map((t) => <button type="button" key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label} <span className="n">{counts.get(t.key) ?? 0}</span></button>)}
        </div>
        <div className="pz-table-scroll">
          <table className="ops-table">
            <thead><tr><th>Request</th><th className="num">Items</th><th className="num">Total (PKR)</th><th>Chosen vendors</th><th>Status</th><th>Raised by</th><th>Updated</th></tr></thead>
            <tbody>
              {!rows ? <tr><td colSpan={7} className="ops-empty">Loading…</td></tr>
              : visible.length === 0 ? <tr><td colSpan={7} className="ops-empty">{mode === "approver" && tab === "pending" ? "Nothing is waiting for your approval." : "No requests here."}</td></tr>
              : visible.map((r) => (
                <tr key={r.id} data-clickable onClick={() => setSelected(r.id)}>
                  <td className="site"><b>{r.number}</b><small>{r.title}</small></td>
                  <td className="num">{r.lines}</td>
                  <td className="num">{Number(r.total) ? pkr(r.total) : "—"}</td>
                  <td className="pr-muted">{r.vendors || "no quotation yet"}</td>
                  <td><span className={STATUS_CHIP[r.status]}>{r.statusLabel}</span>{r.selfApproved && <> <span className="sw-chip sw-chip--warning">Self-approved</span></>}</td>
                  <td>{r.createdBy}</td>
                  <td className="date">{fmtAt(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface ItemHit { itemKey: string; name: string; unit: string; rate: string | null }

/** One request: details, items with quotations and the chosen vendor, totals, the next action, and its history. */
export function RequestPage({ session, id, onBack, onChanged }: { session: Session; id: string; onBack: () => void; onChanged: () => void }) {
  const [d, setD] = useState<RequestDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", purpose: "", neededBy: "", deliveryTo: "", paymentTerms: "" });
  const [quoteForm, setQuoteForm] = useState<Record<string, { vendor: string; rate: string }>>({});
  const [qtyEdit, setQtyEdit] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<ItemHit[]>([]);
  const [adding, setAdding] = useState<{ item: ItemHit; quantity: string } | null>(null);
  const [note, setNote] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [password, setPassword] = useState("");

  const apply = (r: RequestDetail) => {
    setD(r);
    setForm({ title: r.title, purpose: r.purpose, neededBy: r.neededBy ?? "", deliveryTo: r.deliveryTo, paymentTerms: r.paymentTerms });
    setQtyEdit({});
  };
  useEffect(() => {
    let live = true;
    api<RequestDetail>(`/procurement/requests/${id}`).then((r) => { if (live) { apply(r); setError(""); } })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Unable to open the request."); });
    return () => { live = false; };
  }, [id]);
  useEffect(() => {
    if (!d?.can.edit || search.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { void api<{ items: ItemHit[] }>(`/procurement/items?q=${encodeURIComponent(search.trim())}`).then((r) => setHits(r.items)).catch(() => setHits([])); }, 250);
    return () => clearTimeout(t);
  }, [search, d?.can.edit]);

  const post = async (path: string, body: unknown, message: string) => {
    setBusy(true);
    try {
      const r = await api<RequestDetail>(`/procurement/requests/${id}${path}`, { body, csrf: session.csrfToken });
      apply(r); setNotice(message); setError(""); onChanged();
      return true;
    } catch (e) { setError(e instanceof ApiError ? e.message : "The change was not saved."); setNotice(""); return false; }
    finally { setBusy(false); }
  };

  // Approving needs the password again within the last 5 minutes (Moaz, 24 Oct 2026).
  const confirmPassword = async () => {
    if (!password) return true;
    try { await api("/auth/confirm-password", { body: { password }, csrf: session.csrfToken }); setPassword(""); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : "Your password could not be checked."); setNotice(""); return false; }
  };

  if (error && !d) return <div className="pr"><p className="ops-feedback" role="alert">{error}</p><Button variant="neutral" onClick={onBack}>Back</Button></div>;
  if (!d) return <p className="pr-muted">Loading request…</p>;
  const hasQuotes = d.lines.length > 0 && d.lines.every((l) => l.chosen);
  // Once ordered, each line shows what Store has received against it.
  const showReceived = d.status === "ordered" || d.status === "received";
  const allIn = d.lines.filter((l) => Number(l.received) >= Number(l.quantity)).length;
  const reached = (k: RequestStatus | "quotes") => {
    const order = ["draft", "quotes", "pending_approval", "approved", "ordered", "received"];
    const at = d.status === "draft" ? (hasQuotes ? 1 : 0) : order.indexOf(d.status);
    const i = order.indexOf(k);
    return d.status === "rejected" || d.status === "cancelled" ? (i <= 2 ? "done" : "todo") : i < at ? "done" : i === at ? "now" : "todo";
  };

  return (
    <div className="pr">
      <button type="button" className="sw-link" onClick={onBack}>← Purchase requests</button>
      <div className="pr-head">
        <div>
          <h2>{d.number} · {d.title}</h2>
          <p>Raised by {d.createdBy} · {fmtDay(d.createdAt)}{d.neededBy ? ` · needed by ${fmtDay(d.neededBy)}` : ""}{d.submittedAt ? ` · sent to Abu Bakar ${fmtAt(d.submittedAt)}` : ""}</p>
        </div>
        <span className={STATUS_CHIP[d.status]}>{d.statusLabel}</span>{d.selfApproved && <> <span className="sw-chip sw-chip--warning">Self-approved</span></>}
      </div>
      {error && <p className="ops-feedback" role="alert">{error}</p>}
      {notice && !error && <p className="pr-notice" role="status">{notice}</p>}
      <div className="ops-card pr-steps">
        {STEPS.map((s, i) => <span key={s.key} className={`pr-step pr-step--${reached(s.key)}`}>{i + 1} {s.label}{reached(s.key) === "done" ? " ✓" : ""}</span>)}
        {d.status === "rejected" && <span className="sw-chip sw-chip--danger">Rejected by {d.decidedBy}</span>}
        {d.status === "cancelled" && <span className="sw-chip">Cancelled</span>}
      </div>
      {d.decisionNote && (
        <div className={`pr-decision pr-decision--${d.status === "rejected" ? "bad" : d.status === "draft" ? "warn" : "ok"}`}>
          <b>{d.status === "draft" ? "Sent back by" : d.status === "rejected" ? "Rejected by" : "Note from"} {d.decidedBy}</b> · {fmtAt(d.decidedAt)}<br />{d.decisionNote}
        </div>
      )}

      <section className="ops-card">
        <div className="ops-tc-h"><h3>Items and quotations</h3><span className="pr-muted">{d.lines.length} item{d.lines.length === 1 ? "" : "s"} · rate master IDs · best quotation is chosen unless you pick another</span></div>
        <div className="pz-table-scroll">
          <table className="ops-table pr-lines">
            <thead><tr><th>Rate master item</th><th className="num">Qty</th>{showReceived && <th className="num">Received</th>}<th className="num">Last buying rate</th><th>Quotations (vendor · rate)</th><th className="num">Chosen rate</th><th className="num">Line total (PKR)</th>{d.can.edit && <th></th>}</tr></thead>
            <tbody>
              {d.lines.length === 0 ? <tr><td colSpan={7} className="ops-empty">No items yet. Search the rate master below to add one.</td></tr> : d.lines.map((l) => {
                const qf = quoteForm[l.id] ?? { vendor: "", rate: "" };
                return (
                  <tr key={l.id}>
                    <td className="site"><b>{l.name}</b><small>{l.itemKey !== l.name ? `${l.itemKey} · ` : ""}{l.unit}{l.note ? ` · ${l.note}` : ""}</small></td>
                    <td className="num">
                      {d.can.edit ? (
                        <span className="pr-qty">
                          <input aria-label={`${l.name} quantity`} value={qtyEdit[l.id] ?? l.quantity} onChange={(e) => setQtyEdit({ ...qtyEdit, [l.id]: e.target.value })} />
                          {qtyEdit[l.id] !== undefined && qtyEdit[l.id] !== l.quantity && <button type="button" className="sw-link" onClick={() => void post(`/lines/${l.id}/update`, { quantity: qtyEdit[l.id].trim() }, "Quantity saved.")}>Save</button>}
                        </span>
                      ) : qty(l.quantity)}
                    </td>
                    {showReceived && (
                      <td className="num">
                        {Number(l.received) >= Number(l.quantity) ? <span className="sw-chip sw-chip--ok">All in</span>
                          : Number(l.received) > 0 ? <><b>{qty(l.received)}</b><br /><small className="pr-muted">{qty(String(Number(l.quantity) - Number(l.received)))} still due</small></>
                          : <span className="pr-muted">not yet</span>}
                      </td>
                    )}
                    <td className="num">
                      {l.lastRate ? <>{pkr(l.lastRate.rate)} <small className="pr-muted">/{l.lastRate.unit}</small><br /><small className="pr-muted">{l.lastRate.source}{!l.lastRate.comparable ? " · different unit" : ""}</small></>
                        : <><span className="sw-chip">No rate yet</span><br /><small className="pr-muted">first purchase sets it</small></>}
                    </td>
                    <td>
                      <div className="pr-quotes">
                        {l.quotes.length === 0 && <span className="pr-muted">no quotation yet</span>}
                        {l.quotes.map((q) => (
                          <span key={q.id} className={`pr-quote${q.id === l.chosenQuoteId ? " pr-quote--on" : ""}`}>
                            {d.can.edit ? (
                              <label><input type="radio" name={`pick-${l.id}`} checked={q.id === l.chosenQuoteId} onChange={() => void post(`/lines/${l.id}/choose`, { quoteId: q.id }, `${q.vendor} chosen.`)} />{q.vendor} · {pkr(q.rate)}</label>
                            ) : <>{q.vendor} · {pkr(q.rate)}</>}
                            {l.best?.id === q.id && l.quotes.length > 1 && <em>best</em>}
                            {d.can.edit && <button type="button" aria-label={`Remove ${q.vendor}`} onClick={() => void post(`/quotes/${q.id}/remove`, {}, "Quotation removed.")}>×</button>}
                          </span>
                        ))}
                      </div>
                      {d.can.edit && (
                        <div className="pr-addq">
                          <input aria-label={`${l.name} vendor`} placeholder="Vendor" value={qf.vendor} maxLength={200} onChange={(e) => setQuoteForm({ ...quoteForm, [l.id]: { ...qf, vendor: e.target.value } })} />
                          <input aria-label={`${l.name} rate`} placeholder={`Rate per ${l.unit}`} value={qf.rate} onChange={(e) => setQuoteForm({ ...quoteForm, [l.id]: { ...qf, rate: e.target.value } })} />
                          <Button variant="secondary" loading={busy} disabled={!qf.vendor.trim() || !qf.rate.trim()}
                            onClick={async () => { if (await post(`/lines/${l.id}/quotes`, { vendor: qf.vendor.trim(), rate: qf.rate.trim().replace(/,/g, "") }, "Quotation added.")) setQuoteForm({ ...quoteForm, [l.id]: { vendor: "", rate: "" } }); }}>Add quote</Button>
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {l.chosen ? <><b>{pkr(l.chosen.rate)}</b><br /><small className="pr-muted">{l.chosen.vendor}</small>{l.difference != null && Number(l.difference) !== 0 && <><br /><span className={`sw-chip ${Number(l.difference) < 0 ? "sw-chip--ok" : "sw-chip--danger"}`}>{Number(l.difference) < 0 ? "" : "+"}{pkr(l.difference)} vs last</span></>}</> : "—"}
                    </td>
                    <td className="num">{l.chosen ? pkr(l.lineTotal) : "—"}</td>
                    {d.can.edit && <td><button type="button" className="sw-link" onClick={() => void post(`/lines/${l.id}/remove`, {}, `${l.name} removed.`)}>Remove</button></td>}
                  </tr>
                );
              })}
            </tbody>
            {d.lines.length > 0 && (
              <tfoot>
                <tr><td colSpan={showReceived ? 6 : 5} className="num"><b>Total at the chosen rates</b></td><td className="num"><b>{pkr(d.totals.atChosen)}</b></td>{d.can.edit && <td></td>}</tr>
                {Number(d.totals.lastComparable) > 0 && (
                  <tr><td colSpan={showReceived ? 6 : 5} className="num pr-muted">Items with a last buying rate: {pkr(d.totals.lastComparable)} at last rates, {pkr(d.totals.chosenComparable)} now</td>
                    <td className="num"><span className={`sw-chip ${Number(d.totals.saving) >= 0 ? "sw-chip--ok" : "sw-chip--danger"}`}>{Number(d.totals.saving) >= 0 ? `${pkr(d.totals.saving)} below last` : `${pkr(-Number(d.totals.saving))} above last`}</span></td>{d.can.edit && <td></td>}</tr>
                )}
                {d.totals.firstPurchases > 0 && <tr><td colSpan={(d.can.edit ? 7 : 6) + (showReceived ? 1 : 0)} className="pr-muted">{d.totals.firstPurchases} item{d.totals.firstPurchases === 1 ? " has" : "s have"} no comparable last buying rate; this purchase sets it.</td></tr>}
              </tfoot>
            )}
          </table>
        </div>
        {d.can.edit && (
          <div className="pr-additem">
            <Field id="pr-search" label="Add an item from the rate master" hint="Batteries, BMS and inverters are not bought through Procurement.">
              <input id="pr-search" placeholder="Type at least two letters: cable, MCB, breaker…" value={search} onChange={(e) => { setSearch(e.target.value); setAdding(null); }} />
            </Field>
            {hits.length > 0 && !adding && (
              <div className="pr-hits">
                {hits.map((h) => <button type="button" key={h.itemKey} onClick={() => setAdding({ item: h, quantity: "" })}><b>{h.name}</b><small>{h.unit}{h.rate ? ` · rate master ${pkr(h.rate)}` : " · no rate yet"}</small></button>)}
              </div>
            )}
            {adding && (
              <div className="pr-addrow">
                <span><b>{adding.item.name}</b> <small className="pr-muted">{adding.item.unit}</small></span>
                <input aria-label="Quantity to add" placeholder={`Quantity (${adding.item.unit})`} value={adding.quantity} onChange={(e) => setAdding({ ...adding, quantity: e.target.value })} />
                <Button variant="primary" loading={busy} disabled={!adding.quantity.trim()}
                  onClick={async () => { if (await post("/lines", { itemKey: adding.item.itemKey, quantity: adding.quantity.trim().replace(/,/g, "") }, `${adding.item.name} added.`)) { setAdding(null); setSearch(""); } }}>Add item</Button>
                <button type="button" className="sw-link" onClick={() => setAdding(null)}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </section>

      {d.lines.length > 0 && <RfqPanel session={session} d={d} post={post} />}

      <div className="pr-grid">
        <section className="ops-card pr-pad">
          <h3>Next step</h3>
          {d.can.submit && (
            <>
              <p className="pr-muted">{hasQuotes ? "Every item has a chosen quotation. Send it to Abu Bakar for approval." : "Every item needs at least one quotation before it can go to Abu Bakar."}</p>
              <div className="pr-actions">
                <Button variant="primary" loading={busy} disabled={!hasQuotes} onClick={() => void post("/submit", {}, "Sent to Abu Bakar for approval.")}>Send to Abu Bakar</Button>
                {d.can.cancel && <Button variant="neutral" loading={busy} onClick={() => void post("/cancel", { note }, "Request cancelled.")}>Cancel request</Button>}
              </div>
            </>
          )}
          {d.can.decide && (
            <>
              <p className="pr-muted">PKR {pkr(d.totals.atChosen)} for {d.lines.length} item{d.lines.length === 1 ? "" : "s"}{Number(d.totals.saving) > 0 ? `, ${pkr(d.totals.saving)} below last rates` : ""}. Only you can approve this.</p>
              <textarea className="pr-note" placeholder="Note to Hamza (needed to send back or reject)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
              <label className="pr-muted pr-password">Your password, to approve (asked again after 5 minutes)
                <input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <div className="pr-actions">
                <Button variant="primary" loading={busy} onClick={async () => { if ((await confirmPassword()) && (await post("/decide", { decision: "approve", note }, "Approved."))) setNote(""); }}>Approve</Button>
                <Button variant="neutral" loading={busy} disabled={!note.trim()} onClick={async () => { if (await post("/decide", { decision: "send_back", note }, "Sent back to Hamza.")) setNote(""); }}>Send back for changes</Button>
                <Button variant="danger" loading={busy} disabled={!note.trim()} onClick={async () => { if (await post("/decide", { decision: "reject", note }, "Rejected.")) setNote(""); }}>Reject</Button>
              </div>
            </>
          )}
          {d.status === "pending_approval" && !d.can.decide && <p className="pr-muted">Waiting for Abu Bakar. He can approve, send it back with a note, or reject it.</p>}
          {d.can.selfApprove && (d.status === "pending_approval" || hasQuotes) && (
            // The buyer may approve himself (Moaz, 26 Oct 2026); Abu Bakar and Moaz are told every time.
            <div className="pr-self">
              <b>Approve it yourself</b>
              <p className="pr-muted">Use this when it cannot wait for Abu Bakar. It is marked self-approved, and Abu Bakar and Moaz are told straight away.</p>
              <textarea className="pr-note" placeholder="Why it is approved now (optional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
              <label className="pr-muted pr-password">Your password (asked again after 5 minutes)
                <input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <div className="pr-actions">
                <Button variant="warning" loading={busy} onClick={async () => { if ((await confirmPassword()) && (await post("/self-approve", { note }, "Approved by you. Abu Bakar and Moaz have been told."))) setNote(""); }}>Approve it myself</Button>
              </div>
            </div>
          )}
          {d.can.order && (
            <>
              <p className="pr-muted">{d.selfApproved ? "Self-approved" : "Approved"} by {d.decidedBy} {fmtAt(d.decidedAt)}. Place the orders with the chosen vendors, then record the vendor order number(s).</p>
              <Field id="pr-order" label="Vendor order number(s)"><input id="pr-order" value={orderRef} maxLength={500} onChange={(e) => setOrderRef(e.target.value)} placeholder="e.g. Chint SO-4471, Powerline 2210" /></Field>
              <div className="pr-actions">
                <Button variant="primary" loading={busy} disabled={!orderRef.trim()} onClick={async () => { if (await post("/ordered", { orderReference: orderRef.trim() }, "Marked ordered.")) setOrderRef(""); }}>Mark ordered</Button>
                {d.can.cancel && <Button variant="neutral" loading={busy} onClick={() => void post("/cancel", { note }, "Request cancelled.")}>Cancel request</Button>}
              </div>
            </>
          )}
          {d.status === "ordered" && <p className="pr-muted">Ordered {fmtAt(d.orderedAt)} · {d.orderReference}. Store (Shaigan) records what arrives, item by item; {allIn} of {d.lines.length} item{d.lines.length === 1 ? "" : "s"} fully received so far.</p>}
          {d.status === "received" && <p className="pr-muted">Received into Store by {d.receivedBy} {fmtAt(d.receivedAt)}. The quantities were added to stock.</p>}
          {(d.status === "rejected" || d.status === "cancelled") && <p className="pr-muted">This request is closed.</p>}
        </section>

        <section className="ops-card pr-pad">
          <h3>Basics</h3>
          {d.can.edit ? (
            <div className="pr-form">
              <Field id="pr-title" label="Title"><input id="pr-title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field id="pr-needed" label="Needed by"><input id="pr-needed" type="date" value={form.neededBy} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} /></Field>
              <Field id="pr-delivery" label="Deliver to"><input id="pr-delivery" value={form.deliveryTo} maxLength={300} onChange={(e) => setForm({ ...form, deliveryTo: e.target.value })} /></Field>
              <Field id="pr-payment" label="Payment terms"><input id="pr-payment" value={form.paymentTerms} maxLength={500} placeholder="e.g. 30 days, advance, on delivery" onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} /></Field>
              <Field id="pr-purpose" label="Why it is needed"><textarea id="pr-purpose" value={form.purpose} maxLength={2000} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
              <div className="pr-actions"><Button variant="neutral" loading={busy} disabled={!form.title.trim()} onClick={() => void post("/update", { ...form, title: form.title.trim(), neededBy: form.neededBy || null }, "Saved.")}>Save basics</Button></div>
            </div>
          ) : (
            <div className="ops-kv">
              <div><span>Deliver to</span><b>{d.deliveryTo || "—"}</b></div>
              <div><span>Needed by</span><b>{fmtDay(d.neededBy)}</b></div>
              <div><span>Payment terms</span><b>{d.paymentTerms || "—"}</b></div>
              <div><span>Why it is needed</span><b>{d.purpose || "—"}</b></div>
              {d.orderReference && <div><span>Vendor order number(s)</span><b>{d.orderReference}</b></div>}
            </div>
          )}
          <h3 style={{ marginTop: 18 }}>History</h3>
          <ul className="pr-history">
            {d.events.map((e) => <li key={e.id}><b>{EVENT_TEXT[e.kind] ?? e.kind}</b> · {e.actor} · {fmtAt(e.at)}{e.note ? <><br /><small>{e.note}</small></> : null}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
