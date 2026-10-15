import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { StatusBadge } from "../ui/StatusBadge.js";

interface StockItem {
  itemKey: string; name: string; unit: string; requiredIssued: string; requiredHeadsUp: string; required: string;
  sitesIssued: number; sitesHeadsUp: number; existing: string | null; countedAt: string | null; reserved: string;
  reservedSites: number; available: string | null; shortage: string; onOrder: string; counted: boolean;
}
interface Reservation { id: string; executionId: string; itemKey: string; name: string; quantity: string; note: string; reservedAt: string; reservedBy: string; siteName: string | null; siteCode: string | null; stage: string }
interface Vendor { id: string; name: string; category: string; regions: string[]; contactPerson: string; phone: string; email: string; notes: string; status: "Active" | "Inactive" }
interface Request {
  id: string; executionId: string | null; siteName: string | null; siteCode: string | null; itemKey: string | null; itemName: string;
  serviceCategory: string | null; description: string; quantity: string | null; unit: string; status: string; vendorId: string | null;
  vendorName: string | null; expectedDate: string | null; amount: string | null; notes: string; createdAt: string; createdBy: string | null;
}
interface SiteRef { id: string; siteName: string | null; siteCode: string | null; customer: string | null; stageLabel: string }

const fmtAt = (v: string | null) => (v ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(v)) : "—");
const fmtDay = (v: string | null) => (v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${v}T00:00:00`)) : "—");
const num = (v: string | null) => (v == null ? "—" : v);
const emptyVendor = (): Omit<Vendor, "id"> & { id?: string } => ({ name: "", category: "Structure", regions: [], contactPerson: "", phone: "", email: "", notes: "", status: "Active" });
const emptyRequest = () => ({ executionId: "", itemKey: "", serviceCategory: "", description: "", quantity: "", unit: "", vendorId: "", expectedDate: "", amount: "", notes: "" });

export function StockProcurement({ session }: { session: Session }) {
  const role = session.user.role;
  const canEdit = ["Admin", "Management", "Operations"].includes(role);
  const canCount = canEdit || role === "Inventory";
  const [tab, setTab] = useState<"shortage" | "reserved" | "vendors" | "procurement">("shortage");
  const [items, setItems] = useState<StockItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [sites, setSites] = useState<SiteRef[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyShort, setOnlyShort] = useState(true);
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, { quantity: string; note: string }>>({});
  const [vendorForm, setVendorForm] = useState(emptyVendor());
  const [requestForm, setRequestForm] = useState(emptyRequest());
  const [statusFilter, setStatusFilter] = useState("");
  const [updates, setUpdates] = useState<Record<string, { status: string; vendorId: string; expectedDate: string; amount: string; note: string }>>({});

  const load = useCallback(async () => {
    try {
      const [stock, v, p, s] = await Promise.all([
        api<{ items: StockItem[]; reservations: Reservation[] }>("/site-execution/stock"),
        api<{ vendors: Vendor[]; categories: string[]; regions: string[] }>("/site-execution/vendors"),
        api<{ requests: Request[]; statuses: string[] }>("/site-execution/procurement"),
        api<{ sites: SiteRef[] }>("/site-execution"),
      ]);
      setItems(stock.items); setReservations(stock.reservations); setVendors(v.vendors); setCategories(v.categories);
      setRegions(v.regions); setRequests(p.requests); setStatuses(p.statuses); setSites(s.sites); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load stock information."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    try { await action(); setNotice(message); setError(""); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The change could not be saved."); setNotice(""); }
    finally { setBusy(false); }
  }, [load]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => (!onlyShort || Number(i.shortage) > 0) && (!q || i.name.toLowerCase().includes(q) || i.itemKey.toLowerCase().includes(q)));
  }, [items, onlyShort, search]);
  const totals = useMemo(() => ({
    short: items.filter((i) => Number(i.shortage) > 0).length,
    uncounted: items.filter((i) => !i.counted).length,
    reserved: reservations.length,
    open: requests.filter((r) => !["Received", "Cancelled"].includes(r.status)).length,
  }), [items, reservations, requests]);

  const tabs: { key: typeof tab; label: string; count: number }[] = [
    { key: "shortage", label: "Stock shortage", count: totals.short },
    { key: "reserved", label: "Reserved stock", count: totals.reserved },
    { key: "vendors", label: "Vendors", count: vendors.filter((v) => v.status === "Active").length },
    { key: "procurement", label: "Procurement", count: totals.open },
  ];

  return (
    <div className="pz-stack">
      <section className="pz-panel">
        <div className="stage-grid">
          {tabs.map((t) => (
            <button type="button" key={t.key} className={`stage-card${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
              <strong>{t.count}</strong><span>{t.label}</span>
            </button>
          ))}
        </div>
        <p><small>Required comes from issued BOQs still in planning plus heads-up BOQs. Existing stock is the count Store last entered. Shortage = required − existing. Available = existing − reserved.</small></p>
      </section>
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      {notice && <p className="pz-feedback pz-feedback--success" role="status">{notice}</p>}

      {tab === "shortage" && (
        <section className="pz-panel pz-stack">
          <div className="pz-form-grid">
            <Field id="st-search" label="Search item"><input id="st-search" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
            <Field id="st-only" label="Show">
              <select id="st-only" value={onlyShort ? "short" : "all"} onChange={(e) => setOnlyShort(e.target.value === "short")}>
                <option value="short">Only items with a shortage</option><option value="all">All required items</option>
              </select>
            </Field>
          </div>
          {totals.uncounted > 0 && <StatusBadge tone="warning">{totals.uncounted} item{totals.uncounted === 1 ? "" : "s"} without a stock count yet</StatusBadge>}
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Item</th><th>Unit</th><th>Required</th><th>Existing</th><th>Reserved</th><th>Available</th><th>Shortage</th><th>On order</th>{canCount && <th>Enter count</th>}</tr></thead>
              <tbody>
                {visibleItems.length === 0 ? <tr><td colSpan={9}>Nothing to show.</td></tr> : visibleItems.map((i) => {
                  const c = counts[i.itemKey] ?? { quantity: "", note: "" };
                  return (
                    <tr key={i.itemKey}>
                      <td><strong>{i.name}</strong><br /><small>{i.itemKey}</small></td>
                      <td>{i.unit}</td>
                      <td>{i.required}<br /><small>{i.requiredIssued} issued ({i.sitesIssued} site{i.sitesIssued === 1 ? "" : "s"}){Number(i.requiredHeadsUp) > 0 ? ` + ${i.requiredHeadsUp} heads-up (${i.sitesHeadsUp})` : ""}</small></td>
                      <td>{i.counted ? i.existing : <StatusBadge tone="warning">No count</StatusBadge>}{i.countedAt && <><br /><small>{fmtAt(i.countedAt)}</small></>}</td>
                      <td>{i.reserved}{i.reservedSites ? <><br /><small>{i.reservedSites} site{i.reservedSites === 1 ? "" : "s"}</small></> : null}</td>
                      <td>{num(i.available)}</td>
                      <td>{Number(i.shortage) > 0 ? <StatusBadge tone="danger">{i.shortage}</StatusBadge> : <StatusBadge tone="success">0</StatusBadge>}</td>
                      <td>{i.onOrder}</td>
                      {canCount && (
                        <td>
                          <div className="pz-action-row">
                            <input aria-label={`Count for ${i.name}`} style={{ width: "6rem" }} value={c.quantity} placeholder={i.existing ?? "0"}
                              onChange={(e) => setCounts({ ...counts, [i.itemKey]: { ...c, quantity: e.target.value } })} />
                            <Button variant="secondary" loading={busy} disabled={!c.quantity.trim()}
                              onClick={() => void run(async () => { await api("/site-execution/stock/counts", { body: { itemKey: i.itemKey, quantity: c.quantity.trim(), note: c.note }, csrf: session.csrfToken }); setCounts({ ...counts, [i.itemKey]: { quantity: "", note: "" } }); }, `Count saved for ${i.name}.`)}>
                              Save
                            </Button>
                            {canEdit && Number(i.shortage) > 0 && (
                              <Button variant="neutral" onClick={() => { setRequestForm({ ...emptyRequest(), itemKey: i.itemKey, description: `Buy ${i.name}`, quantity: i.shortage, unit: i.unit }); setTab("procurement"); }}>
                                Request quote
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "reserved" && (
        <section className="pz-panel pz-stack">
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Site</th><th>Stage</th><th>Item</th><th>Quantity</th><th>Reserved by</th><th>Note</th></tr></thead>
              <tbody>
                {reservations.length === 0 ? <tr><td colSpan={6}>No stock is reserved.</td></tr> : reservations.map((r) => (
                  <tr key={r.id}>
                    <td>{r.siteName ?? "—"}{r.siteCode ? ` (${r.siteCode})` : ""}</td>
                    <td>{r.stage.replace(/_/g, " ")}</td>
                    <td>{r.name}</td>
                    <td>{r.quantity}</td>
                    <td>{r.reservedBy}<br /><small>{fmtAt(r.reservedAt)}</small></td>
                    <td>{r.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p><small>Reservations are released from the site's page, or when the site is cancelled.</small></p>
        </section>
      )}

      {tab === "vendors" && (
        <section className="pz-panel pz-stack">
          {canEdit && (
            <div className="pz-stack">
              <h3>{vendorForm.id ? "Edit vendor" : "Add vendor"}</h3>
              <div className="pz-form-grid">
                <Field id="v-name" label="Name"><input id="v-name" value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} /></Field>
                <Field id="v-cat" label="Category">
                  <select id="v-cat" value={vendorForm.category} onChange={(e) => setVendorForm({ ...vendorForm, category: e.target.value })}>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field id="v-contact" label="Contact person"><input id="v-contact" value={vendorForm.contactPerson} onChange={(e) => setVendorForm({ ...vendorForm, contactPerson: e.target.value })} /></Field>
                <Field id="v-phone" label="Phone"><input id="v-phone" value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} /></Field>
                <Field id="v-email" label="Email"><input id="v-email" value={vendorForm.email} onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })} /></Field>
                <Field id="v-status" label="Status">
                  <select id="v-status" value={vendorForm.status} onChange={(e) => setVendorForm({ ...vendorForm, status: e.target.value as "Active" | "Inactive" })}>
                    <option>Active</option><option>Inactive</option>
                  </select>
                </Field>
                <Field id="v-notes" label="Notes"><input id="v-notes" value={vendorForm.notes} onChange={(e) => setVendorForm({ ...vendorForm, notes: e.target.value })} /></Field>
              </div>
              <div className="pz-action-row" role="group" aria-label="Regions covered">
                <span>Regions:</span>
                {regions.map((r) => (
                  <label key={r}><input type="checkbox" checked={vendorForm.regions.includes(r)}
                    onChange={(e) => setVendorForm({ ...vendorForm, regions: e.target.checked ? [...vendorForm.regions, r] : vendorForm.regions.filter((x) => x !== r) })} /> {r}</label>
                ))}
              </div>
              <div className="pz-action-row">
                <Button variant="primary" loading={busy} disabled={!vendorForm.name.trim()}
                  onClick={() => void run(async () => { await api("/site-execution/vendors", { body: vendorForm, csrf: session.csrfToken }); setVendorForm(emptyVendor()); }, "Vendor saved.")}>
                  {vendorForm.id ? "Save changes" : "Add vendor"}
                </Button>
                {vendorForm.id && <Button variant="secondary" onClick={() => setVendorForm(emptyVendor())}>Cancel</Button>}
              </div>
            </div>
          )}
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Category</th><th>Vendor</th><th>Regions</th><th>Contact</th><th>Status</th>{canEdit && <th></th>}</tr></thead>
              <tbody>
                {vendors.length === 0 ? <tr><td colSpan={6}>No vendors yet.</td></tr> : vendors.map((v) => (
                  <tr key={v.id}>
                    <td>{v.category}</td>
                    <td><strong>{v.name}</strong>{v.notes && <><br /><small>{v.notes}</small></>}</td>
                    <td>{v.regions.length ? v.regions.join(", ") : "—"}</td>
                    <td>{[v.contactPerson, v.phone, v.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td><StatusBadge tone={v.status === "Active" ? "success" : "pending"}>{v.status}</StatusBadge></td>
                    {canEdit && <td><Button variant="secondary" onClick={() => setVendorForm({ ...v })}>Edit</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "procurement" && (
        <section className="pz-panel pz-stack">
          {canEdit && (
            <div className="pz-stack">
              <h3>New request for quotation / purchase</h3>
              <div className="pz-form-grid">
                <Field id="p-site" label="Site (optional)">
                  <select id="p-site" value={requestForm.executionId} onChange={(e) => setRequestForm({ ...requestForm, executionId: e.target.value })}>
                    <option value="">General stock</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.siteName ?? "Site"}{s.siteCode ? ` (${s.siteCode})` : ""} · {s.stageLabel}</option>)}
                  </select>
                </Field>
                <Field id="p-item" label="Item" hint="Pick an item, or a service category below.">
                  <select id="p-item" value={requestForm.itemKey} onChange={(e) => { const it = items.find((i) => i.itemKey === e.target.value); setRequestForm({ ...requestForm, itemKey: e.target.value, serviceCategory: e.target.value ? "" : requestForm.serviceCategory, unit: it?.unit ?? requestForm.unit, description: requestForm.description || (it ? `Buy ${it.name}` : "") }); }}>
                    <option value="">—</option>
                    {items.map((i) => <option key={i.itemKey} value={i.itemKey}>{i.name}{Number(i.shortage) > 0 ? ` · short ${i.shortage}` : ""}</option>)}
                  </select>
                </Field>
                <Field id="p-service" label="Service category">
                  <select id="p-service" value={requestForm.serviceCategory} onChange={(e) => setRequestForm({ ...requestForm, serviceCategory: e.target.value, itemKey: e.target.value ? "" : requestForm.itemKey })}>
                    <option value="">—</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field id="p-desc" label="Description"><input id="p-desc" value={requestForm.description} onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })} /></Field>
                <Field id="p-qty" label="Quantity"><input id="p-qty" value={requestForm.quantity} onChange={(e) => setRequestForm({ ...requestForm, quantity: e.target.value })} /></Field>
                <Field id="p-unit" label="Unit"><input id="p-unit" value={requestForm.unit} onChange={(e) => setRequestForm({ ...requestForm, unit: e.target.value })} /></Field>
                <Field id="p-vendor" label="Vendor (optional)">
                  <select id="p-vendor" value={requestForm.vendorId} onChange={(e) => setRequestForm({ ...requestForm, vendorId: e.target.value })}>
                    <option value="">—</option>
                    {vendors.filter((v) => v.status === "Active").map((v) => <option key={v.id} value={v.id}>{v.name} · {v.category}</option>)}
                  </select>
                </Field>
                <Field id="p-date" label="Expected date"><input id="p-date" type="date" value={requestForm.expectedDate} onChange={(e) => setRequestForm({ ...requestForm, expectedDate: e.target.value })} /></Field>
                <Field id="p-amount" label="Amount (optional)"><input id="p-amount" value={requestForm.amount} onChange={(e) => setRequestForm({ ...requestForm, amount: e.target.value })} /></Field>
                <Field id="p-notes" label="Notes"><input id="p-notes" value={requestForm.notes} onChange={(e) => setRequestForm({ ...requestForm, notes: e.target.value })} /></Field>
              </div>
              <div className="pz-action-row">
                <Button variant="primary" loading={busy} disabled={!requestForm.description.trim() || (!requestForm.itemKey && !requestForm.serviceCategory)}
                  onClick={() => void run(async () => {
                    const f = requestForm;
                    await api("/site-execution/procurement", { body: {
                      executionId: f.executionId || null, itemKey: f.itemKey || null, serviceCategory: f.serviceCategory || null, description: f.description.trim(),
                      quantity: f.quantity.trim() || null, unit: f.unit.trim(), vendorId: f.vendorId || null, expectedDate: f.expectedDate || null, amount: f.amount.trim() || null, notes: f.notes.trim(),
                    }, csrf: session.csrfToken });
                    setRequestForm(emptyRequest());
                  }, "Request created.")}>
                  Create request
                </Button>
              </div>
            </div>
          )}
          <Field id="p-filter" label="Status">
            <select id="p-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Request</th><th>Site</th><th>Quantity</th><th>Vendor</th><th>Status</th><th>Expected</th><th>Amount</th>{canEdit && <th>Update</th>}</tr></thead>
              <tbody>
                {requests.filter((r) => !statusFilter || r.status === statusFilter).length === 0 ? <tr><td colSpan={8}>No requests.</td></tr> :
                  requests.filter((r) => !statusFilter || r.status === statusFilter).map((r) => {
                    const u = updates[r.id] ?? { status: r.status, vendorId: r.vendorId ?? "", expectedDate: r.expectedDate ?? "", amount: r.amount ?? "", note: "" };
                    const closed = ["Received", "Cancelled"].includes(r.status);
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.description}</strong><br /><small>{r.itemKey ? r.itemName : r.serviceCategory}{r.notes ? ` · ${r.notes}` : ""} · {fmtAt(r.createdAt)}</small></td>
                        <td>{r.siteName ?? "General"}{r.siteCode ? ` (${r.siteCode})` : ""}</td>
                        <td>{r.quantity ? `${r.quantity} ${r.unit}` : "—"}</td>
                        <td>{r.vendorName ?? "—"}</td>
                        <td><StatusBadge tone={r.status === "Received" ? "success" : r.status === "Cancelled" ? "pending" : r.status === "Not started" ? "warning" : "pending"}>{r.status}</StatusBadge></td>
                        <td>{fmtDay(r.expectedDate)}</td>
                        <td>{r.amount ?? "—"}</td>
                        {canEdit && (
                          <td>
                            {closed ? <small>Closed</small> : (
                              <div className="pz-stack">
                                <select aria-label="Status" value={u.status} onChange={(e) => setUpdates({ ...updates, [r.id]: { ...u, status: e.target.value } })}>
                                  {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <select aria-label="Vendor" value={u.vendorId} onChange={(e) => setUpdates({ ...updates, [r.id]: { ...u, vendorId: e.target.value } })}>
                                  <option value="">No vendor</option>
                                  {vendors.filter((v) => v.status === "Active").map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                                </select>
                                <input aria-label="Expected date" type="date" value={u.expectedDate} onChange={(e) => setUpdates({ ...updates, [r.id]: { ...u, expectedDate: e.target.value } })} />
                                <input aria-label="Amount" placeholder="Amount" value={u.amount} onChange={(e) => setUpdates({ ...updates, [r.id]: { ...u, amount: e.target.value } })} />
                                <input aria-label="Note" placeholder="Note for history" value={u.note} onChange={(e) => setUpdates({ ...updates, [r.id]: { ...u, note: e.target.value } })} />
                                <Button variant="secondary" loading={busy}
                                  onClick={() => void run(async () => {
                                    await api(`/site-execution/procurement/${r.id}`, { body: { status: u.status, vendorId: u.vendorId || null, expectedDate: u.expectedDate || null, amount: u.amount.trim() || null, note: u.note.trim() }, csrf: session.csrfToken });
                                    const next = { ...updates }; delete next[r.id]; setUpdates(next);
                                  }, "Request updated.")}>
                                  Save
                                </Button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
