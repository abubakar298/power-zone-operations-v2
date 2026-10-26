import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import { StatusBadge } from "../../ui/StatusBadge.js";
import { STAGE_KEYS, STAGE_LABELS, STAGE_COLOURS, pathFor, fmtDay, fmtAt, today, missingDocs, OVERDUE_TEXT, type SiteRow, type StageKey } from "./stages.js";

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
  vendors: { id: string; category: string; vendorId: string; vendorName: string; contactPerson: string; phone: string; agreedDate: string | null; notes: string; assignedBy: string; assignedAt: string }[];
  pictureDays: { day: string; pictures: boolean }[];
  problems: { id: string; problem: string; status: "Open" | "Resolved"; raisedBy: string; raisedAt: string; resolvedBy: string | null; resolvedAt: string | null; resolution: string }[];
  cables: { itemKey: string; name: string; unit: string; boqQty: string; usedQty: string | null; returnedQty: string; variance: string | null; direction: string; flagged: boolean; note: string; updatedAt: string | null; updatedBy: string | null }[];
  additionalItems: { id: string; description: string; quantity: string; unit: string; reason: string; addedBy: string; addedAt: string; withdrawnAt: string | null; withdrawnBy: string | null; withdrawalReason: string }[];
  events: { id: string; kind: string; fromStage: StageKey | null; toStage: StageKey | null; changes: Record<string, any>; note: string; actor: string; at: string }[];
}

interface Form {
  siteType: string; region: string; notes: string;
  expectedStart: string; expectedDelivery: string; expectedCompletion: string;
  deliveredOn: string; bessDeliveredOn: string; scope: string;
  startedOn: string; installationCompletedOn: string;
  commissionedOn: string; matriCloud: string; fourG: string;
  handedOverOn: string; customerSignoff: "" | "yes" | "no";
  doDate: string; acknowledgementDate: string; submittedToCustomerDate: string; advanceClaimed: boolean; finalClaimed: boolean; documentsNote: string;
}
const toForm = (d: Detail): Form => ({
  siteType: d.siteType ?? "", region: d.region ?? "", notes: d.notes,
  expectedStart: d.expectedStart ?? "", expectedDelivery: d.expectedDelivery ?? "", expectedCompletion: d.expectedCompletion ?? "",
  deliveredOn: d.deliveredOn ?? "", bessDeliveredOn: d.bessDeliveredOn ?? "", scope: d.scope ?? "",
  startedOn: d.startedOn ?? "", installationCompletedOn: d.installationCompletedOn ?? "",
  commissionedOn: d.commissionedOn ?? "", matriCloud: d.matriCloud ?? "", fourG: d.fourG ?? "",
  handedOverOn: d.handedOverOn ?? "", customerSignoff: d.customerSignoff === true ? "yes" : d.customerSignoff === false ? "no" : "",
  doDate: d.doDate ?? "", acknowledgementDate: d.acknowledgementDate ?? "", submittedToCustomerDate: d.submittedToCustomerDate ?? "",
  advanceClaimed: d.advanceClaimed, finalClaimed: d.finalClaimed, documentsNote: d.documentsNote,
});
const SECTION_KEYS = {
  site: ["siteType", "region", "notes"],
  planning: ["expectedStart", "expectedDelivery", "expectedCompletion"],
  delivery: ["deliveredOn", "bessDeliveredOn", "scope"],
  installation: ["startedOn", "installationCompletedOn"],
  commissioning: ["commissionedOn", "matriCloud", "fourG"],
  handover: ["handedOverOn", "customerSignoff"],
  docs: ["doDate", "acknowledgementDate", "submittedToCustomerDate", "advanceClaimed", "finalClaimed", "documentsNote"],
} as const;
type Section = keyof typeof SECTION_KEYS;
const SECTION_STAGE: Record<Exclude<Section, "site">, StageKey> = { planning: "planning", delivery: "delivery", installation: "installation", commissioning: "commissioning", handover: "handover", docs: "doc_dispatch" };
function payload(form: Form, keys: readonly (keyof Form)[]) {
  const body: Record<string, unknown> = {};
  for (const k of keys) {
    const v = form[k];
    body[k] = k === "customerSignoff" ? (v === "yes" ? true : v === "no" ? false : null) : typeof v === "boolean" ? v : k === "notes" || k === "documentsNote" ? v : v === "" ? null : v;
  }
  return body;
}
const stageIndex = (k: StageKey) => STAGE_KEYS.indexOf(k);
const EVENT_TEXT = (e: Detail["events"][number]) => {
  const c = e.changes ?? {};
  switch (e.kind) {
    case "stage_forward": return `Moved to ${STAGE_LABELS[e.toStage!]}`;
    case "stage_back": return `Back to ${STAGE_LABELS[e.toStage!]} from ${STAGE_LABELS[e.fromStage!]}`;
    case "field_update": return `Updated ${Object.keys(c).join(", ")}`;
    case "pictures": return `Pictures ${c.day}: ${c.pictures ? "yes" : "no"}`;
    case "problem_added": return "Problem raised";
    case "problem_resolved": return "Problem resolved";
    case "vendor_assigned": return `${c.category} vendor: ${c.vendor}`;
    case "vendor_removed": return `${c.category} vendor removed: ${c.vendor}`;
    case "cable_usage": return `Cable ${c.itemKey}: used ${c.usedQty}, returned ${c.returnedQty}`;
    case "additional_item": return `Additional item: ${c.quantity} ${c.unit} ${c.description}`;
    case "additional_item_withdrawn": return `Additional item withdrawn: ${c.description}`;
    default: return e.kind;
  }
};

