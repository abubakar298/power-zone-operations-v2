import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { StatusBadge } from "../../ui/StatusBadge.js";
import { STAGE_LABELS, pathFor, fmtDay, fmtAt, today, OVERDUE_TEXT, type SiteRow, type StageKey } from "./stages.js";

export interface Reference {
  stages: { key: StageKey; label: string }[];
  scopes: { key: "installation" | "delivery_only"; label: string }[];
  regions: readonly string[];
  siteTypes: readonly string[];
  connectionStatuses: readonly string[];
  vendorCategories: readonly string[];
}
interface Vendor { id: string; name: string; category: string; contactPerson: string; phone: string; notes: string; status: "Active" | "Inactive" }
interface Detail extends SiteRow {
  ipoBy?: string | null;
  vendors: { id: string; category: string; vendorId: string; vendorName: string; contactPerson: string; phone: string; agreedDate: string | null; notes: string; assignedBy: string; assignedAt: string }[];
  pictureDays: { day: string; pictures: boolean }[];
  problems: { id: string; problem: string; status: "Open" | "Resolved"; raisedBy: string; raisedAt: string; resolvedBy: string | null; resolvedAt: string | null; resolution: string }[];
  additionalItems: { id: string; description: string; quantity: string; unit: string; reason: string; addedBy: string; addedAt: string; withdrawnAt: string | null; withdrawnBy: string | null; withdrawalReason: string }[];
  events: { id: string; kind: string; fromStage: StageKey | null; toStage: StageKey | null; changes: Record<string, any>; note: string; actor: string; at: string }[];
}

/** The steps a person works through, one at a time. "IPO received" is where planning starts. */
type Step = "planning" | "delivery" | "installation" | "commissioning" | "handover" | "doc_dispatch";
const STEP_TITLES: Record<Step, string> = { planning: "Planning", delivery: "Delivery", installation: "Installation", commissioning: "Commissioning", handover: "Handover", doc_dispatch: "Doc dispatch" };
const NEXT: Record<Step, Step | "closed"> = { planning: "delivery", delivery: "installation", installation: "commissioning", commissioning: "handover", handover: "doc_dispatch", doc_dispatch: "closed" };
const after = (step: Step, scope: string) => (step === "delivery" && scope === "delivery_only" ? "closed" : NEXT[step]);
interface Form {
  expectedStart: string; expectedDelivery: string; expectedCompletion: string;
  deliveredOn: string; bessDeliveredOn: string; scope: string;
  startedOn: string; installationCompletedOn: string;
  commissionedOn: string; matriCloud: string;
  handedOverOn: string; customerSignoff: "" | "yes" | "no";
  doDate: string; acknowledgementDate: string; submittedToCustomerDate: string; advanceClaimed: boolean; finalClaimed: boolean; documentsNote: string;
}
const STEP_FIELDS: Record<Step, (keyof Form)[]> = {
  planning: ["expectedStart", "expectedDelivery", "expectedCompletion"],
  delivery: ["deliveredOn", "bessDeliveredOn", "scope"],
  installation: ["startedOn", "installationCompletedOn"],
  commissioning: ["commissionedOn", "matriCloud"],
  handover: ["handedOverOn", "customerSignoff"],
  doc_dispatch: ["doDate", "acknowledgementDate", "submittedToCustomerDate", "advanceClaimed", "finalClaimed", "documentsNote"],
};
/** What each step needs before it can be completed; the server checks the same. */
const REQUIRED: Record<Step, { key: keyof Form; label: string }[]> = {
  planning: [{ key: "expectedDelivery", label: "the expected delivery date" }],
  delivery: [{ key: "deliveredOn", label: "the delivery date" }, { key: "scope", label: "what happens after delivery" }],
  installation: [{ key: "startedOn", label: "the installation start date" }],
  commissioning: [{ key: "commissionedOn", label: "the commissioning date" }],
  handover: [{ key: "handedOverOn", label: "the handover date" }],
  doc_dispatch: [{ key: "submittedToCustomerDate", label: "the date the documents went to the customer" }],
};
const toForm = (d: Detail): Form => ({
  expectedStart: d.expectedStart ?? "", expectedDelivery: d.expectedDelivery ?? "", expectedCompletion: d.expectedCompletion ?? "",
  deliveredOn: d.deliveredOn ?? "", bessDeliveredOn: d.bessDeliveredOn ?? "", scope: d.scope ?? "",
  startedOn: d.startedOn ?? "", installationCompletedOn: d.installationCompletedOn ?? "",
  commissionedOn: d.commissionedOn ?? "", matriCloud: d.matriCloud ?? "",
  handedOverOn: d.handedOverOn ?? "", customerSignoff: d.customerSignoff === true ? "yes" : d.customerSignoff === false ? "no" : "",
  doDate: d.doDate ?? "", acknowledgementDate: d.acknowledgementDate ?? "", submittedToCustomerDate: d.submittedToCustomerDate ?? "",
  advanceClaimed: d.advanceClaimed, finalClaimed: d.finalClaimed, documentsNote: d.documentsNote,
});
const value = (k: keyof Form, v: Form[keyof Form]) =>
  k === "customerSignoff" ? (v === "yes" ? true : v === "no" ? false : null) : typeof v === "boolean" ? v : k === "documentsNote" ? v : v === "" ? null : v;
