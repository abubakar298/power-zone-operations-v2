import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../api.js";
import "./operations-dashboard.css";

interface SiteRow {
  id: string; siteName: string | null; siteCode: string | null; customer: string | null; region: string | null; stage: string; stageLabel: string;
  daysInStage: number; late: boolean; endDate: string | null; doDate: string | null; acknowledgementDate: string | null; submittedToCustomerDate: string | null;
  customerSignoff: boolean | null; openProblems: number; missingPictureDays: number; materialDeliveryPlanned: string | null; startDate: string | null;
}
interface StockItem { itemKey: string; name: string; unit: string; required: string; existing: string | null; shortage: string; counted: boolean }
interface Reservation { executionId: string }
interface Advance { record_id: string; number: string; mode: string; confirmed_issuance_id: string | null; updated_at: string; customer_name?: string; site_name?: string; site_code?: string; snapshot?: { headsupGroup?: string; expectedDate?: string } }

export type DashboardTarget = "operations" | "sites-ongoing" | "sites-completed" | "sites-docs" | "sites" | "reserved" | "stock" | "reports";

const isoDay = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const shift = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
const fmt = (v: string | null | undefined) => (v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(v.length === 10 ? `${v}T00:00:00` : v)) : "—");
const relDay = (v: string) => { const t = isoDay(new Date()); return v === t ? "today" : v === shift(1) ? "tomorrow" : v < t ? `${Math.round((new Date(t).getTime() - new Date(v).getTime()) / 86_400_000)} days ago` : fmt(v); };
const missingDocs = (s: SiteRow) => {
  const out: string[] = [];
  if (!s.doDate) out.push("DO");
  if (!s.acknowledgementDate) out.push("acknowledgement");
  if (!s.submittedToCustomerDate) out.push("submitted");
  if (s.customerSignoff !== true) out.push("sign-off");
  return out;
};
const STAGE_COLOURS = ["#c4b5fd", "#a89af0", "#8c7fe6", "#7861dc", "#6658e8", "#5547d0", "#e5a33d", "#2f7d55", "#246443"];
const stageInk = (i: number) => (i < 3 ? "#1d1b2e" : "#fff");