/** One site after its IPO: stepper, stage action, the sections of each stage, problems and history. */
export function SiteDetail({ session, id, reference, onBack }: { session: Session; id: string; reference: Reference; onBack: () => void }) {
  const canEdit = ["Admin", "Management", "Operations"].includes(session.user.role);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [moveNote, setMoveNote] = useState("");
  const [backNote, setBackNote] = useState("");
  const [assign, setAssign] = useState<Record<string, { vendorId: string; agreedDate: string; notes: string }>>({});
  const [newVendor, setNewVendor] = useState({ name: "", category: "", contactPerson: "", phone: "" });
  const [problemText, setProblemText] = useState("");
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [cableForm, setCableForm] = useState<Record<string, { used: string; returned: string; note: string }>>({});
  const [itemForm, setItemForm] = useState({ description: "", quantity: "", unit: "", reason: "" });

  const loadVendors = useCallback(async () => {
    try { setVendors((await api<{ vendors: Vendor[] }>("/site-workflow/vendors")).vendors); } catch { /* read-only roles may not need the list */ }
  }, []);
  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/site-workflow/${id}`);
      setDetail(d); setForm(toForm(d)); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to open the site."); }
  }, [id]);
  useEffect(() => { void load(); void loadVendors(); }, [load, loadVendors]);

  /** Posts an action. The form is refreshed from the server only when `refreshForm` is set, so unsaved edits survive side actions. */
  const post = useCallback(async (path: string, body: unknown, message: string, refreshForm = false) => {
    setBusy(true);
    try {
      const d = await api<Detail>(path, { body, csrf: session.csrfToken });
      setDetail(d); if (refreshForm) setForm(toForm(d));
      setNotice(message); setError("");
      return true;
    } catch (e) { setError(e instanceof ApiError ? e.message : "The change was not saved."); setNotice(""); return false; }
    finally { setBusy(false); }
  }, [session.csrfToken]);
  const save = (section: Section) => form && post(`/site-workflow/${id}/update`, payload(form, SECTION_KEYS[section]), "Saved.", true);

  const path = useMemo(() => (detail ? pathFor(detail.scope) : [...STAGE_KEYS]), [detail]);
  const pictureDays = useMemo(() => {
    if (!detail?.startedOn) return [] as { day: string; state: boolean | null }[];
    const map = new Map(detail.pictureDays.map((p) => [p.day, p.pictures]));
    const last = detail.installationCompletedOn && detail.installationCompletedOn < today() ? detail.installationCompletedOn : today();
    const out: { day: string; state: boolean | null }[] = [];
    const d = new Date(`${detail.startedOn}T00:00:00`);
    for (let i = 0; i < 120; i++) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (key > last) break;
      out.push({ day: key, state: map.has(key) ? map.get(key)! : null });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [detail]);

  if (error && !detail) return <div className="pz-stack"><p className="pz-feedback pz-feedback--danger" role="alert">{error}</p><Button variant="neutral" onClick={onBack}>Back</Button></div>;
  if (!detail || !form) return <p role="status">Loading site…</p>;
  const d = detail, f = form;
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });
  const sectionState = (section: Exclude<Section, "site">): "done" | "current" | "todo" | "skipped" => {
    const stage = SECTION_STAGE[section];
    if (!path.includes(stage)) return "skipped";
    if (d.stage === stage) return "current";
    return stageIndex(d.stage) > stageIndex(stage) || d.stage === "closed" ? "done" : "todo";
  };
  const Section = ({ id: section, title, children, extra }: { id: Exclude<Section, "site">; title: string; children: ReactNode; extra?: ReactNode }) => {
    const state = sectionState(section);
    if (state === "skipped") return null;
    return (
      <section className={`pz-panel pz-stack sw-section sw-section--${state}`}>
        <div className="sw-section-head">
          <h3><i className="sw-dot" style={{ background: STAGE_COLOURS[SECTION_STAGE[section]] }} />{title}</h3>
          {state === "current" && <StatusBadge tone="pending">Current stage</StatusBadge>}
          {state === "done" && <StatusBadge tone="success">Done</StatusBadge>}
        </div>
        {children}
        {canEdit && <div className="pz-action-row"><Button variant="primary" loading={busy} onClick={() => void save(section)}>Save</Button>{extra}</div>}
      </section>
    );
  };
  const dateField = (key: keyof Form, label: string, hint?: string) => (
    <Field id={`sw-${key}`} label={label} hint={hint}>
      <input id={`sw-${key}`} type="date" value={String(f[key])} disabled={!canEdit} onChange={(e) => set({ [key]: e.target.value } as Partial<Form>)} />
    </Field>
  );
  const selectField = (key: keyof Form, label: string, options: readonly string[] | { key: string; label: string }[], hint?: string) => (
    <Field id={`sw-${key}`} label={label} hint={hint}>
      <select id={`sw-${key}`} value={String(f[key])} disabled={!canEdit} onChange={(e) => set({ [key]: e.target.value } as Partial<Form>)}>
        <option value="">—</option>
        {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.key} value={o.key}>{o.label}</option>))}
      </select>
    </Field>
  );
  const next = d.nextStage, prev = d.previousStage;
  const needsScope = d.stage === "delivery" && !d.scope;

  return (
    <div className="sw">
      <div className="sw-head">
        <div>
          <button type="button" className="sw-link" onClick={onBack}>← Back to the list</button>
          <h2 style={{ margin: "4px 0 0" }}>{d.siteName ?? "Site"}{d.siteCode ? ` (${d.siteCode})` : ""}</h2>
          <small>{d.customer ?? "—"}{d.region ? ` · ${d.region}` : ""} · IPO {d.ipoNumber} · BOQ {d.boqNumber} · PO date {fmtDay(d.poDate)}</small>
        </div>
        <div className="sw-chips">
          {d.late && <span className="sw-chip sw-chip--danger">Late · {d.daysInStage} days in stage</span>}
          {d.overdue.map((o) => <span key={o} className="sw-chip sw-chip--danger">{OVERDUE_TEXT[o] ?? o}</span>)}
          {d.openProblems > 0 && <span className="sw-chip sw-chip--danger">{d.openProblems} open problem{d.openProblems === 1 ? "" : "s"}</span>}
          {d.missingPictureDays > 0 && <span className="sw-chip sw-chip--warning">{d.missingPictureDays} day{d.missingPictureDays === 1 ? "" : "s"} without pictures</span>}
          {d.scopeLabel && <span className="sw-chip">{d.scopeLabel}</span>}
        </div>
      </div>
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      {notice && !error && <p className="pz-feedback pz-feedback--success" role="status">{notice}</p>}

      <div className="sw-steps" aria-label="Workflow stages">
        {STAGE_KEYS.map((key) => {
          const onPath = path.includes(key);
          const state = !onPath ? "skipped" : key === d.stage ? "current" : stageIndex(key) < stageIndex(d.stage) || (d.stage === "closed") ? "done" : "todo";
          return (
            <div key={key} className={`sw-step sw-step--${state}`} aria-current={state === "current" ? "step" : undefined}>
              <strong><i style={{ background: STAGE_COLOURS[key] }} />{STAGE_LABELS[key]}</strong>
              <small>{state === "current" ? `${d.daysInStage} day${d.daysInStage === 1 ? "" : "s"} here` : state === "done" ? "done" : state === "skipped" ? "not in scope" : "next"}</small>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <section className="sw-action" aria-label="Stage action">
          <div className="sw-head"><h3>Now: {STAGE_LABELS[d.stage]}</h3><small>{d.stage === "closed" ? `Closed ${fmtAt(d.closedAt)}` : `since ${fmtAt(d.stageEnteredAt)}`}</small></div>
          {needsScope && (
            <>
              <p className="sw-muted">Are we installing and commissioning this site, or is it delivery only?</p>
              <div className="sw-choice" role="radiogroup" aria-label="Scope">
                {reference.scopes.map((s) => (
                  <label key={s.key}><input type="radio" name="sw-scope" checked={f.scope === s.key} onChange={() => { set({ scope: s.key }); void post(`/site-workflow/${id}/update`, { scope: s.key }, "Scope saved."); }} />{s.label}</label>
                ))}
              </div>
            </>
          )}
          {next ? (
            <div className="sw-action-row">
              <input aria-label="Note for the stage move" placeholder="Note (optional)" value={moveNote} maxLength={500} onChange={(e) => setMoveNote(e.target.value)} style={{ flex: "1 1 240px" }} />
              <Button variant={next === "closed" ? "success" : "primary"} loading={busy} disabled={needsScope}
                onClick={async () => { if (await post(`/site-workflow/${id}/forward`, { note: moveNote }, `Moved to ${STAGE_LABELS[next]}.`, true)) setMoveNote(""); }}>
                {next === "closed" ? "Close site" : `Move to ${STAGE_LABELS[next]}`}
              </Button>
            </div>
          ) : d.stage === "closed" ? <p className="sw-muted">This site is closed.</p> : null}
          {prev && (
            <details>
              <summary className="sw-muted">Made a mistake? Go back to {STAGE_LABELS[prev]}</summary>
              <div className="sw-action-row" style={{ marginTop: 8 }}>
                <input aria-label="Reason for going back" placeholder="Why the site goes back (required)" value={backNote} maxLength={500} onChange={(e) => setBackNote(e.target.value)} style={{ flex: "1 1 240px" }} />
                <Button variant="neutral" loading={busy} disabled={!backNote.trim()}
                  onClick={async () => { if (await post(`/site-workflow/${id}/back`, { note: backNote }, `Back to ${STAGE_LABELS[prev]}.`, true)) setBackNote(""); }}>
                  Back to {STAGE_LABELS[prev]}
                </Button>
              </div>
            </details>
          )}
        </section>
      )}

      <section className="pz-panel pz-stack">
        <h3>Site</h3>
        <div className="sw-grid">
          {selectField("siteType", "Site type", reference.siteTypes, "UPS sites have no monitoring app or 4G device.")}
          {selectField("region", "Region", reference.regions)}
          <Field id="sw-notes" label="Notes"><input id="sw-notes" value={f.notes} maxLength={2000} disabled={!canEdit} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
        {canEdit && <div className="pz-action-row"><Button variant="primary" loading={busy} onClick={() => void save("site")}>Save</Button></div>}
      </section>

      <Section id="planning" title="Under planning">
        <div className="sw-grid">
          {dateField("expectedStart", "Expected start")}
          {dateField("expectedDelivery", "Expected delivery", "Needed before the site moves to Delivery.")}
          {dateField("expectedCompletion", "Expected completion")}
        </div>
        <h4 style={{ margin: 0 }}>Vendors</h4>
        <div className="pz-table-scroll">
          <table className="pz-table">
            <thead><tr><th>Category</th><th>Vendor</th><th>Agreed date</th><th>Notes</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {reference.vendorCategories.map((cat) => {
                const current = d.vendors.find((v) => v.category === cat);
                const a = assign[cat] ?? { vendorId: "", agreedDate: "", notes: "" };
                const options = vendors.filter((v) => v.category === cat && v.status === "Active");
                return (
                  <tr key={cat}>
                    <td>{cat}</td>
                    {current ? (
                      <>
                        <td><strong>{current.vendorName}</strong>{(current.contactPerson || current.phone) && <><br /><small>{[current.contactPerson, current.phone].filter(Boolean).join(" · ")}</small></>}</td>
                        <td>{fmtDay(current.agreedDate)}</td>
                        <td>{current.notes || "—"}<br /><small>{current.assignedBy} · {fmtAt(current.assignedAt)}</small></td>
                        {canEdit && <td><Button variant="neutral" loading={busy} onClick={() => void post(`/site-workflow/${id}/vendors/${current.id}/remove`, { reason: "" }, `${cat} vendor removed.`)}>Remove</Button></td>}
                      </>
                    ) : canEdit ? (
                      <>
                        <td>
                          <select aria-label={`${cat} vendor`} value={a.vendorId} onChange={(e) => setAssign({ ...assign, [cat]: { ...a, vendorId: e.target.value } })}>
                            <option value="">—</option>
                            {options.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                          {options.length === 0 && <><br /><small>No {cat.toLowerCase()} vendor yet. Add one below.</small></>}
                        </td>
                        <td><input aria-label={`${cat} agreed date`} type="date" value={a.agreedDate} onChange={(e) => setAssign({ ...assign, [cat]: { ...a, agreedDate: e.target.value } })} /></td>
                        <td><input aria-label={`${cat} notes`} value={a.notes} maxLength={500} onChange={(e) => setAssign({ ...assign, [cat]: { ...a, notes: e.target.value } })} /></td>
                        <td><Button variant="secondary" loading={busy} disabled={!a.vendorId} onClick={() => void post(`/site-workflow/${id}/vendors`, { category: cat, vendorId: a.vendorId, agreedDate: a.agreedDate || null, notes: a.notes }, `${cat} vendor assigned.`)}>Assign</Button></td>
                      </>
                    ) : <><td>—</td><td>—</td><td>—</td></>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <details>
            <summary className="sw-muted">Add a vendor to the list</summary>
            <div className="sw-grid" style={{ marginTop: 8 }}>
              <Field id="sw-vendor-name" label="Name"><input id="sw-vendor-name" value={newVendor.name} maxLength={200} onChange={(e) => setNewVendor({ ...newVendor, name: e.target.value })} /></Field>
              <Field id="sw-vendor-category" label="Category">
                <select id="sw-vendor-category" value={newVendor.category} onChange={(e) => setNewVendor({ ...newVendor, category: e.target.value })}>
                  <option value="">—</option>{reference.vendorCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field id="sw-vendor-contact" label="Contact person"><input id="sw-vendor-contact" value={newVendor.contactPerson} maxLength={200} onChange={(e) => setNewVendor({ ...newVendor, contactPerson: e.target.value })} /></Field>
              <Field id="sw-vendor-phone" label="Phone"><input id="sw-vendor-phone" value={newVendor.phone} maxLength={50} onChange={(e) => setNewVendor({ ...newVendor, phone: e.target.value })} /></Field>
            </div>
            <Button variant="secondary" loading={busy} disabled={!newVendor.name.trim() || !newVendor.category} onClick={async () => {
              setBusy(true);
              try {
                await api("/site-workflow/vendors", { body: { name: newVendor.name, category: newVendor.category, contactPerson: newVendor.contactPerson, phone: newVendor.phone }, csrf: session.csrfToken });
                setNewVendor({ name: "", category: "", contactPerson: "", phone: "" }); setNotice("Vendor added."); setError(""); await loadVendors();
              } catch (e) { setError(e instanceof ApiError ? e.message : "Could not add the vendor."); }
              finally { setBusy(false); }
            }}>Add vendor</Button>
          </details>
        )}
      </Section>

      <Section id="delivery" title="Delivery">
        <div className="sw-grid">
          {dateField("deliveredOn", "Delivered on", "Needed before the site leaves Delivery.")}
          {form.siteType === "Solar + BESS" && dateField("bessDeliveredOn", "BESS delivered on", "Batteries and inverters, if they arrived on another day. Quality Control's deadline counts from it.")}
          {selectField("scope", "After delivery", reference.scopes, "Installation and commissioning by us, or delivery only (the site closes after delivery).")}
        </div>
      </Section>

      <Section id="installation" title="Installation">
        <div className="sw-grid">
          {dateField("startedOn", "Started on", "Lists the days below for the picture check.")}
          {dateField("installationCompletedOn", "Installation completed on")}
        </div>
        <h4 style={{ margin: 0 }}>Pictures by day</h4>
        {pictureDays.length === 0 ? <p className="sw-muted">Enter the start date to list the days.</p> : (
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
      </Section>

      <Section id="commissioning" title="Commissioning">
        <div className="sw-grid">
          {dateField("commissionedOn", "Commissioned on")}
          {f.siteType !== "UPS" && selectField("matriCloud", "Matri cloud (monitoring app)", reference.connectionStatuses)}
          {f.siteType !== "UPS" && selectField("fourG", "4G device", reference.connectionStatuses)}
        </div>
        {f.siteType === "UPS" && <p className="sw-muted">UPS sites get neither the monitoring app nor a 4G device.</p>}
      </Section>

      <Section id="handover" title="Handover">
        <div className="sw-grid">
          {dateField("handedOverOn", "Handed over on", "Needed before the site moves to Doc dispatch.")}
          <Field id="sw-customerSignoff" label="Customer sign-off">
            <select id="sw-customerSignoff" value={f.customerSignoff} disabled={!canEdit} onChange={(e) => set({ customerSignoff: e.target.value as Form["customerSignoff"] })}>
              <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </Field>
        </div>
        <h4 style={{ margin: 0 }}>Cables used against the BOQ</h4>
        <p className="sw-muted">Every difference is flagged: extra cable used is invoiced to the customer; cable charged but not used is refunded.</p>
        {d.cables.length === 0 ? <p className="sw-muted">No cable lines on this site's BOQ.</p> : (
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Cable</th><th>BOQ</th><th>Used</th><th>Returned</th><th>Variance</th><th>Note</th>{canEdit && <th></th>}</tr></thead>
              <tbody>
                {d.cables.map((c) => {
                  const cf = cableForm[c.itemKey] ?? { used: c.usedQty ?? "", returned: c.returnedQty === "0" ? "" : c.returnedQty, note: c.note };
                  return (
                    <tr key={c.itemKey}>
                      <td><strong>{c.name}</strong><br /><small>{c.unit}</small></td>
                      <td>{c.boqQty}</td>
                      <td>{canEdit ? <input aria-label={`${c.name} used`} style={{ width: "6rem" }} value={cf.used} onChange={(e) => setCableForm({ ...cableForm, [c.itemKey]: { ...cf, used: e.target.value } })} /> : c.usedQty ?? "—"}</td>
                      <td>{canEdit ? <input aria-label={`${c.name} returned`} style={{ width: "6rem" }} value={cf.returned} onChange={(e) => setCableForm({ ...cableForm, [c.itemKey]: { ...cf, returned: e.target.value } })} /> : c.returnedQty}</td>
                      <td>{c.variance == null ? <StatusBadge tone="pending">Not entered</StatusBadge> : <StatusBadge tone={c.flagged ? "warning" : "success"}>{Number(c.variance) > 0 ? `+${c.variance}` : c.variance} · {c.direction}</StatusBadge>}</td>
                      <td>{canEdit ? <input aria-label={`${c.name} note`} value={cf.note} maxLength={500} onChange={(e) => setCableForm({ ...cableForm, [c.itemKey]: { ...cf, note: e.target.value } })} /> : c.note || "—"}</td>
                      {canEdit && <td><Button variant="secondary" loading={busy} disabled={!cf.used.trim()} onClick={() => void post(`/site-workflow/${id}/cables`, { itemKey: c.itemKey, usedQty: cf.used.trim(), returnedQty: cf.returned.trim() || "0", note: cf.note }, `${c.name} saved.`)}>Save</Button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <h4 style={{ margin: 0 }}>Items used outside the quotation</h4>
        {canEdit && (
          <div className="sw-grid">
            <Field id="sw-item-desc" label="Item"><input id="sw-item-desc" value={itemForm.description} maxLength={500} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></Field>
            <Field id="sw-item-qty" label="Quantity"><input id="sw-item-qty" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} /></Field>
            <Field id="sw-item-unit" label="Unit"><input id="sw-item-unit" value={itemForm.unit} maxLength={50} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} /></Field>
            <Field id="sw-item-reason" label="Reason" hint="Why it was needed. Accounts sees this."><input id="sw-item-reason" value={itemForm.reason} maxLength={1000} onChange={(e) => setItemForm({ ...itemForm, reason: e.target.value })} /></Field>
          </div>
        )}
        {canEdit && <div className="pz-action-row"><Button variant="secondary" loading={busy} disabled={!itemForm.description.trim() || !itemForm.quantity.trim()} onClick={async () => { if (await post(`/site-workflow/${id}/additional-items`, { ...itemForm, description: itemForm.description.trim(), quantity: itemForm.quantity.trim() }, "Item recorded.")) setItemForm({ description: "", quantity: "", unit: "", reason: "" }); }}>Record item</Button></div>}
        {d.additionalItems.length === 0 ? <p className="sw-muted">No additional items.</p> : (
          <ul className="sw-rows">
            {d.additionalItems.map((a) => (
              <li key={a.id} className="sw-row" style={{ cursor: "default" }}>
                <span style={a.withdrawnAt ? { textDecoration: "line-through", color: "var(--pz-muted)" } : undefined}>
                  {a.quantity} {a.unit} {a.description}{a.reason ? ` · ${a.reason}` : ""}<br /><small>{a.addedBy} · {fmtAt(a.addedAt)}{a.withdrawnAt ? ` · withdrawn by ${a.withdrawnBy} ${fmtAt(a.withdrawnAt)}` : ""}</small>
                </span>
                {canEdit && !a.withdrawnAt && <Button variant="neutral" loading={busy} onClick={() => void post(`/site-workflow/${id}/additional-items/${a.id}/remove`, { reason: "" }, "Item withdrawn.")}>Withdraw</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="docs" title="Doc dispatch">
        <p className="sw-muted">UBL pays 50% on the DO and 50% on the branch manager's acknowledgement.</p>
        <div className="sw-grid">
          {dateField("doDate", "DO date")}
          {dateField("acknowledgementDate", "Acknowledgement signed")}
          {dateField("submittedToCustomerDate", "Submitted to customer", "Needed before the site can close.")}
          <Field id="sw-advanceClaimed" label="Advance 50% claimed">
            <select id="sw-advanceClaimed" value={f.advanceClaimed ? "yes" : "no"} disabled={!canEdit} onChange={(e) => set({ advanceClaimed: e.target.value === "yes" })}><option value="no">No</option><option value="yes">Yes</option></select>
          </Field>
          <Field id="sw-finalClaimed" label="Final 50% claimed">
            <select id="sw-finalClaimed" value={f.finalClaimed ? "yes" : "no"} disabled={!canEdit} onChange={(e) => set({ finalClaimed: e.target.value === "yes" })}><option value="no">No</option><option value="yes">Yes</option></select>
          </Field>
          <Field id="sw-documentsNote" label="Additional documents / notes"><input id="sw-documentsNote" value={f.documentsNote} maxLength={2000} disabled={!canEdit} onChange={(e) => set({ documentsNote: e.target.value })} /></Field>
        </div>
        {missingDocs(d).length > 0 && <div className="sw-chips">{missingDocs(d).map((m) => <span key={m} className="sw-chip sw-chip--warning">Missing: {m}</span>)}</div>}
      </Section>

      <section className="pz-panel pz-stack">
        <h3>Problems</h3>
        {canEdit && (
          <div className="sw-action-row">
            <input aria-label="New problem" placeholder="What happened, in your words" value={problemText} maxLength={2000} onChange={(e) => setProblemText(e.target.value)} style={{ flex: "1 1 240px" }} />
            <Button variant="secondary" loading={busy} disabled={!problemText.trim()} onClick={async () => { if (await post(`/site-workflow/${id}/problems`, { problem: problemText.trim() }, "Problem recorded.")) setProblemText(""); }}>Add problem</Button>
          </div>
        )}
        {d.problems.length === 0 ? <p className="sw-muted">No problems recorded.</p> : (
          <ul className="sw-rows">
            {d.problems.map((p) => (
              <li key={p.id} className="sw-row" style={{ cursor: "default", alignItems: "center" }}>
                <span>
                  <StatusBadge tone={p.status === "Open" ? "danger" : "success"}>{p.status}</StatusBadge> {p.problem}<br />
                  <small>{p.raisedBy} · {fmtAt(p.raisedAt)}{p.status === "Resolved" ? ` · resolved by ${p.resolvedBy} ${fmtAt(p.resolvedAt)}${p.resolution ? `: ${p.resolution}` : ""}` : ""}</small>
                </span>
                {canEdit && p.status === "Open" && (
                  <span className="sw-action-row">
                    <input aria-label="Resolution" placeholder="How it was resolved" value={resolution[p.id] ?? ""} maxLength={2000} onChange={(e) => setResolution({ ...resolution, [p.id]: e.target.value })} />
                    <Button variant="neutral" loading={busy} onClick={() => void post(`/site-workflow/${id}/problems/${p.id}/resolve`, { resolution: resolution[p.id] ?? "" }, "Problem resolved.")}>Resolve</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pz-panel pz-stack">
        <h3>History</h3>
        {d.events.length === 0 ? <p className="sw-muted">No changes yet.</p> : (
          <ul className="sw-rows">
            {d.events.map((e) => (
              <li key={e.id} className="sw-row" style={{ cursor: "default" }}>
                <span>{EVENT_TEXT(e)}{e.note ? <><br /><small>{e.note}</small></> : null}</span>
                <small>{e.actor} · {fmtAt(e.at)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