/** Only the fields that differ from what is saved, so a step never touches another step's details. */
function changed(form: Form, saved: Form, keys: (keyof Form)[]) {
  const body: Record<string, unknown> = {};
  for (const k of keys) if (form[k] !== saved[k]) body[k] = value(k, form[k]);
  return body;
}
const stepOf = (stage: StageKey): Step | "closed" => (stage === "ipo_received" ? "planning" : (stage as Step | "closed"));

/** A row of tap buttons for a short answer, as on the AMC visit form. */
function Taps<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T | ""; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="sx-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : undefined} disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * One site after its IPO (Moaz, 26 Oct 2026): designed like the AMC complaint form. Site details come from
 * Coordination's IPO and are read-only. The person works one step at a time; a finished step becomes a locked
 * one-line summary, because there is no coming back. Only Admin can correct a finished step.
 */
export function SiteDetail({ session, id, reference, onBack }: { session: Session; id: string; reference: Reference; onBack: () => void }) {
  const canEdit = ["Admin", "Management", "Operations"].includes(session.user.role);
  const isAdmin = session.user.role === "Admin";
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [backNote, setBackNote] = useState("");
  const [assign, setAssign] = useState<Record<string, { vendorId: string; agreedDate: string }>>({});
  const [newVendor, setNewVendor] = useState({ name: "", category: "", contactPerson: "", phone: "" });
  const [problemText, setProblemText] = useState("");
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [itemForm, setItemForm] = useState({ description: "", quantity: "", unit: "", reason: "" });

  const loadVendors = useCallback(async () => {
    try { setVendors((await api<{ vendors: Vendor[] }>("/site-workflow/vendors")).vendors); } catch { /* read-only roles may not need the list */ }
  }, []);
  const load = useCallback(async () => {
    try { const d = await api<Detail>(`/site-workflow/${id}`); setDetail(d); setForm(toForm(d)); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Unable to open the site."); }
  }, [id]);
  useEffect(() => { void load(); void loadVendors(); }, [load, loadVendors]);

  const post = useCallback(async (path: string, body: unknown, message: string, refreshForm = false): Promise<Detail | null> => {
    setBusy(true);
    try {
      const d = await api<Detail>(path, { body, csrf: session.csrfToken });
      setDetail(d); if (refreshForm) setForm(toForm(d));
      setNotice(message); setError("");
      return d;
    } catch (e) { setError(e instanceof ApiError ? e.message : "The change was not saved."); setNotice(""); return null; }
    finally { setBusy(false); }
  }, [session.csrfToken]);

  const steps = useMemo(() => (detail ? pathFor(detail.scope).filter((s): s is Step => s !== "ipo_received" && s !== "closed") : []), [detail]);
  const pictureDays = useMemo(() => {
    if (!detail?.startedOn) return [] as { day: string; state: boolean | null }[];
    const map = new Map(detail.pictureDays.map((p) => [p.day, p.pictures]));
    const last = detail.installationCompletedOn && detail.installationCompletedOn < today() ? detail.installationCompletedOn : today();
    const out: { day: string; state: boolean | null }[] = [];
    const day = new Date(`${detail.startedOn}T00:00:00`);
    for (let i = 0; i < 120; i++) {
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      if (key > last) break;
      out.push({ day: key, state: map.has(key) ? map.get(key)! : null });
      day.setDate(day.getDate() + 1);
    }
    return out;
  }, [detail]);

  if (error && !detail) return <div className="pz-stack"><p className="pz-feedback pz-feedback--danger" role="alert">{error}</p><Button variant="neutral" onClick={onBack}>Back</Button></div>;
  if (!detail || !form) return <p role="status">Loading site…</p>;
  const d = detail, f = form, saved = toForm(d);
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });
  const current = stepOf(d.stage);
  const currentIndex = current === "closed" ? steps.length : steps.indexOf(current);
  const done = steps.slice(0, currentIndex);
  const isSolarBess = d.siteType === "Solar + BESS";
  const extras = d.additionalItems.filter((a) => !a.withdrawnAt);
  const fail = (message: string) => { setNotice(""); setError(message); };

  const save = (step: Step): Promise<Detail | null> => {
    const body = changed(f, saved, STEP_FIELDS[step]);
    return Object.keys(body).length ? post(`/site-workflow/${id}/update`, body, "Saved.", true) : Promise.resolve(d);
  };
  /** Save this step, check it is complete, confirm, then move on. A site still at "IPO received" moves into planning first. */
  const complete = async (step: Step) => {
    const missing = REQUIRED[step].filter((r) => !f[r.key]).map((r) => r.label);
    if (missing.length) return fail(`Fill in ${missing.join(" and ")} first.`);
    const to = after(step, f.scope);
    const fresh = await save(step);
    if (!fresh) return;
    if (to === "closed" && fresh.qc.missing.length) return fail(`Saved. The site can close once Quality Control submits: ${fresh.qc.missing.join(", ")}.`);
    const question = to === "closed" ? `Complete ${STEP_TITLES[step]} and close the site?` : `Complete ${STEP_TITLES[step]} and move on to ${STEP_TITLES[to]}?`;
    if (!window.confirm(`${question}\n\nThere is no coming back: ${STEP_TITLES[step]} is locked afterwards.`)) return;
    if (fresh.stage === "ipo_received" && !(await post(`/site-workflow/${id}/forward`, { note: "" }, "Planning started.", true))) return;
    await post(`/site-workflow/${id}/forward`, { note: "" }, to === "closed" ? "Done. The site is closed." : `${STEP_TITLES[step]} done. Next: ${STEP_TITLES[to]}.`, true);
  };
  const claim = (key: "advanceClaimed" | "finalClaimed", label: string) => {
    if (window.confirm(`Mark the ${label} payment as claimed?\n\nIt cannot be undone.`)) void post(`/site-workflow/${id}/update`, { [key]: true }, `${label} marked as claimed.`, true);
  };

  const isRequired = (step: Step, key: keyof Form) => REQUIRED[step].some((r) => r.key === key);
  const dateInput = (step: Step, key: keyof Form, label: string, hint?: string) => (
    <div className="sx-field">
      <label htmlFor={`sx-${key}`}>{label}{isRequired(step, key) && <span className="sx-req">required</span>}</label>
      <input id={`sx-${key}`} type="date" value={String(f[key])} disabled={!canEdit} onChange={(e) => set({ [key]: e.target.value } as Partial<Form>)} />
      {hint && <small>{hint}</small>}
    </div>
  );
  const completedAt = (step: Step) => {
    const from: StageKey[] = step === "planning" ? ["planning", "ipo_received"] : [step];
    const e = d.events.find((x) => x.kind === "stage_forward" && x.fromStage && from.includes(x.fromStage));
    return e ? `${e.actor} · ${fmtAt(e.at)}` : "";
  };
  const summary = (step: Step): string => {
    switch (step) {
      case "planning": {
        const vs = d.vendors.map((v) => `${v.category}: ${v.vendorName}`).join(" · ");
        return `Delivery expected ${fmtDay(d.expectedDelivery)}${d.expectedStart ? ` · start ${fmtDay(d.expectedStart)}` : ""}${d.expectedCompletion ? ` · completion ${fmtDay(d.expectedCompletion)}` : ""}${vs ? ` · ${vs}` : ""}`;
      }
      case "delivery": return `Delivered ${fmtDay(d.deliveredOn)}${d.bessDeliveredOn ? ` · BESS ${fmtDay(d.bessDeliveredOn)}` : ""} · ${d.scope === "delivery_only" ? "delivery only" : "we install and commission"}`;
      case "installation": return `Started ${fmtDay(d.startedOn)}${d.installationCompletedOn ? ` · finished ${fmtDay(d.installationCompletedOn)}` : ""} · pictures on ${d.pictureDays.filter((p) => p.pictures).length} day(s)`;
      case "commissioning": return `Commissioned ${fmtDay(d.commissionedOn)}${d.siteType !== "UPS" ? ` · Matri cloud: ${d.matriCloud ?? "—"}` : ""}`;
      case "handover": return `Handed over ${fmtDay(d.handedOverOn)} · customer sign-off ${d.customerSignoff === true ? "yes" : d.customerSignoff === false ? "no" : "—"}${extras.length ? ` · ${extras.length} item(s) outside the quotation` : ""}`;
      case "doc_dispatch": return `Submitted to customer ${fmtDay(d.submittedToCustomerDate)}${d.doDate ? ` · DO ${fmtDay(d.doDate)}` : ""}${d.acknowledgementDate ? ` · acknowledgement ${fmtDay(d.acknowledgementDate)}` : ""}`;
    }
  };

  const body = (step: Step) => {
    switch (step) {
      case "planning":
        return (
          <>
            <div className="sx-grid">
              {dateInput(step, "expectedDelivery", "Expected delivery")}
              {dateInput(step, "expectedStart", "Expected start")}
              {dateInput(step, "expectedCompletion", "Expected completion")}
            </div>
            <div className="sx-sub">Vendors</div>
            <div className="sx-vendors">
              {reference.vendorCategories.map((cat) => {
                const cur = d.vendors.find((v) => v.category === cat);
                const a = assign[cat] ?? { vendorId: "", agreedDate: "" };
                const options = vendors.filter((v) => v.category === cat && v.status === "Active");
                return (
                  <div key={cat} className="sx-vendor">
                    <b>{cat}</b>
                    {cur ? (
                      <span>{cur.vendorName}{cur.agreedDate ? ` · agreed ${fmtDay(cur.agreedDate)}` : ""}
                        {canEdit && <> · <button type="button" className="sw-link" disabled={busy} onClick={() => void post(`/site-workflow/${id}/vendors/${cur.id}/remove`, { reason: "" }, `${cat} vendor removed.`)}>Change</button></>}
                      </span>
                    ) : canEdit ? (
                      <span className="sx-inline">
                        <select aria-label={`${cat} vendor`} value={a.vendorId} onChange={(e) => setAssign({ ...assign, [cat]: { ...a, vendorId: e.target.value } })}>
                          <option value="">{options.length ? "Choose…" : "None on the list yet"}</option>
                          {options.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                        <input aria-label={`${cat} agreed date`} type="date" value={a.agreedDate} onChange={(e) => setAssign({ ...assign, [cat]: { ...a, agreedDate: e.target.value } })} />
                        <Button variant="secondary" loading={busy} disabled={!a.vendorId} onClick={() => void post(`/site-workflow/${id}/vendors`, { category: cat, vendorId: a.vendorId, agreedDate: a.agreedDate || null, notes: "" }, `${cat} vendor assigned.`)}>Assign</Button>
                      </span>
                    ) : <span className="sw-muted">—</span>}
                  </div>
                );
              })}
            </div>
            {canEdit && (
              <details className="sx-extra">
                <summary>Vendor not on the list? Add one</summary>
                <div className="sx-grid">
                  <input aria-label="Vendor name" placeholder="Name" value={newVendor.name} maxLength={200} onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })} />
                  <select aria-label="Vendor category" value={newVendor.category} onChange={(e) => setNewVendor({ ...newVendor, category: e.target.value })}>
                    <option value="">Category…</option>{reference.vendorCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input aria-label="Contact person" placeholder="Contact person" value={newVendor.contactPerson} maxLength={200} onChange={(e) => setNewVendor({ ...newVendor, contactPerson: e.target.value })} />
                  <input aria-label="Phone" placeholder="Phone" value={newVendor.phone} maxLength={50} onChange={(e) => setNewVendor({ ...newVendor, phone: e.target.value })} />
                </div>
                <div>
                  <Button variant="secondary" loading={busy} disabled={!newVendor.name.trim() || !newVendor.category} onClick={async () => {
                    setBusy(true);
                    try {
                      await api("/site-workflow/vendors", { body: { name: newVendor.name, category: newVendor.category, contactPerson: newVendor.contactPerson, phone: newVendor.phone }, csrf: session.csrfToken });
                      setNewVendor({ name: "", category: "", contactPerson: "", phone: "" }); setNotice("Vendor added to the list."); setError(""); await loadVendors();
                    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not add the vendor."); }
                    finally { setBusy(false); }
                  }}>Add vendor</Button>
                </div>
              </details>
            )}
          </>
        );
      case "delivery":
        return (
          <div className="sx-grid">
            {dateInput(step, "deliveredOn", "Delivered on")}
            {isSolarBess && dateInput(step, "bessDeliveredOn", "BESS delivered on", "Only if the batteries and inverters came on another day.")}
            <div className="sx-field sx-wide">
              <label>After delivery<span className="sx-req">required</span></label>
              <Taps label="After delivery" value={f.scope as "installation" | "delivery_only" | ""} disabled={!canEdit}
                options={reference.scopes.map((s) => ({ value: s.key, label: s.key === "delivery_only" ? "Delivery only" : "We install and commission" }))}
                onChange={(v) => set({ scope: v })} />
            </div>
          </div>
        );
      case "installation":
        return (
          <>
            <div className="sx-grid">
              {dateInput(step, "startedOn", "Installation started")}
              {dateInput(step, "installationCompletedOn", "Installation finished")}
            </div>
            <div className="sx-sub">Pictures received each day <span className="sw-muted">(tap a day to tick it)</span></div>
            {pictureDays.length === 0 ? <p className="sw-muted">Save the start date and the days appear here.</p> : (
              <div className="sw-days">
                {pictureDays.map((p) => (
                  <button type="button" key={p.day} className={`sw-day${p.state === true ? " sw-day--yes" : p.state === false ? " sw-day--no" : ""}`} disabled={!canEdit || busy}
                    aria-pressed={p.state === true} title={`Pictures for ${fmtDay(p.day)}: ${p.state === true ? "yes" : p.state === false ? "no" : "not checked"}`}
                    onClick={() => void post(`/site-workflow/${id}/pictures`, { day: p.day, pictures: p.state !== true }, `Pictures ${fmtDay(p.day)}: ${p.state !== true ? "yes" : "no"}.`)}>
                    {p.state === true ? "✓" : p.state === false ? "✗" : "○"} {fmtDay(p.day)}
                  </button>
                ))}
              </div>
            )}
          </>
        );
      case "commissioning":
        return (
          <div className="sx-grid">
            {dateInput(step, "commissionedOn", "Commissioned on")}
            {d.siteType !== "UPS" && (
              <div className="sx-field">
                <label>Matri cloud (monitoring app)</label>
                <Taps label="Matri cloud" value={f.matriCloud} disabled={!canEdit} options={reference.connectionStatuses.map((c) => ({ value: c, label: c }))} onChange={(v) => set({ matriCloud: v })} />
              </div>
            )}
          </div>
        );
      case "handover":
        return (
          <>
            <div className="sx-grid">
              {dateInput(step, "handedOverOn", "Handed over on")}
              <div className="sx-field">
                <label>Customer sign-off</label>
                <Taps label="Customer sign-off" value={f.customerSignoff} disabled={!canEdit} options={[{ value: "yes", label: "Signed" }, { value: "no", label: "Not signed" }]} onChange={(v) => set({ customerSignoff: v })} />
              </div>
            </div>
            {d.additionalItems.length > 0 && (
              <ul className="sw-rows">
                {d.additionalItems.map((a) => (
                  <li key={a.id} className="sw-row" style={{ cursor: "default" }}>
                    <span style={a.withdrawnAt ? { textDecoration: "line-through", color: "var(--pz-muted)" } : undefined}>{a.quantity} {a.unit} {a.description}{a.reason ? ` · ${a.reason}` : ""}<br /><small>{a.addedBy} · {fmtAt(a.addedAt)}</small></span>
                    {canEdit && !a.withdrawnAt && <Button variant="neutral" loading={busy} onClick={() => void post(`/site-workflow/${id}/additional-items/${a.id}/remove`, { reason: "" }, "Item withdrawn.")}>Withdraw</Button>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <details className="sx-extra">
                <summary>Used something that is not in the quotation?</summary>
                <div className="sx-grid">
                  <input aria-label="Item" placeholder="Item" value={itemForm.description} maxLength={500} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />
                  <input aria-label="Quantity" placeholder="Quantity" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} />
                  <input aria-label="Unit" placeholder="Unit" value={itemForm.unit} maxLength={50} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} />
                  <input aria-label="Reason" placeholder="Why it was needed (Accounts sees this)" value={itemForm.reason} maxLength={1000} onChange={(e) => setItemForm({ ...itemForm, reason: e.target.value })} />
                </div>
                <div><Button variant="secondary" loading={busy} disabled={!itemForm.description.trim() || !itemForm.quantity.trim()} onClick={async () => { if (await post(`/site-workflow/${id}/additional-items`, { ...itemForm, description: itemForm.description.trim(), quantity: itemForm.quantity.trim() }, "Item recorded.")) setItemForm({ description: "", quantity: "", unit: "", reason: "" }); }}>Record item</Button></div>
              </details>
            )}
          </>
        );
      case "doc_dispatch":
        return (
          <>
            <div className="sx-grid">
              {dateInput(step, "submittedToCustomerDate", "Submitted to customer")}
              {dateInput(step, "doDate", "DO date")}
              {dateInput(step, "acknowledgementDate", "Acknowledgement signed")}
              {(["advanceClaimed", "finalClaimed"] as const).map((k) => (
                <div key={k} className="sx-field">
                  <label>{k === "advanceClaimed" ? "Advance 50% (on the DO)" : "Final 50% (on the acknowledgement)"}</label>
                  <Taps label={k} value={f[k] ? "yes" : "no"} disabled={!canEdit || saved[k]} options={[{ value: "no", label: "Not yet" }, { value: "yes", label: "Claimed" }]} onChange={(v) => set({ [k]: v === "yes" } as Partial<Form>)} />
                </div>
              ))}
              <div className="sx-field sx-wide">
                <label htmlFor="sx-documentsNote">Other documents or notes</label>
                <input id="sx-documentsNote" value={f.documentsNote} maxLength={2000} disabled={!canEdit} onChange={(e) => set({ documentsNote: e.target.value })} />
              </div>
            </div>
            <div className={`sx-qc${d.qc.missing.length ? " sx-qc--missing" : ""}`}>
              <b>Quality Control documents: {d.qc.done} of {d.qc.required}</b>
              <span>{d.qc.missing.length ? `Still needed before the site can close: ${d.qc.missing.join(", ")}.` : "All submitted. The site can close."}</span>
            </div>
          </>
        );
    }
  };
  const nextLabel = (step: Step) => {
    if (step === "delivery" && !f.scope) return "Complete delivery";
    const to = after(step, f.scope);
    return to === "closed" ? "Complete and close the site" : `Complete ${STEP_TITLES[step].toLowerCase()} → ${STEP_TITLES[to]}`;
  };
  const feedback = (
    <>
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      {notice && !error && <p className="pz-feedback pz-feedback--success" role="status">{notice}</p>}
    </>
  );

  return (
    <div className="sx">
      <button type="button" className="sw-link" onClick={onBack}>← Back to the list</button>

      <section className="sx-sum" aria-label="Site details">
        <div className="sx-sum-head">
          <div>
            <h2>{d.siteName ?? "Site"}{d.siteCode ? ` (${d.siteCode})` : ""}</h2>
            <small>{d.customer ?? "—"}</small>
          </div>
          <div className="sw-chips">
            {d.qc.red && <span className="sw-chip sw-chip--danger">No delivery papers from QC</span>}
            {d.late && <span className="sw-chip sw-chip--danger">Late · {d.daysInStage} days in this step</span>}
            {d.overdue.map((o) => <span key={o} className="sw-chip sw-chip--danger">{OVERDUE_TEXT[o] ?? o}</span>)}
            {d.openProblems > 0 && <span className="sw-chip sw-chip--danger">{d.openProblems} open problem{d.openProblems === 1 ? "" : "s"}</span>}
            {d.missingPictureDays > 0 && <span className="sw-chip sw-chip--warning">{d.missingPictureDays} day{d.missingPictureDays === 1 ? "" : "s"} without pictures</span>}
          </div>
        </div>
        <div className="sx-sum-grid">
          <div><b>IPO number</b>{d.ipoNumber}<span className="sx-auto">from Coordination{d.ipoBy ? ` · ${d.ipoBy}` : ""}</span></div>
          <div><b>BOQ</b>{d.boqNumber}</div>
          <div><b>PO date</b>{fmtDay(d.poDate)}</div>
          <div><b>Region</b>{d.region ?? "—"}</div>
          <div><b>Site type</b>{d.siteType ?? "—"}</div>
          <div><b>Scope</b>{d.scope === "delivery_only" ? "Delivery only" : d.scope === "installation" ? "Install and commission" : "Decided at delivery"}</div>
        </div>
      </section>

      <ol className="sx-steps" aria-label="Steps">
        {steps.map((s, n) => {
          const state = n < currentIndex ? "done" : n === currentIndex ? "current" : "next";
          return <li key={s} className={`sx-step sx-step--${state}`} aria-current={state === "current" ? "step" : undefined}><span>{state === "done" ? "✓" : n + 1}</span>{STEP_TITLES[s]}</li>;
        })}
        <li className={`sx-step sx-step--${current === "closed" ? "done" : "next"}`}><span>{current === "closed" ? "✓" : steps.length + 1}</span>Closed</li>
      </ol>

      {done.map((s) => (
        <div key={s} className="sx-card sx-card--done">
          <span className="sx-n sx-n--done">✓</span>
          <div className="sx-done-text"><span className="sx-title">{STEP_TITLES[s]} <span className="sx-lock">Locked</span></span><span className="sx-line">{summary(s)}</span></div>
          <small>{completedAt(s)}</small>
        </div>
      ))}

      {feedback}

      {current !== "closed" ? (
        <section className="sx-card sx-card--current" aria-label={`Step ${currentIndex + 1}: ${STEP_TITLES[current]}`}>
          <header>
            <span className="sx-n">{currentIndex + 1}</span>
            <h3>{STEP_TITLES[current]}</h3>
            <small>{d.stage === "ipo_received" ? "IPO received" : "Started"} {fmtAt(d.stageEnteredAt)}</small>
          </header>
          <div className="sx-body">
            {body(current)}
            {isSolarBess && !d.bessDeliveredOn && ["installation", "commissioning", "handover"].includes(current) && (
              <div className="sx-later">
                {dateInput(current, "bessDeliveredOn", "BESS arrived later?", "The day the batteries and inverters arrived. It is locked once saved.")}
                {canEdit && <Button variant="secondary" loading={busy} disabled={!f.bessDeliveredOn} onClick={() => {
                  if (window.confirm(`Save ${fmtDay(f.bessDeliveredOn)} as the BESS delivery date?\n\nIt cannot be changed afterwards.`)) void post(`/site-workflow/${id}/update`, { bessDeliveredOn: f.bessDeliveredOn }, "BESS delivery date saved.", true);
                }}>Save BESS date</Button>}
              </div>
            )}
          </div>
          {canEdit && (
            <footer className="sx-actions">
              <Button variant="neutral" loading={busy} onClick={() => void save(current)}>Save for now</Button>
              <Button variant={after(current, f.scope) === "closed" ? "success" : "primary"} loading={busy} onClick={() => void complete(current)}>{nextLabel(current)}</Button>
            </footer>
          )}
        </section>
      ) : (
        <section className="sx-card sx-card--closed">
          <header><span className="sx-n sx-n--done">✓</span><h3>Site closed</h3><small>{fmtAt(d.closedAt)}</small></header>
          <div className="sx-body">
            <p>Advance 50%: <b>{d.advanceClaimed ? "claimed" : "not claimed yet"}</b> · Final 50%: <b>{d.finalClaimed ? "claimed" : "not claimed yet"}</b></p>
            {canEdit && (!d.advanceClaimed || !d.finalClaimed) && (
              <div className="sx-inline">
                {!d.advanceClaimed && <Button variant="secondary" loading={busy} onClick={() => claim("advanceClaimed", "Advance 50%")}>Mark advance 50% claimed</Button>}
                {!d.finalClaimed && <Button variant="secondary" loading={busy} onClick={() => claim("finalClaimed", "Final 50%")}>Mark final 50% claimed</Button>}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="sx-card">
        <header><h3>Problems</h3><small>anything that holds the site up</small></header>
        <div className="sx-body">
          {canEdit && (
            <div className="sx-inline">
              <input aria-label="New problem" placeholder="What happened, in your words" value={problemText} maxLength={2000} onChange={(e) => setProblemText(e.target.value)} style={{ flex: "1 1 240px" }} />
              <Button variant="secondary" loading={busy} disabled={!problemText.trim()} onClick={async () => { if (await post(`/site-workflow/${id}/problems`, { problem: problemText.trim() }, "Problem recorded.")) setProblemText(""); }}>Add problem</Button>
            </div>
          )}
          {d.problems.length === 0 ? <p className="sw-muted">No problems recorded.</p> : (
            <ul className="sw-rows">
              {d.problems.map((p) => (
                <li key={p.id} className="sw-row" style={{ cursor: "default", alignItems: "center" }}>
                  <span><StatusBadge tone={p.status === "Open" ? "danger" : "success"}>{p.status}</StatusBadge> {p.problem}<br /><small>{p.raisedBy} · {fmtAt(p.raisedAt)}{p.status === "Resolved" ? ` · resolved by ${p.resolvedBy} ${fmtAt(p.resolvedAt)}${p.resolution ? `: ${p.resolution}` : ""}` : ""}</small></span>
                  {canEdit && p.status === "Open" && (
                    <span className="sx-inline">
                      <input aria-label="Resolution" placeholder="How it was resolved" value={resolution[p.id] ?? ""} maxLength={2000} onChange={(e) => setResolution({ ...resolution, [p.id]: e.target.value })} />
                      <Button variant="neutral" loading={busy} onClick={() => void post(`/site-workflow/${id}/problems/${p.id}/resolve`, { resolution: resolution[p.id] ?? "" }, "Problem resolved.")}>Resolve</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <details className="sx-card sx-more">
        <summary><h3>History</h3></summary>
        <ul className="sw-rows">
          {d.events.map((e) => (
            <li key={e.id} className="sw-row" style={{ cursor: "default" }}>
              <span>{e.kind === "stage_forward" ? `Moved to ${STAGE_LABELS[e.toStage!]}` : e.kind === "stage_back" ? `Admin correction: back to ${STAGE_LABELS[e.toStage!]}` : e.kind.replaceAll("_", " ")}{e.note ? <><br /><small>{e.note}</small></> : null}</span>
              <small>{e.actor} · {fmtAt(e.at)}</small>
            </li>
          ))}
        </ul>
      </details>

      {isAdmin && d.previousStage && (
        <details className="sx-card sx-more">
          <summary><h3>Admin correction</h3></summary>
          <div className="sx-body">
            <p className="sw-muted">Only Admin can send a site back a step, with a reason. Operations cannot.</p>
            <div className="sx-inline">
              <input aria-label="Reason for going back" placeholder="Why the site goes back (required)" value={backNote} maxLength={500} onChange={(e) => setBackNote(e.target.value)} style={{ flex: "1 1 240px" }} />
              <Button variant="neutral" loading={busy} disabled={!backNote.trim()} onClick={async () => { if (await post(`/site-workflow/${id}/back`, { note: backNote }, `Back to ${STAGE_LABELS[d.previousStage!]}.`, true)) setBackNote(""); }}>Back to {STAGE_LABELS[d.previousStage]}</Button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
