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
}
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

export function SiteExecution({ session }: { session: Session }) {
  const canEdit = ["Admin", "Management", "Operations"].includes(session.user.role);
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

  const load = useCallback(async () => {
    try { setData(await api<Overview>("/site-execution")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load sites."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = useCallback(async (id: string) => {
    try {
      const d = await api<Detail>(`/site-execution/${id}`);
      setDetail(d); setForm(toForm(d)); setNextStage(d.stage); setStageNote(""); setError(""); setNotice("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to open the site."); }
  }, []);
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

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.sites.filter((s) =>
      (!stageFilter || s.stage === stageFilter) &&
      (!regionFilter || (s.region ?? "") === regionFilter) &&
      (!q || [s.siteName, s.siteCode, s.customer, s.ipoNumber, s.boqNumber].some((v) => (v ?? "").toLowerCase().includes(q))));
  }, [data, stageFilter, regionFilter, search]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of data?.sites ?? []) c[s.stage] = (c[s.stage] ?? 0) + 1;
    return c;
  }, [data]);

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
          <h3>History</h3>
          {detail.events.length === 0 ? <p>No changes yet.</p> : (
            <ul>
              {detail.events.map((e, i) => (
                <li key={i}>
                  {fmtAt(e.at)} · {e.actor} · {
                    e.kind === "stage_change" ? `Stage ${e.fromStage ?? "—"} → ${e.toStage}` :
                    e.kind === "field_update" ? `Updated ${Object.keys(e.changes).join(", ")}` :
                    e.kind === "photo_check" ? `Pictures for ${fmt(e.changes.date)}: ${e.changes.pictures ? "yes" : "no"}` :
                    e.kind === "problem_added" ? "Problem added" : "Problem resolved"
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
      <section className="pz-panel">
        <div className="stage-grid">
          <button type="button" className={`stage-card${stageFilter === "" ? " active" : ""}`} onClick={() => setStageFilter("")}>
            <strong>{data.sites.length}</strong><span>All sites</span>
          </button>
          {data.stages.map((s) => (
            <button type="button" key={s.key} className={`stage-card${stageFilter === s.key ? " active" : ""}`} onClick={() => setStageFilter(s.key)}>
              <strong>{counts[s.key] ?? 0}</strong><span>{s.label}</span>
            </button>
          ))}
        </div>
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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={12}>No sites match.</td></tr>
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
