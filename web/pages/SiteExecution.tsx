import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { StatusBadge } from "../ui/StatusBadge.js";

type StageKey =
  | "ipo_received" | "material_planning" | "procurement" | "delivery_scheduled" | "dispatched"
  | "installation" | "commissioning" | "documents" | "closed";
interface SiteRow {
  id: string; ipoNumber: string; boqNumber: string; customer: string | null; siteName: string | null;
  siteCode: string | null; region: string | null; siteType: string | null; stage: StageKey; stageLabel: string;
  stageEnteredAt: string; daysInStage: number; late: boolean; poDate: string | null;
  materialDeliveryPlanned: string | null; materialDeliveryActual: string | null; startDate: string | null;
  endDate: string | null; matriCloudStatus: string | null; fourGStatus: string | null; customerSignoff: boolean | null;
  doDate: string | null; acknowledgementDate: string | null; submittedToCustomerDate: string | null;
  advanceClaimed: boolean; finalClaimed: boolean; documentsNote: string; openProblems: number; missingPictureDays: number;
}
interface Overview {
  sites: SiteRow[]; stages: { key: StageKey; label: string }[]; regions: string[]; siteTypes: string[];
  connectionStatuses: string[]; lateAfterDays: number;
}
interface Detail extends SiteRow {
  photoChecks: { date: string; pictures: boolean; updatedAt: string }[];
  problems: { id: string; problem: string; status: "Open" | "Resolved"; createdBy: string; createdAt: string; resolvedBy: string | null; resolvedAt: string | null; resolution: string }[];
  events: { kind: string; fromStage: string | null; toStage: string | null; changes: Record<string, any>; note: string; actor: string; at: string }[];
  headsUp: { source: string; number: string; mode: string; expectedDate: string | null; notes: string; items: number; createdAt: string } | null;
  vendors: { id: string; category: string; vendorId: string; vendorName: string; phone: string; contactPerson: string; agreedDate: string | null; notes: string; assignedAt: string; assignedBy: string }[];
  reservations: { id: string; itemKey: string; name: string; quantity: string; note: string; reservedAt: string; reservedBy: string }[];
}
interface Materials {
  lines: { lineNumber: number; itemKey: string; name: string; brand: string; specification: string; unit: string; boqQty: string; reserved: string; existing: string | null; available: string | null; outstanding: string }[];
  reservations: { id: string; itemKey: string; quantity: string; note: string; reservedAt: string; reservedBy: string; releasedAt: string | null; releaseReason: string }[];
}
interface VendorRef { id: string; name: string; category: string; status: "Active" | "Inactive" }
interface CableLine { itemKey: string; name: string; unit: string; boqQty: string; issuedQty: string | null; usedQty: string | null; returnedQty: string; variance: string | null; direction: string; flagged: boolean; note: string; updatedAt: string | null; updatedBy: string | null }
interface AdditionalItem { id: string; itemKey: string | null; itemName: string | null; description: string; quantity: string; unit: string; reason: string; createdAt: string; createdBy: string; removedAt: string | null; removedBy: string | null; removalReason: string }
type FormState = {
  siteType: string; region: string; materialDeliveryPlanned: string; materialDeliveryActual: string; startDate: string;
  endDate: string; matriCloudStatus: string; fourGStatus: string; customerSignoff: string; doDate: string;
  acknowledgementDate: string; submittedToCustomerDate: string; advanceClaimed: boolean; finalClaimed: boolean; documentsNote: string;
};

const isoDay = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const today = () => isoDay(new Date());
const fmt = (v: string | null | undefined) => {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
};
const fmtAt = (v: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(v));
const dayList = (start: string | null, end: string | null) => {
  if (!start) return [] as string[];
  const last = end && end < today() ? end : today();
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let i = 0; i < 400; i++) {
    const iso = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
    if (iso > last) break;
    out.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};
const toForm = (d: SiteRow): FormState => ({
  siteType: d.siteType ?? "", region: d.region ?? "", materialDeliveryPlanned: d.materialDeliveryPlanned ?? "",
  materialDeliveryActual: d.materialDeliveryActual ?? "", startDate: d.startDate ?? "", endDate: d.endDate ?? "",
  matriCloudStatus: d.matriCloudStatus ?? "", fourGStatus: d.fourGStatus ?? "",
  customerSignoff: d.customerSignoff == null ? "" : d.customerSignoff ? "yes" : "no", doDate: d.doDate ?? "",
  acknowledgementDate: d.acknowledgementDate ?? "", submittedToCustomerDate: d.submittedToCustomerDate ?? "",
  advanceClaimed: d.advanceClaimed, finalClaimed: d.finalClaimed, documentsNote: d.documentsNote ?? "",
});
const stageTone = (s: SiteRow): "pending" | "success" | "warning" | "danger" =>
  s.stage === "closed" ? "success" : s.late ? "danger" : "pending";

