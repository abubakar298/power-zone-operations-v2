import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import "./site-workflow.css";
import { STAGE_COLOURS, stageInk, fmtShort, hasDocIssue, missingDocs, relDay, shiftDays, today, OVERDUE_TEXT, type SiteRow, type StageKey } from "./stages.js";

interface Advance { record_id: string; number: string; confirmed_issuance_id: string | null; updated_at: string; customer_name?: string; site_name?: string; site_code?: string; snapshot?: { expectedDate?: string } }
export type HomeTarget = "operations" | "sites-new" | "sites-ongoing" | "sites-completed" | "sites-docs" | "sites" | "reports";

/** Operations home: where every site stands in the workflow, what needs attention and what is due this week. */
export function OperationsHome({ session, onGo, onOpenSite, onOpenStage }: {
  session: Session; onGo: (target: HomeTarget) => void; onOpenSite: (siteId: string) => void; onOpenStage: (stage: string) => void;
}) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [stages, setStages] = useState<{ key: StageKey; label: string }[]>([]);
  const [lateAfterDays, setLateAfterDays] = useState(2);
  const [advance, setAdvance] = useState<Advance[]>([]);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        api<{ sites: SiteRow[]; stages: { key: StageKey; label: string }[]; lateAfterDays: number }>("/site-workflow"),
        api<{ requests: Advance[] }>("/project-workflow/advance-inbox").catch(() => ({ requests: [] as Advance[] })),
      ]);
      setSites(s.sites); setStages(s.stages); setLateAfterDays(s.lateAfterDays); setAdvance(a.requests); setError(""); setLoadedAt(new Date());
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load the dashboard."); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);

  const t = today(), week = shiftDays(7);
  const m = useMemo(() => {
    const ongoing = sites.filter((s) => s.stage !== "closed");
    const fresh = sites.filter((s) => s.stage === "ipo_received");
    const late = ongoing.filter((s) => s.late || s.overdue.length > 0);
    const problems = ongoing.reduce((n, s) => n + s.openProblems, 0);
    const pictures = ongoing.reduce((n, s) => n + s.missingPictureDays, 0);
    const completed = sites.filter((s) => s.closedAt && s.closedAt.slice(0, 10) >= shiftDays(-30)).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
    const docs = sites.filter(hasDocIssue);
    const inWeek = (v: string | null) => Boolean(v && v >= t && v <= week);
    const deliveries = ongoing.filter((s) => inWeek(s.expectedDelivery) && !s.deliveredOn).sort((a, b) => a.expectedDelivery!.localeCompare(b.expectedDelivery!));
    const starts = ongoing.filter((s) => s.scope !== "delivery_only" && inWeek(s.expectedStart) && !s.startedOn).sort((a, b) => a.expectedStart!.localeCompare(b.expectedStart!));
    const completions = ongoing.filter((s) => s.scope !== "delivery_only" && inWeek(s.expectedCompletion) && !s.handedOverOn).sort((a, b) => a.expectedCompletion!.localeCompare(b.expectedCompletion!));
    const attention = ongoing.filter((s) => s.late || s.overdue.length > 0 || s.openProblems > 0 || s.missingPictureDays > 0)
      .sort((a, b) => (b.overdue.length + Number(b.late)) - (a.overdue.length + Number(a.late)) || b.openProblems - a.openProblems || b.missingPictureDays - a.missingPictureDays || b.daysInStage - a.daysInStage)
      .slice(0, 8);
    const byStage = new Map<string, number>();
    for (const s of sites) byStage.set(s.stage, (byStage.get(s.stage) ?? 0) + 1);
    const awaiting = advance.filter((a) => !a.confirmed_issuance_id);
    const posSoon = awaiting.filter((a) => inWeek(a.snapshot?.expectedDate ?? null)).sort((a, b) => a.snapshot!.expectedDate!.localeCompare(b.snapshot!.expectedDate!));
    const latestAdvance = [...advance].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
    return { ongoing, fresh, late, problems, pictures, completed, docs, deliveries, starts, completions, attention, byStage, awaiting, posSoon, latestAdvance };
  }, [sites, advance, t, week]);
  const ready = loadedAt !== null;
  const n = (v: number) => (ready ? v : "…");
  const siteLabel = (s: SiteRow) => `${s.siteName ?? "Site"}${s.siteCode ? ` (${s.siteCode})` : ""}`;

  return (
    <div className="sw">
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}

      <section className="sw-kpis" aria-label="Key figures">
        <button type="button" className="sw-kpi" onClick={() => onGo("sites-new")}>
          <strong>{n(m.fresh.length)}</strong><span>New sites</span><small>{n(m.awaiting.length)} heads-up BOQ{m.awaiting.length === 1 ? "" : "s"} awaiting a PO</small>
        </button>
        <button type="button" className="sw-kpi" onClick={() => onGo("sites-ongoing")}>
          <strong>{n(m.ongoing.length)}</strong><span>Ongoing sites</span><small>{n(m.completed.length)} closed in the last 30 days</small>
        </button>
        <button type="button" className={`sw-kpi${m.late.length ? " sw-kpi--danger" : " sw-kpi--ok"}`} onClick={() => onGo("sites-ongoing")}>
          <strong>{n(m.late.length)}</strong><span>Late or overdue</span><small>more than {lateAfterDays} days in a stage, or past an expected date</small>
        </button>
        <button type="button" className={`sw-kpi${m.problems ? " sw-kpi--danger" : " sw-kpi--ok"}`} onClick={() => onGo("sites-ongoing")}>
          <strong>{n(m.problems)}</strong><span>Open problems</span><small>{n(m.pictures)} day{m.pictures === 1 ? "" : "s"} without pictures</small>
        </button>
      </section>

      <section className="pz-panel pz-stack">
        <div className="sw-head"><h2>Where the sites are</h2><small>{sites.length} site{sites.length === 1 ? "" : "s"} · click a stage to open it</small></div>
        {ready && sites.length === 0 ? <p className="sw-muted">No sites yet. A site appears here when its IPO is issued to Operations.</p> : (
          <>
            <div className="sw-pipeline" role="group" aria-label="Sites by stage">
              {stages.map((s) => {
                const count = m.byStage.get(s.key) ?? 0;
                if (!count) return null;
                return (
                  <button type="button" key={s.key} className="sw-seg" style={{ flex: `${count} 1 0`, background: STAGE_COLOURS[s.key], color: stageInk(s.key) }}
                    title={`${s.label}: ${count}`} aria-label={`${s.label}: ${count}`} onClick={() => onOpenStage(s.key)}>{count}</button>
                );
              })}
            </div>
            <div className="sw-legend">
              {stages.map((s) => (
                <button type="button" key={s.key} onClick={() => onOpenStage(s.key)}><i className="sw-dot" style={{ background: STAGE_COLOURS[s.key] }} />{s.label} · {m.byStage.get(s.key) ?? 0}</button>
              ))}
            </div>
            <p className="sw-muted">IPO received → Under planning → Delivery → Installation → Commissioning → Handover → Doc dispatch → Closed. Delivery-only sites close straight after Delivery.</p>
          </>
        )}
      </section>

      <div className="sw-columns">
        <section className="pz-panel pz-stack">
          <div className="sw-head"><h2>Needs attention</h2><button type="button" className="sw-link" onClick={() => onGo("sites-ongoing")}>All ongoing</button></div>
          {m.attention.length === 0 ? <p className="sw-muted">Nothing is late or overdue, no open problems, no missing pictures.</p> : (
            <div className="sw-list">
              {m.attention.map((s) => (
                <button type="button" key={s.id} className="sw-item" onClick={() => onOpenSite(s.id)}>
                  <div className="sw-item-head"><strong>{siteLabel(s)}</strong><small>{s.stageLabel} · {s.daysInStage}d</small></div>
                  <small>{s.customer ?? "—"}{s.region ? ` · ${s.region}` : ""}</small>
                  <div className="sw-chips">
                    {s.late && <span className="sw-chip sw-chip--danger">Late</span>}
                    {s.overdue.map((o) => <span key={o} className="sw-chip sw-chip--danger">{OVERDUE_TEXT[o] ?? o}</span>)}
                    {s.openProblems > 0 && <span className="sw-chip sw-chip--danger">{s.openProblems} open problem{s.openProblems === 1 ? "" : "s"}</span>}
                    {s.missingPictureDays > 0 && <span className="sw-chip sw-chip--warning">{s.missingPictureDays} day{s.missingPictureDays === 1 ? "" : "s"} without pictures</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pz-panel pz-stack">
          <div className="sw-head"><h2>Next 7 days</h2><small>{fmtShort(t)} to {fmtShort(week)}</small></div>
          {[
            { title: "Deliveries expected", rows: m.deliveries, date: (s: SiteRow) => s.expectedDelivery!, empty: "No deliveries expected this week." },
            { title: "Installations starting", rows: m.starts, date: (s: SiteRow) => s.expectedStart!, empty: "No installation starts expected this week." },
            { title: "Completions due", rows: m.completions, date: (s: SiteRow) => s.expectedCompletion!, empty: "No completions due this week." },
          ].map((block) => (
            <div key={block.title} className="pz-stack">
              <h3 style={{ margin: 0 }}>{block.title}</h3>
              {block.rows.length === 0 ? <p className="sw-muted">{block.empty}</p> : (
                <div className="sw-rows">
                  {block.rows.map((s) => <button type="button" key={s.id} className="sw-row" onClick={() => onOpenSite(s.id)}><span>{siteLabel(s)}</span><small>{relDay(block.date(s))}</small></button>)}
                </div>
              )}
            </div>
          ))}
          <h3 style={{ margin: 0 }}>Customer POs expected</h3>
          {m.posSoon.length === 0 ? <p className="sw-muted">{n(m.awaiting.length)} heads-up BOQ{m.awaiting.length === 1 ? "" : "s"} awaiting a PO, none expected this week.</p> : (
            <div className="sw-rows">
              {m.posSoon.map((a) => <button type="button" key={a.record_id} className="sw-row" onClick={() => onGo("operations")}><span>{a.site_name ?? a.number}{a.site_code ? ` (${a.site_code})` : ""}</span><small>{relDay(a.snapshot!.expectedDate!)}</small></button>)}
            </div>
          )}
        </section>
      </div>

      <div className="sw-columns">
        <section className="pz-panel pz-stack">
          <div className="sw-head"><h2>Closed, last 30 days</h2><button type="button" className="sw-link" onClick={() => onGo("sites-completed")}>All</button></div>
          {m.completed.length === 0 ? <p className="sw-muted">No site closed in the last 30 days.</p> : (
            <div className="sw-rows">
              {m.completed.slice(0, 6).map((s) => <button type="button" key={s.id} className="sw-row" onClick={() => onOpenSite(s.id)}><span>{siteLabel(s)}<br /><small>{s.scope === "delivery_only" ? "delivery only" : "installed and documented"}</small></span><small>{fmtShort(s.closedAt?.slice(0, 10))}</small></button>)}
            </div>
          )}
        </section>
        <section className="pz-panel pz-stack">
          <div className="sw-head"><h2>Documentation issues</h2><button type="button" className="sw-link" onClick={() => onGo("sites-docs")}>All</button></div>
          {m.docs.length === 0 ? <p className="sw-muted">Every site that reached Doc dispatch has its documents.</p> : (
            <div className="sw-list">
              {m.docs.slice(0, 6).map((s) => (
                <button type="button" key={s.id} className="sw-item" onClick={() => onOpenSite(s.id)}>
                  <div className="sw-item-head"><strong>{siteLabel(s)}</strong><small>{s.stageLabel}</small></div>
                  <div className="sw-chips">{missingDocs(s).map((d) => <span key={d} className="sw-chip sw-chip--warning">{d}</span>)}</div>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="pz-panel pz-stack">
          <div className="sw-head"><h2>Latest heads-ups</h2><button type="button" className="sw-link" onClick={() => onGo("operations")}>All</button></div>
          {m.latestAdvance.length === 0 ? <p className="sw-muted">No advance BOQs received.</p> : (
            <div className="sw-rows">
              {m.latestAdvance.map((a) => (
                <button type="button" key={a.record_id} className="sw-row" onClick={() => onGo("operations")}>
                  <span>{a.site_name ?? a.number}{a.site_code ? ` (${a.site_code})` : ""}<br /><small>{a.customer_name ?? ""}{a.confirmed_issuance_id ? " · final received" : " · awaiting PO"}</small></span>
                  <small>{a.snapshot?.expectedDate ? `PO ${fmtShort(a.snapshot.expectedDate)}` : fmtShort(a.updated_at.slice(0, 10))}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <p className="sw-muted">{loadedAt ? `Updated ${new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(loadedAt)} · refreshes every minute · ${session.user.displayName}` : "Loading…"}</p>
    </div>
  );
}