/** Operations home: where every site, problem and stock item stands today. */
export function OperationsDashboard({ session, onGo, onOpenSite, onOpenStage }: {
  session: Session; onGo: (target: DashboardTarget) => void; onOpenSite: (siteId: string) => void; onOpenStage: (stage: string) => void;
}) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [stages, setStages] = useState<{ key: string; label: string }[]>([]);
  const [lateAfterDays, setLateAfterDays] = useState(2);
  const [stock, setStock] = useState<{ items: StockItem[]; reservations: Reservation[] } | null>(null);
  const [advance, setAdvance] = useState<Advance[] | null>(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, st, a] = await Promise.all([
        api<{ sites: SiteRow[]; stages: { key: string; label: string }[]; lateAfterDays: number }>("/site-execution"),
        api<{ items: StockItem[]; reservations: Reservation[] }>("/site-execution/stock"),
        api<{ requests: Advance[] }>("/project-workflow/advance-inbox").catch(() => ({ requests: [] as Advance[] })),
      ]);
      setSites(s.sites); setStages(s.stages); setLateAfterDays(s.lateAfterDays); setStock(st); setAdvance(a.requests); setError(""); setLoadedAt(new Date());
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load the dashboard."); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);

  const today = isoDay(new Date());
  const m = useMemo(() => {
    const ongoing = sites.filter((s) => s.stage !== "closed");
    const late = ongoing.filter((s) => s.late);
    const completed = sites.filter((s) => s.endDate && s.endDate >= shift(-30) && s.endDate <= today).sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
    const docs = sites.filter((s) => Boolean(s.endDate) && missingDocs(s).length > 0);
    const problems = ongoing.reduce((n, s) => n + s.openProblems, 0);
    const pictures = ongoing.reduce((n, s) => n + s.missingPictureDays, 0);
    const deliveries = ongoing.filter((s) => s.materialDeliveryPlanned && s.materialDeliveryPlanned >= today && s.materialDeliveryPlanned <= shift(7)).sort((a, b) => a.materialDeliveryPlanned!.localeCompare(b.materialDeliveryPlanned!));
    const starts = ongoing.filter((s) => s.startDate && s.startDate >= today && s.startDate <= shift(7));
    const attention = [...ongoing].filter((s) => s.late || s.openProblems > 0 || s.missingPictureDays > 0)
      .sort((a, b) => Number(b.late) - Number(a.late) || b.openProblems - a.openProblems || b.missingPictureDays - a.missingPictureDays || b.daysInStage - a.daysInStage).slice(0, 8);
    const byStage = new Map<string, number>();
    for (const s of sites) byStage.set(s.stage, (byStage.get(s.stage) ?? 0) + 1);
    const shortages = (stock?.items ?? []).filter((i) => Number(i.shortage) > 0).sort((a, b) => Number(b.shortage) - Number(a.shortage)).slice(0, 5);
    const awaiting = (advance ?? []).filter((a) => !a.confirmed_issuance_id);
    const posSoon = awaiting.filter((a) => a.snapshot?.expectedDate && a.snapshot.expectedDate >= today && a.snapshot.expectedDate <= shift(7));
    const latestAdvance = [...(advance ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
    return {
      ongoing, late, completed, docs, problems, pictures, deliveries, starts, attention, byStage, shortages, awaiting, posSoon, latestAdvance,
      short: stock ? stock.items.filter((i) => Number(i.shortage) > 0).length : null,
      uncounted: stock ? stock.items.filter((i) => !i.counted).length : null,
      reservations: stock ? stock.reservations.length : null,
      reservedSites: stock ? new Set(stock.reservations.map((r) => r.executionId)).size : 0,
    };
  }, [sites, stock, advance, today]);
  const pipelineTotal = sites.length;
  const ready = loadedAt !== null;
  const n = (v: number | null) => (ready && v !== null ? v : "…");

  return (
    <div className="od">
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}

      <section className="od-kpis" aria-label="Key figures">
        <button type="button" className="od-kpi" onClick={() => onGo("sites-ongoing")}>
          <strong>{n(m.ongoing.length)}</strong><span>Ongoing sites</span><small>{m.completed.length} completed in the last 30 days</small>
        </button>
        <button type="button" className={`od-kpi${m.late.length ? " od-kpi--danger" : " od-kpi--ok"}`} onClick={() => onGo("sites-ongoing")}>
          <strong>{n(m.late.length)}</strong><span>Late sites</span><small>more than {lateAfterDays} days in one stage</small>
        </button>
        <button type="button" className={`od-kpi${m.problems ? " od-kpi--danger" : " od-kpi--ok"}`} onClick={() => onGo("sites-ongoing")}>
          <strong>{n(m.problems)}</strong><span>Open problems</span><small>{m.pictures} day{m.pictures === 1 ? "" : "s"} without pictures</small>
        </button>
        <button type="button" className={`od-kpi${m.short ? " od-kpi--danger" : " od-kpi--ok"}`} onClick={() => onGo("stock")}>
          <strong>{n(m.short)}</strong><span>Stock shortages</span><small>{m.uncounted ?? "…"} item{m.uncounted === 1 ? "" : "s"} not counted by Store</small>
        </button>
      </section>

      <section className="pz-panel pz-stack">
        <div className="od-head"><h2>Site pipeline</h2><small>{pipelineTotal} site{pipelineTotal === 1 ? "" : "s"} · click a stage to open it</small></div>
        {pipelineTotal === 0 ? <p className="od-empty">No sites yet. A site appears here when its IPO is issued to Operations.</p> : (
          <>
            <div className="od-pipeline" role="group" aria-label="Sites by stage">
              {stages.map((s, i) => {
                const count = m.byStage.get(s.key) ?? 0;
                if (!count) return null;
                return (
                  <button type="button" key={s.key} className="od-seg" style={{ flex: `${count} 1 0`, background: STAGE_COLOURS[i % STAGE_COLOURS.length], color: stageInk(i) }}
                    title={`${s.label}: ${count}`} aria-label={`${s.label}: ${count}`} onClick={() => onOpenStage(s.key)}>
                    {count}
                  </button>
                );
              })}
            </div>
            <div className="od-legend">
              {stages.map((s, i) => (
                <button type="button" key={s.key} onClick={() => onOpenStage(s.key)}>
                  <i className="od-dot" style={{ background: STAGE_COLOURS[i % STAGE_COLOURS.length] }} />{s.label} · {m.byStage.get(s.key) ?? 0}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="od-columns">
        <section className="pz-panel pz-stack">
          <div className="od-head"><h2>Needs attention</h2><button type="button" className="od-link" onClick={() => onGo("sites-ongoing")}>All ongoing</button></div>
          {m.attention.length === 0 ? <p className="od-empty">Nothing is late, no open problems, no missing pictures.</p> : (
            <div className="od-list">
              {m.attention.map((s) => (
                <button type="button" key={s.id} className="od-item" onClick={() => onOpenSite(s.id)}>
                  <div className="od-item-head"><strong>{s.siteName ?? "Site"}{s.siteCode ? ` (${s.siteCode})` : ""}</strong><small>{s.stageLabel} · {s.daysInStage}d</small></div>
                  <small>{s.customer ?? "—"}{s.region ? ` · ${s.region}` : ""}</small>
                  <div className="od-chips">
                    {s.late && <span className="od-chip od-chip--danger">Late</span>}
                    {s.openProblems > 0 && <span className="od-chip od-chip--danger">{s.openProblems} open problem{s.openProblems === 1 ? "" : "s"}</span>}
                    {s.missingPictureDays > 0 && <span className="od-chip od-chip--warning">{s.missingPictureDays} day{s.missingPictureDays === 1 ? "" : "s"} without pictures</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pz-panel pz-stack">
          <div className="od-head"><h2>Next 7 days</h2><small>{fmt(today)} to {fmt(shift(7))}</small></div>
          <h3>Material deliveries</h3>
          {m.deliveries.length === 0 ? <p className="od-empty">No deliveries planned this week.</p> : (
            <div className="od-rows">
              {m.deliveries.map((s) => (
                <button type="button" key={s.id} className="od-row" onClick={() => onOpenSite(s.id)}>
                  <span>{s.siteName ?? "Site"}{s.siteCode ? ` (${s.siteCode})` : ""}</span><small>{relDay(s.materialDeliveryPlanned!)}</small>
                </button>
              ))}
            </div>
          )}
          <h3>Installations starting</h3>
          {m.starts.length === 0 ? <p className="od-empty">No start dates this week.</p> : (
            <div className="od-rows">
              {m.starts.map((s) => (
                <button type="button" key={s.id} className="od-row" onClick={() => onOpenSite(s.id)}>
                  <span>{s.siteName ?? "Site"}{s.siteCode ? ` (${s.siteCode})` : ""}</span><small>{relDay(s.startDate!)}</small>
                </button>
              ))}
            </div>
          )}
          <h3>Customer POs expected</h3>
          {m.posSoon.length === 0 ? <p className="od-empty">{m.awaiting.length} advance BOQ{m.awaiting.length === 1 ? "" : "s"} awaiting a PO, none expected this week.</p> : (
            <div className="od-rows">
              {m.posSoon.map((a) => (
                <button type="button" key={a.record_id} className="od-row" onClick={() => onGo("operations")}>
                  <span>{a.site_name ?? a.number}{a.site_code ? ` (${a.site_code})` : ""}</span><small>{relDay(a.snapshot!.expectedDate!)}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="pz-panel pz-stack">
        <div className="od-head"><h2>Stock</h2><button type="button" className="od-link" onClick={() => onGo("stock")}>Stock &amp; procurement</button></div>
        <div className="od-stats">
          <button type="button" className="od-stat" onClick={() => onGo("stock")}><strong>{n(m.short)}</strong><span>items with a shortage</span></button>
          <button type="button" className="od-stat" onClick={() => onGo("reserved")}><strong>{n(m.reservations)}</strong><span>reservation{m.reservations === 1 ? "" : "s"}{m.reservedSites ? ` across ${m.reservedSites} site${m.reservedSites === 1 ? "" : "s"}` : ""}</span></button>
          <button type="button" className="od-stat" onClick={() => onGo("stock")}><strong>{n(m.uncounted)}</strong><span>items Store has not counted</span></button>
          <button type="button" className="od-stat" onClick={() => onGo("operations")}><strong>{ready ? m.awaiting.length : "…"}</strong><span>advance BOQ{m.awaiting.length === 1 ? "" : "s"} awaiting PO</span></button>
        </div>
        {m.shortages.length > 0 && (
          <>
            <h3>Biggest shortages</h3>
            <div className="od-bars">
              {m.shortages.map((i) => {
                const required = Number(i.required) || 0, existing = Number(i.existing ?? 0);
                const pct = required > 0 ? Math.min(100, Math.round((existing / required) * 100)) : 0;
                return (
                  <div className="od-bar" key={i.itemKey}>
                    <div className="od-bar-label"><span>{i.name}</span><small>{i.counted ? `${existing} of ${required} ${i.unit}` : `${required} ${i.unit} required · no count`} · short {i.shortage}</small></div>
                    <div className="od-bar-track" role="img" aria-label={`${i.name}: ${pct}% of required in stock`}><div className="od-bar-fill" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <div className="od-columns">
        <section className="pz-panel pz-stack">
          <div className="od-head"><h2>Completed, last 30 days</h2><button type="button" className="od-link" onClick={() => onGo("sites-completed")}>All</button></div>
          {m.completed.length === 0 ? <p className="od-empty">No site finished in the last 30 days.</p> : (
            <div className="od-rows">
              {m.completed.slice(0, 6).map((s) => (
                <button type="button" key={s.id} className="od-row" onClick={() => onOpenSite(s.id)}>
                  <span>{s.siteName ?? "Site"}{s.siteCode ? ` (${s.siteCode})` : ""}</span><small>ended {fmt(s.endDate)}</small>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="pz-panel pz-stack">
          <div className="od-head"><h2>Documentation issues</h2><button type="button" className="od-link" onClick={() => onGo("sites-docs")}>All</button></div>
          {m.docs.length === 0 ? <p className="od-empty">Every finished site has its documents.</p> : (
            <div className="od-list">
              {m.docs.slice(0, 6).map((s) => (
                <button type="button" key={s.id} className="od-item" onClick={() => onOpenSite(s.id)}>
                  <div className="od-item-head"><strong>{s.siteName ?? "Site"}{s.siteCode ? ` (${s.siteCode})` : ""}</strong><small>ended {fmt(s.endDate)}</small></div>
                  <div className="od-chips">{missingDocs(s).map((d) => <span key={d} className="od-chip od-chip--warning">{d}</span>)}</div>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="pz-panel pz-stack">
          <div className="od-head"><h2>Latest advance BOQs</h2><button type="button" className="od-link" onClick={() => onGo("operations")}>Search</button></div>
          {m.latestAdvance.length === 0 ? <p className="od-empty">No advance BOQs received.</p> : (
            <div className="od-rows">
              {m.latestAdvance.map((a) => (
                <button type="button" key={a.record_id} className="od-row" onClick={() => onGo("operations")}>
                  <span>{a.site_name ?? a.number}{a.site_code ? ` (${a.site_code})` : ""}<br /><small>{a.customer_name ?? ""}{a.confirmed_issuance_id ? " · final received" : " · awaiting PO"}</small></span>
                  <small>{a.snapshot?.expectedDate ? `PO ${fmt(a.snapshot.expectedDate)}` : fmt(a.updated_at)}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <p className="od-empty">{loadedAt ? `Updated ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit" }).format(loadedAt)} · refreshes every minute · ${session.user.displayName}` : "Loading…"}</p>
    </div>
  );
}