interface StockSummary { short: number; uncounted: number; reserved: number; reservedSites: number }
export type SiteBoardMode = "all" | "ongoing" | "completed" | "documentation";
const MODE_TEXT: Record<SiteBoardMode, { title: string; note: string }> = {
  all: { title: "All sites", note: "Every site after its IPO, whatever its stage." },
  ongoing: { title: "Ongoing sites", note: "Sites not yet closed, from IPO received to Documents." },
  completed: { title: "Sites completed (last 30 days)", note: "Sites whose end date falls in the last 30 days." },
  documentation: { title: "Documentation issues", note: "Work finished (end date entered) but DO, acknowledgement, submission to the customer or customer sign-off still missing." },
};
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };
const missingDocuments = (s: SiteRow) => {
  const missing: string[] = [];
  if (!s.doDate) missing.push("DO date");
  if (!s.acknowledgementDate) missing.push("acknowledgement");
  if (!s.submittedToCustomerDate) missing.push("submitted to customer");
  if (s.customerSignoff !== true) missing.push("customer sign-off");
  return missing;
};
const inMode = (s: SiteRow, mode: SiteBoardMode) =>
  mode === "all" ? true :
  mode === "ongoing" ? s.stage !== "closed" :
  mode === "completed" ? Boolean(s.endDate && s.endDate >= daysAgo(30) && s.endDate <= today()) :
  Boolean(s.endDate) && missingDocuments(s).length > 0;

/** `home` adds the stock shortage and reserved-stock tiles above the board (the Operations landing page). */
export function SiteExecution({ session, home = false, onOpenStock, mode = "all", initialSiteId }: { session: Session; home?: boolean; onOpenStock?: () => void; mode?: SiteBoardMode; initialSiteId?: string }) {
  const canEdit = ["Admin", "Management", "Operations"].includes(session.user.role);
  const [openedInitial, setOpenedInitial] = useState<string | undefined>(undefined);
  const [stockSummary, setStockSummary] = useState<StockSummary | null>(null);
  useEffect(() => {
    if (!home) return;
    let cancelled = false;
    api<{ items: { shortage: string; counted: boolean }[]; reservations: { executionId: string }[] }>("/site-execution/stock")
      .then((s) => {
        if (cancelled) return;
        setStockSummary({
          short: s.items.filter((i) => Number(i.shortage) > 0).length,
          uncounted: s.items.filter((i) => !i.counted).length,
          reserved: s.reservations.length,
          reservedSites: new Set(s.reservations.map((r) => r.executionId)).size,
        });
      })
      .catch(() => setStockSummary(null));
    return () => { cancelled = true; };
  }, [home]);
  const [data, setData] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [nextStage, setNextStage] = useState<string>("");
  const [stageNote, setStageNote] = useState("");
  const [newProblem, setNewProblem] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [vendorList, setVendorList] = useState<VendorRef[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [reserveQty, setReserveQty] = useState<Record<string, string>>({});
  const [assignForm, setAssignForm] = useState<Record<string, { vendorId: string; agreedDate: string; notes: string }>>({});

  const [cables, setCables] = useState<CableLine[] | null>(null);
  const [cableForm, setCableForm] = useState<Record<string, { usedQty: string; returnedQty: string; note: string }>>({});
  const [additionalItems, setAdditionalItems] = useState<AdditionalItem[]>([]);
  const [additionalForm, setAdditionalForm] = useState({ description: "", quantity: "", unit: "", reason: "" });

  const loadMaterials = useCallback(async (id: string) => {
    try { setMaterials(await api<Materials>(`/site-execution/${id}/materials`)); } catch { setMaterials(null); }
  }, []);
  const loadClosure = useCallback(async (id: string) => {
    try {
      const [c, a] = await Promise.all([api<{ cables: CableLine[] }>(`/site-execution/${id}/cables`), api<{ items: AdditionalItem[] }>(`/site-execution/${id}/additional-items`)]);
      setCables(c.cables); setAdditionalItems(a.items); setCableForm({});
    } catch { setCables(null); }
  }, []);
  const saveCable = useCallback(async (siteId: string, itemKey: string, f: { usedQty: string; returnedQty: string; note: string }) => {
    setBusy(true);
    try {
      const r = await api<{ cables: CableLine[] }>(`/site-execution/${siteId}/cables`, { body: { itemKey, usedQty: f.usedQty.trim(), returnedQty: f.returnedQty.trim() || "0", note: f.note.trim() }, csrf: session.csrfToken });
      setCables(r.cables); setCableForm((c) => { const n = { ...c }; delete n[itemKey]; return n; }); setNotice("Cable usage saved."); setError("");
      setDetail(await api<Detail>(`/site-execution/${siteId}`));
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not save cable usage."); setNotice(""); }
    finally { setBusy(false); }
  }, [session.csrfToken]);
  const addAdditional = useCallback(async (siteId: string) => {
    setBusy(true);
    try {
      const f = additionalForm;
      const r = await api<{ items: AdditionalItem[] }>(`/site-execution/${siteId}/additional-items`, { body: { itemKey: null, description: f.description.trim(), quantity: f.quantity.trim(), unit: f.unit.trim(), reason: f.reason.trim() }, csrf: session.csrfToken });
      setAdditionalItems(r.items); setAdditionalForm({ description: "", quantity: "", unit: "", reason: "" }); setNotice("Additional item recorded."); setError("");
      setDetail(await api<Detail>(`/site-execution/${siteId}`));
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not record the item."); setNotice(""); }
    finally { setBusy(false); }
  }, [additionalForm, session.csrfToken]);
  const withdrawAdditional = useCallback(async (siteId: string, itemId: string) => {
    setBusy(true);
    try {
      const r = await api<{ items: AdditionalItem[] }>(`/site-execution/${siteId}/additional-items/${itemId}/remove`, { body: { reason: "" }, csrf: session.csrfToken });
      setAdditionalItems(r.items); setNotice("Item withdrawn."); setError("");
      setDetail(await api<Detail>(`/site-execution/${siteId}`));
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not withdraw the item."); setNotice(""); }
    finally { setBusy(false); }
  }, [session.csrfToken]);
  const loadVendors = useCallback(async () => {
    try { const v = await api<{ vendors: VendorRef[]; categories: string[] }>("/site-execution/vendors"); setVendorList(v.vendors); setCategories(v.categories); } catch { /* read-only roles may still see the page */ }
  }, []);

  const load = useCallback(async () => {
    try { setData(await api<Overview>("/site-execution")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load sites."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // A site handed over from the dashboard opens once, then the page behaves normally.
  useEffect(() => {
    if (initialSiteId && initialSiteId !== openedInitial) { setOpenedInitial(initialSiteId); void open(initialSiteId); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSiteId]);

  const open = useCallback(async (id: string) => {
    try {
      const d = await api<Detail>(`/site-execution/${id}`);
      setDetail(d); setForm(toForm(d)); setNextStage(d.stage); setStageNote(""); setError(""); setNotice("");
      setMaterials(null); setCables(null); void loadMaterials(id); void loadVendors(); void loadClosure(id);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to open the site."); }
  }, [loadMaterials, loadVendors, loadClosure]);
  const reserve = useCallback(async (siteId: string, itemKey: string, quantity: string) => {
    setBusy(true);
    try {
      setMaterials(await api<Materials>(`/site-execution/${siteId}/reservations`, { body: { itemKey, quantity, note: "" }, csrf: session.csrfToken }));
      setReserveQty((q) => ({ ...q, [itemKey]: "" })); setNotice("Stock reserved."); setError("");
      setDetail(await api<Detail>(`/site-execution/${siteId}`)); void load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not reserve stock."); setNotice(""); }
    finally { setBusy(false); }
  }, [session.csrfToken, load]);
  const release = useCallback(async (siteId: string, reservationId: string) => {
    setBusy(true);
    try {
      setMaterials(await api<Materials>(`/site-execution/${siteId}/reservations/${reservationId}/release`, { body: { reason: "" }, csrf: session.csrfToken }));
      setNotice("Reservation released."); setError("");
      setDetail(await api<Detail>(`/site-execution/${siteId}`)); void load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not release the reservation."); setNotice(""); }
    finally { setBusy(false); }
  }, [session.csrfToken, load]);
  const apply = useCallback((d: Detail, message: string, resetForm: boolean) => {
    setDetail(d); setNextStage(d.stage); setNotice(message); setError("");
    if (resetForm) setForm(toForm(d));
    void load();
  }, [load]);
  /** Picture checks and problems refresh the record without discarding unsaved detail edits. */
  const post = useCallback(async (path: string, body: unknown, message: string, resetForm = true) => {
    setBusy(true);
    try { apply(await api<Detail>(path, { body, csrf: session.csrfToken }), message, resetForm); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The change could not be saved."); setNotice(""); }
    finally { setBusy(false); }
  }, [apply, session.csrfToken]);

  const scoped = useMemo(() => (data ? data.sites.filter((s) => inMode(s, mode)) : []), [data, mode]);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return scoped.filter((s) =>
      (!stageFilter || s.stage === stageFilter) &&
      (!regionFilter || (s.region ?? "") === regionFilter) &&
      (!q || [s.siteName, s.siteCode, s.customer, s.ipoNumber, s.boqNumber].some((v) => (v ?? "").toLowerCase().includes(q))));
  }, [data, scoped, stageFilter, regionFilter, search]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of scoped) c[s.stage] = (c[s.stage] ?? 0) + 1;
    return c;
  }, [scoped]);
  const stageTiles = useMemo(() => (data ? data.stages.filter((s) => mode !== "ongoing" || s.key !== "closed") : []), [data, mode]);

  if (!data) return <section className="pz-panel"><p>{error || "Loading sites…"}</p></section>;

  if (detail && form) {
    const changed: Record<string, unknown> = {};
    const base = toForm(detail);
    for (const key of Object.keys(form) as (keyof FormState)[]) {
      if (form[key] === base[key]) continue;
      const v = form[key];
      if (key === "customerSignoff") changed[key] = v === "" ? null : v === "yes";
      else if (typeof v === "boolean") changed[key] = v;
      else changed[key] = v === "" ? null : v;
    }
    const isUps = form.siteType === "UPS";
    const days = dayList(detail.startDate, detail.endDate);
    const checks = new Map(detail.photoChecks.map((c) => [c.date, c.pictures]));
    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value });
    return (
      <div className="pz-stack">
        <div className="pz-action-row">
          <Button variant="secondary" onClick={() => { setDetail(null); setForm(null); }}>← All sites</Button>
          {notice && <span className="pz-feedback pz-feedback--success" role="status">{notice}</span>}
          {error && <span className="pz-feedback pz-feedback--danger" role="alert">{error}</span>}
        </div>
        <section className="pz-panel pz-stack">
          <h2>{detail.siteName ?? "Site"} {detail.siteCode ? `(${detail.siteCode})` : ""}</h2>
          <p>{detail.customer ?? "—"} · IPO {detail.ipoNumber} · BOQ {detail.boqNumber} · PO date {fmt(detail.poDate)}</p>
          <div className="pz-action-row">
            <StatusBadge tone={stageTone(detail)}>{detail.stageLabel}</StatusBadge>
            <span>{detail.daysInStage} day{detail.daysInStage === 1 ? "" : "s"} in stage{detail.late ? ` · late (over ${data.lateAfterDays} days)` : ""}</span>
          </div>
          {canEdit && (
            <div className="pz-form-grid">
              <Field id="se-stage" label="Move to stage">
                <select id="se-stage" value={nextStage} onChange={(e) => setNextStage(e.target.value)}>
                  {data.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>
              <Field id="se-stage-note" label="Note" hint="Optional. Kept in the site history.">
                <input id="se-stage-note" value={stageNote} maxLength={500} onChange={(e) => setStageNote(e.target.value)} />
              </Field>
              <div className="pz-action-row">
                <Button variant="primary" loading={busy} disabled={nextStage === detail.stage}
                  onClick={() => void post(`/site-execution/${detail.id}/stage`, { stage: nextStage, note: stageNote }, "Stage updated.")}>
                  Move stage
                </Button>
              </div>
            </div>
          )}
        </section>

        {detail.headsUp && (
          <section className="pz-panel pz-stack">
            <h3>Heads-up BOQ</h3>
            <p>{detail.headsUp.source} {detail.headsUp.number} · {detail.headsUp.mode} · {detail.headsUp.items} items
              {detail.headsUp.expectedDate ? ` · expected ${fmt(detail.headsUp.expectedDate)}` : ""}</p>
            {detail.headsUp.notes && <p>{detail.headsUp.notes}</p>}
          </section>
        )}

        <section className="pz-panel pz-stack">
          <h3>Site details</h3>
          <div className="pz-form-grid">
            <Field id="se-type" label="Site type" hint={isUps ? "UPS sites have no monitoring app or 4G device." : undefined}>
              <select id="se-type" disabled={!canEdit} value={form.siteType} onChange={(e) => set("siteType", e.target.value)}>
                <option value="">—</option>
                {data.siteTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field id="se-region" label="Region">
              <select id="se-region" disabled={!canEdit} value={form.region} onChange={(e) => set("region", e.target.value)}>
                <option value="">—</option>
                {data.regions.map((t) => <option key={t} value={t}>{t}</option>)}
                {form.region && !data.regions.includes(form.region) && <option value={form.region}>{form.region}</option>}
              </select>
            </Field>
            <Field id="se-del-plan" label="Material delivery date (planned)">
              <input id="se-del-plan" type="date" disabled={!canEdit} value={form.materialDeliveryPlanned} onChange={(e) => set("materialDeliveryPlanned", e.target.value)} />
            </Field>
            <Field id="se-del-act" label="Material delivery date (actual)">
              <input id="se-del-act" type="date" disabled={!canEdit} value={form.materialDeliveryActual} onChange={(e) => set("materialDeliveryActual", e.target.value)} />
            </Field>
            <Field id="se-start" label="Start date">
              <input id="se-start" type="date" disabled={!canEdit} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <Field id="se-end" label="End date">
              <input id="se-end" type="date" disabled={!canEdit} value={form.endDate} min={form.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} />
            </Field>
            {!isUps && (
              <Field id="se-matri" label="Matri cloud (monitoring app)">
                <select id="se-matri" disabled={!canEdit} value={form.matriCloudStatus} onChange={(e) => set("matriCloudStatus", e.target.value)}>
                  <option value="">—</option>
                  {data.connectionStatuses.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            )}
            {!isUps && (
              <Field id="se-4g" label="4G device">
                <select id="se-4g" disabled={!canEdit} value={form.fourGStatus} onChange={(e) => set("fourGStatus", e.target.value)}>
                  <option value="">—</option>
                  {data.connectionStatuses.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            )}
            <Field id="se-signoff" label="Customer sign-off">
              <select id="se-signoff" disabled={!canEdit} value={form.customerSignoff} onChange={(e) => set("customerSignoff", e.target.value)}>
                <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            </Field>
          </div>
          <h3>Documents and payment</h3>
          <div className="pz-form-grid">
            <Field id="se-do" label="DO date" hint="Advance 50% is claimed on delivery.">
              <input id="se-do" type="date" disabled={!canEdit} value={form.doDate} onChange={(e) => set("doDate", e.target.value)} />
            </Field>
            <Field id="se-ack" label="Acknowledgement signed" hint="Final 50% is claimed on the branch manager's acknowledgement.">
              <input id="se-ack" type="date" disabled={!canEdit} value={form.acknowledgementDate} onChange={(e) => set("acknowledgementDate", e.target.value)} />
            </Field>
            <Field id="se-sub" label="Submitted to customer">
              <input id="se-sub" type="date" disabled={!canEdit} value={form.submittedToCustomerDate} onChange={(e) => set("submittedToCustomerDate", e.target.value)} />
            </Field>
            <Field id="se-adv" label="Advance claimed">
              <select id="se-adv" disabled={!canEdit} value={form.advanceClaimed ? "yes" : "no"} onChange={(e) => set("advanceClaimed", e.target.value === "yes")}>
                <option value="no">No</option><option value="yes">Yes</option>
              </select>
            </Field>
            <Field id="se-fin" label="Final claimed">
              <select id="se-fin" disabled={!canEdit} value={form.finalClaimed ? "yes" : "no"} onChange={(e) => set("finalClaimed", e.target.value === "yes")}>
                <option value="no">No</option><option value="yes">Yes</option>
              </select>
            </Field>
            <Field id="se-docnote" label="Additional documents / notes">
              <input id="se-docnote" disabled={!canEdit} value={form.documentsNote} maxLength={2000} onChange={(e) => set("documentsNote", e.target.value)} />
            </Field>
          </div>
          {canEdit && (
            <div className="pz-action-row">
              <Button variant="primary" loading={busy} disabled={!Object.keys(changed).length}
                onClick={() => void post(`/site-execution/${detail.id}/fields`, changed, "Site details saved.")}>
                Save details
              </Button>
              {Object.keys(changed).length > 0 && <span>{Object.keys(changed).length} unsaved change{Object.keys(changed).length === 1 ? "" : "s"}</span>}
            </div>
          )}
        </section>

        <section className="pz-panel pz-stack">
          <h3>Vendors for this site</h3>
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Category</th><th>Vendor</th><th>Agreed date</th><th>Notes</th>{canEdit && <th></th>}</tr></thead>
              <tbody>
                {categories.map((cat) => {
                  const current = detail.vendors.find((v) => v.category === cat);
                  const f = assignForm[cat] ?? { vendorId: "", agreedDate: "", notes: "" };
                  const options = vendorList.filter((v) => v.category === cat && v.status === "Active");
                  return (
                    <tr key={cat}>
                      <td>{cat}</td>
                      {current ? (
                        <>
                          <td><strong>{current.vendorName}</strong>{(current.contactPerson || current.phone) && <><br /><small>{[current.contactPerson, current.phone].filter(Boolean).join(" · ")}</small></>}</td>
                          <td>{fmt(current.agreedDate)}</td>
                          <td>{current.notes || "—"}<br /><small>{current.assignedBy} · {fmtAt(current.assignedAt)}</small></td>
                          {canEdit && <td><Button variant="secondary" loading={busy} onClick={() => void post(`/site-execution/${detail.id}/vendors/${current.id}/remove`, {}, `${cat} vendor removed.`, false)}>Remove</Button></td>}
                        </>
                      ) : canEdit ? (
                        <>
                          <td>
                            <select aria-label={`${cat} vendor`} value={f.vendorId} onChange={(e) => setAssignForm({ ...assignForm, [cat]: { ...f, vendorId: e.target.value } })}>
                              <option value="">—</option>
                              {options.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                            {options.length === 0 && <><br /><small>No active {cat.toLowerCase()} vendor yet. Add one under Stock &amp; procurement.</small></>}
                          </td>
                          <td><input aria-label={`${cat} agreed date`} type="date" value={f.agreedDate} onChange={(e) => setAssignForm({ ...assignForm, [cat]: { ...f, agreedDate: e.target.value } })} /></td>
                          <td><input aria-label={`${cat} notes`} value={f.notes} maxLength={500} onChange={(e) => setAssignForm({ ...assignForm, [cat]: { ...f, notes: e.target.value } })} /></td>
                          <td>
                            <Button variant="secondary" loading={busy} disabled={!f.vendorId}
                              onClick={() => void post(`/site-execution/${detail.id}/vendors`, { category: cat, vendorId: f.vendorId, agreedDate: f.agreedDate || null, notes: f.notes }, `${cat} vendor assigned.`, false)}>
                              Assign
                            </Button>
                          </td>
                        </>
                      ) : (
                        <><td>—</td><td>—</td><td>—</td></>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="pz-panel pz-stack">
          <h3>Material plan</h3>
          {!materials ? <p>Loading materials…</p> : materials.lines.length === 0 ? <p>No BOQ lines for this site.</p> : (
            <div className="pz-table-scroll">
              <table className="pz-table">
                <thead><tr><th>Item</th><th>BOQ qty</th><th>Reserved for this site</th><th>Still needed</th><th>In stock (available of existing)</th>{canEdit && <th>Reserve</th>}</tr></thead>
                <tbody>
                  {materials.lines.map((l) => (
                    <tr key={l.lineNumber}>
                      <td><strong>{l.name}</strong><br /><small>{l.brand}{l.specification ? ` · ${l.specification}` : ""}</small></td>
                      <td>{l.boqQty} {l.unit}</td>
                      <td>{l.reserved}</td>
                      <td>{Number(l.outstanding) > 0 ? <StatusBadge tone="warning">{l.outstanding}</StatusBadge> : <StatusBadge tone="success">0</StatusBadge>}</td>
                      <td>{l.existing == null ? <StatusBadge tone="warning">No count</StatusBadge> : `${l.available} of ${l.existing}`}</td>
                      {canEdit && (
                        <td>
                          <div className="pz-action-row">
                            <input aria-label={`Reserve ${l.name}`} style={{ width: "6rem" }} value={reserveQty[l.itemKey] ?? ""} placeholder={l.outstanding}
                              onChange={(e) => setReserveQty({ ...reserveQty, [l.itemKey]: e.target.value })} />
                            <Button variant="secondary" loading={busy} disabled={!(reserveQty[l.itemKey] ?? "").trim()} onClick={() => void reserve(detail.id, l.itemKey, (reserveQty[l.itemKey] ?? "").trim())}>Reserve</Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {materials && materials.reservations.some((r) => !r.releasedAt) && (
            <ul>
              {materials.reservations.filter((r) => !r.releasedAt).map((r) => (
                <li key={r.id} className="pz-action-row">
                  <span>{r.quantity} × {materials.lines.find((l) => l.itemKey === r.itemKey)?.name ?? r.itemKey} · {r.reservedBy} · {fmtAt(r.reservedAt)}{r.note ? ` · ${r.note}` : ""}</span>
                  {canEdit && <Button variant="neutral" loading={busy} onClick={() => void release(detail.id, r.id)}>Release</Button>}
                </li>
              ))}
            </ul>
          )}
          <p><small>Shortages across all sites and requests for quotation are under Stock &amp; procurement.</small></p>
        </section>

        <section className="pz-panel pz-stack">
          <h3>Pictures by day</h3>
          {!detail.startDate ? (
            <p>Enter the start date to list the days.</p>
          ) : (
            <div className="pz-table-scroll">
              <table className="pz-table">
                <thead><tr><th>Date</th><th>Pictures for this date</th></tr></thead>
                <tbody>
                  {days.map((d) => {
                    const v = checks.get(d);
                    return (
                      <tr key={d}>
                        <td>{fmt(d)}</td>
                        <td>
                          <label>
                            <input type="checkbox" disabled={!canEdit || busy} checked={v === true}
                              onChange={(e) => void post(`/site-execution/${detail.id}/photo-checks`, { date: d, pictures: e.target.checked }, `Pictures for ${fmt(d)} recorded.`, false)} />
                            {" "}{v === true ? "Yes" : v === false ? "No" : "Not recorded"}
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {detail.missingPictureDays > 0 && <StatusBadge tone="warning">{detail.missingPictureDays} day{detail.missingPictureDays === 1 ? "" : "s"} without pictures</StatusBadge>}
        </section>

        <section className="pz-panel pz-stack">
          <h3>Problems</h3>
          {canEdit && (
            <div className="pz-form-grid">
              <Field id="se-problem" label="New problem" hint="Free text. What happened, in your words.">
                <textarea id="se-problem" rows={2} maxLength={2000} value={newProblem} onChange={(e) => setNewProblem(e.target.value)} />
              </Field>
              <div className="pz-action-row">
                <Button variant="secondary" loading={busy} disabled={!newProblem.trim()}
                  onClick={() => { const text = newProblem.trim(); setNewProblem(""); void post(`/site-execution/${detail.id}/problems`, { problem: text }, "Problem recorded.", false); }}>
                  Add problem
                </Button>
              </div>
            </div>
          )}
          {detail.problems.length === 0 ? <p>No problems recorded.</p> : (
            <ul className="pz-stack">
              {detail.problems.map((p) => (
                <li key={p.id} className="pz-stack">
                  <div className="pz-action-row">
                    <StatusBadge tone={p.status === "Open" ? "warning" : "success"}>{p.status}</StatusBadge>
                    <span>{p.createdBy} · {fmtAt(p.createdAt)}</span>
                  </div>
                  <p>{p.problem}</p>
                  {p.status === "Resolved" ? (
                    <p>Resolved by {p.resolvedBy} · {p.resolvedAt ? fmtAt(p.resolvedAt) : ""}{p.resolution ? ` · ${p.resolution}` : ""}</p>
                  ) : canEdit && (
                    <div className="pz-action-row">
                      <input placeholder="How it was resolved (optional)" value={resolutions[p.id] ?? ""} maxLength={2000}
                        onChange={(e) => setResolutions({ ...resolutions, [p.id]: e.target.value })} />
                      <Button variant="success" loading={busy}
                        onClick={() => void post(`/site-execution/${detail.id}/problems/${p.id}/resolve`, { resolution: resolutions[p.id] ?? "" }, "Problem resolved.", false)}>
                        Mark resolved
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pz-panel pz-stack">
          <h3>Cables used against the BOQ</h3>
          <p><small>Every difference is flagged: extra cable used is invoiced to the customer, cable charged but not used is refunded.</small></p>
          {!cables ? <p>Loading cables…</p> : cables.length === 0 ? <p>No cable lines on this site's BOQ.</p> : (
            <div className="pz-table-scroll">
              <table className="pz-table">
                <thead><tr><th>Cable</th><th>BOQ</th><th>Sent to Store</th><th>Used</th><th>Returned</th><th>Variance</th>{canEdit && <th>Note</th>}{canEdit && <th></th>}</tr></thead>
                <tbody>
                  {cables.map((l) => {
                    const f = cableForm[l.itemKey] ?? { usedQty: l.usedQty ?? "", returnedQty: l.returnedQty ?? "0", note: l.note ?? "" };
                    const dirty = f.usedQty !== (l.usedQty ?? "") || f.returnedQty !== (l.returnedQty ?? "0") || f.note !== (l.note ?? "");
                    return (
                      <tr key={l.itemKey}>
                        <td><strong>{l.name}</strong><br /><small>{l.unit}</small></td>
                        <td>{l.boqQty}</td>
                        <td>{l.issuedQty ?? "—"}</td>
                        <td>{canEdit ? <input aria-label={`Used ${l.name}`} style={{ width: "6rem" }} value={f.usedQty} onChange={(e) => setCableForm({ ...cableForm, [l.itemKey]: { ...f, usedQty: e.target.value } })} /> : (l.usedQty ?? "—")}</td>
                        <td>{canEdit ? <input aria-label={`Returned ${l.name}`} style={{ width: "6rem" }} value={f.returnedQty} onChange={(e) => setCableForm({ ...cableForm, [l.itemKey]: { ...f, returnedQty: e.target.value } })} /> : l.returnedQty}</td>
                        <td>{l.variance == null ? <small>Not entered</small> : <><StatusBadge tone={l.flagged ? "danger" : "success"}>{Number(l.variance) > 0 ? `+${l.variance}` : l.variance}</StatusBadge><br /><small>{l.direction}</small></>}</td>
                        {canEdit && <td><input aria-label={`Note ${l.name}`} value={f.note} maxLength={500} onChange={(e) => setCableForm({ ...cableForm, [l.itemKey]: { ...f, note: e.target.value } })} /></td>}
                        {canEdit && <td><Button variant="secondary" loading={busy} disabled={!dirty || !f.usedQty.trim()} onClick={() => void saveCable(detail.id, l.itemKey, f)}>Save</Button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="pz-panel pz-stack">
          <h3>Additional items used outside the quotation</h3>
          {canEdit && (
            <div className="pz-form-grid">
              <Field id="ai-desc" label="Item or description"><input id="ai-desc" value={additionalForm.description} maxLength={500} onChange={(e) => setAdditionalForm({ ...additionalForm, description: e.target.value })} /></Field>
              <Field id="ai-qty" label="Quantity"><input id="ai-qty" value={additionalForm.quantity} onChange={(e) => setAdditionalForm({ ...additionalForm, quantity: e.target.value })} /></Field>
              <Field id="ai-unit" label="Unit"><input id="ai-unit" value={additionalForm.unit} maxLength={50} onChange={(e) => setAdditionalForm({ ...additionalForm, unit: e.target.value })} /></Field>
              <Field id="ai-reason" label="Reason" hint="Why it was needed. Accounts sees this."><input id="ai-reason" value={additionalForm.reason} maxLength={1000} onChange={(e) => setAdditionalForm({ ...additionalForm, reason: e.target.value })} /></Field>
              <div className="pz-action-row">
                <Button variant="secondary" loading={busy} disabled={!additionalForm.description.trim() || !additionalForm.quantity.trim()} onClick={() => void addAdditional(detail.id)}>Record item</Button>
              </div>
            </div>
          )}
          {additionalItems.length === 0 ? <p>No additional items recorded.</p> : (
            <ul className="pz-stack">
              {additionalItems.map((a) => (
                <li key={a.id} className="pz-action-row">
                  <span style={a.removedAt ? { textDecoration: "line-through" } : undefined}>{a.quantity} {a.unit} · {a.description}{a.reason ? ` · ${a.reason}` : ""} · {a.createdBy} · {fmtAt(a.createdAt)}</span>
                  {a.removedAt ? <small>Withdrawn by {a.removedBy}{a.removalReason ? ` · ${a.removalReason}` : ""}</small> : canEdit && <Button variant="neutral" loading={busy} onClick={() => void withdrawAdditional(detail.id, a.id)}>Withdraw</Button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pz-panel pz-stack">
          <h3>History</h3>
          {detail.events.length === 0 ? <p>No changes yet.</p> : (
            <ul>
              {detail.events.map((e, i) => (
                <li key={i}>
                  {fmtAt(e.at)} · {e.actor} · {
                    e.kind === "stage_change" ? `Stage ${e.fromStage ?? "—"} → ${e.toStage}` :
                    e.kind === "field_update" ? `Updated ${Object.keys(e.changes).join(", ")}` :
                    e.kind === "photo_check" ? `Pictures for ${fmt(e.changes.date)}: ${e.changes.pictures ? "yes" : "no"}` :
                    e.kind === "problem_added" ? "Problem added" :
                    e.kind === "problem_resolved" ? "Problem resolved" :
                    e.kind === "reservation" ? `Reserved ${e.changes.quantity} of ${e.changes.itemKey}` :
                    e.kind === "reservation_released" ? `Released ${e.changes.quantity} of ${e.changes.itemKey}` :
                    e.kind === "vendor_assigned" ? `${e.changes.category} vendor: ${e.changes.vendor}` :
                    e.kind === "vendor_removed" ? `${e.changes.category} vendor removed` :
                    e.kind === "procurement" ? `Procurement ${e.changes.status ?? ""}` :
                    e.kind === "cable_usage" ? `Cable ${e.changes.itemKey}: used ${e.changes.usedQty}, returned ${e.changes.returnedQty}` :
                    e.kind === "additional_item" ? `Additional item: ${e.changes.quantity} ${e.changes.unit ?? ""} ${e.changes.description}` :
                    e.kind === "additional_item_removed" ? `Additional item withdrawn: ${e.changes.description}` : e.kind
                  }{e.note ? ` · ${e.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="pz-stack">
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      {home && (
        <section className="pz-panel pz-stack">
          <h3>Stock</h3>
          <div className="stage-grid">
            <button type="button" className="stage-card" onClick={onOpenStock}>
              <strong>{stockSummary ? stockSummary.short : "…"}</strong><span>Items with a stock shortage</span>
            </button>
            <button type="button" className="stage-card" onClick={onOpenStock}>
              <strong>{stockSummary ? stockSummary.reserved : "…"}</strong><span>Reservations{stockSummary?.reservedSites ? ` across ${stockSummary.reservedSites} site${stockSummary.reservedSites === 1 ? "" : "s"}` : ""}</span>
            </button>
            <button type="button" className="stage-card" onClick={onOpenStock}>
              <strong>{stockSummary ? stockSummary.uncounted : "…"}</strong><span>Items Store has not counted</span>
            </button>
          </div>
          <p><small>Open Stock &amp; procurement for the full shortage list, counts, vendors and requests for quotation.</small></p>
        </section>
      )}
      <section className="pz-panel pz-stack">
        <h2>{MODE_TEXT[mode].title}</h2>
        <p><small>{MODE_TEXT[mode].note}</small></p>
        {(mode === "all" || mode === "ongoing") && (
          <div className="stage-grid">
            <button type="button" className={`stage-card${stageFilter === "" ? " active" : ""}`} onClick={() => setStageFilter("")}>
              <strong>{scoped.length}</strong><span>{MODE_TEXT[mode].title}</span>
            </button>
            {stageTiles.map((s) => (
              <button type="button" key={s.key} className={`stage-card${stageFilter === s.key ? " active" : ""}`} onClick={() => setStageFilter(s.key)}>
                <strong>{counts[s.key] ?? 0}</strong><span>{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="pz-panel pz-stack">
        <div className="pz-form-grid">
          <Field id="se-search" label="Search">
            <input id="se-search" placeholder="Site, customer, IPO or BOQ number" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field id="se-region-filter" label="Region">
            <select id="se-region-filter" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
              <option value="">All regions</option>
              {data.regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        <div className="pz-table-scroll">
          <table className="pz-table">
            <thead>
              <tr>
                <th>Site</th><th>Customer</th><th>Region</th><th>Type</th><th>Stage</th><th>Days</th>
                <th>PO date</th><th>Delivery</th><th>Start</th><th>End</th><th>Problems</th><th>Missing pictures</th>
                {mode === "documentation" && <th>Missing documents</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={mode === "documentation" ? 13 : 12}>{mode === "documentation" ? "No documentation issues." : mode === "completed" ? "No sites completed in the last 30 days." : "No sites match."}</td></tr>
              ) : rows.map((s) => (
                <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => void open(s.id)}>
                  <td><strong>{s.siteName ?? "—"}</strong>{s.siteCode ? ` (${s.siteCode})` : ""}<br /><small>IPO {s.ipoNumber}</small></td>
                  <td>{s.customer ?? "—"}</td>
                  <td>{s.region ?? "—"}</td>
                  <td>{s.siteType ?? "—"}</td>
                  <td><StatusBadge tone={stageTone(s)}>{s.stageLabel}</StatusBadge></td>
                  <td>{s.daysInStage}{s.late ? " · late" : ""}</td>
                  <td>{fmt(s.poDate)}</td>
                  <td>{fmt(s.materialDeliveryActual ?? s.materialDeliveryPlanned)}</td>
                  <td>{fmt(s.startDate)}</td>
                  <td>{fmt(s.endDate)}</td>
                  <td>{s.openProblems || "—"}</td>
                  <td>{s.missingPictureDays || "—"}</td>
                  {mode === "documentation" && <td>{missingDocuments(s).map((m) => <StatusBadge key={m} tone="warning">{m}</StatusBadge>)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p><small>Late means more than {data.lateAfterDays} days in the same stage. Click a row to open the site.</small></p>
      </section>
    </div>
  );
}
