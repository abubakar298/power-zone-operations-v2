import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import "./site-workflow.css";
import { STAGE_COLOURS, stageInk, fmtShort, hasDocIssue, missingDocs, relDay, shiftDays, today, OVERDUE_TEXT, type SiteRow, type StageKey } from "./stages.js";

interface Advance { record_id: string; number: string; confirmed_issuance_id: string | null; updated_at: string; customer_name?: string; site_name?: string; site_code?: string; region?: string; snapshot?: { expectedDate?: string; items?: unknown[] } }
export type HomeTarget = "operations" | "sites-new" | "sites-ongoing" | "sites-completed" | "sites-docs" | "sites" | "reports";

const I = {
  plus: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>,
  site: <svg className="i" viewBox="0 0 24 24"><path d="M4 19h16M6 19V9l6-4 6 4v10" /><path d="M10 19v-5h4v5" /></svg>,
  clock: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  warn: <svg className="i" viewBox="0 0 24 24"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17v.01" /></svg>,
};
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const longDate = () => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

/**
 * Operations home, in the portal layout (Moaz, 19 Oct 2026): greeting, four figures, the pipeline next to
 * what is due this week, the sites that need attention as cards, and the latest heads-ups.
 */
export function OperationsHome({ session, onGo, onOpenSite, onOpenStage, regionScope = "" }: {
  session: Session; onGo: (target: HomeTarget) => void; onOpenSite: (siteId: string) => void; onOpenStage: (stage: string) => void; regionScope?: string;
}) {
  const [allSites, setAllSites] = useState<SiteRow[]>([]);
  const [stages, setStages] = useState<{ key: StageKey; label: string }[]>([]);
  const [lateAfterDays, setLateAfterDays] = useState(2);
  const [allAdvance, setAllAdvance] = useState<Advance[]>([]);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        api<{ sites: SiteRow[]; stages: { key: StageKey; label: string }[]; lateAfterDays: number }>("/site-workflow"),
        api<{ requests: Advance[] }>("/project-workflow/advance-inbox").catch(() => ({ requests: [] as Advance[] })),
      ]);
      setAllSites(s.sites); setStages(s.stages); setLateAfterDays(s.lateAfterDays); setAllAdvance(a.requests); setError(""); setLoadedAt(new Date());
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load the dashboard."); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);

  const sites = useMemo(() => (regionScope ? allSites.filter((s) => s.region === regionScope) : allSites), [allSites, regionScope]);
  const advance = useMemo(() => (regionScope ? allAdvance.filter((a) => (a.region || "") === regionScope) : allAdvance), [allAdvance, regionScope]);
  const t = today(), week = shiftDays(7);
  const m = useMemo(() => {
    const ongoing = sites.filter((s) => s.stage !== "closed");
    const fresh = sites.filter((s) => s.stage === "ipo_received");
    const late = ongoing.filter((s) => s.late || s.overdue.length > 0);
    const overdue = ongoing.filter((s) => s.overdue.length > 0).length;
    const problems = ongoing.reduce((n, s) => n + s.openProblems, 0);
    const pictures = ongoing.reduce((n, s) => n + s.missingPictureDays, 0);
    const completed = sites.filter((s) => s.closedAt && s.closedAt.slice(0, 10) >= shiftDays(-30)).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
    const docs = sites.filter(hasDocIssue);
    const inWeek = (v: string | null | undefined) => Boolean(v && v >= t && v <= week);
    const deliveries = ongoing.filter((s) => inWeek(s.expectedDelivery) && !s.deliveredOn).sort((a, b) => a.expectedDelivery!.localeCompare(b.expectedDelivery!));
    const starts = ongoing.filter((s) => s.scope !== "delivery_only" && inWeek(s.expectedStart) && !s.startedOn).sort((a, b) => a.expectedStart!.localeCompare(b.expectedStart!));
    const completions = ongoing.filter((s) => s.scope !== "delivery_only" && inWeek(s.expectedCompletion) && !s.handedOverOn).sort((a, b) => a.expectedCompletion!.localeCompare(b.expectedCompletion!));
    const attention = [...ongoing, ...docs.filter((d) => d.stage === "closed")].filter((s, i, arr) => arr.indexOf(s) === i)
      .filter((s) => s.late || s.overdue.length > 0 || s.openProblems > 0 || s.missingPictureDays > 0 || hasDocIssue(s) || (s.stage === "delivery" && !s.scope))
      .sort((a, b) => (b.overdue.length + Number(b.late) + b.openProblems) - (a.overdue.length + Number(a.late) + a.openProblems) || b.daysInStage - a.daysInStage)
      .slice(0, 6);
    const byStage = new Map<string, number>();
    for (const s of sites) byStage.set(s.stage, (byStage.get(s.stage) ?? 0) + 1);
    const stageCounts = (keys: StageKey[]) => keys.map((k) => `${k.replace("_", " ")} ${byStage.get(k) ?? 0}`);
    const awaiting = advance.filter((a) => !a.confirmed_issuance_id);
    const posSoon = awaiting.filter((a) => inWeek(a.snapshot?.expectedDate)).sort((a, b) => a.snapshot!.expectedDate!.localeCompare(b.snapshot!.expectedDate!));
    const latestAdvance = [...advance].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
    return { ongoing, fresh, late, overdue, problems, pictures, completed, docs, deliveries, starts, completions, attention, byStage, stageCounts, awaiting, posSoon, latestAdvance };
  }, [sites, advance, t, week]);
  const ready = loadedAt !== null;
  const n = (v: number) => (ready ? v : "…");
  const label = (s: SiteRow) => `${s.siteName ?? "Site"}${s.siteCode ? ` (${s.siteCode})` : ""}`;
  /** Why a site is on the attention list, as the card's headline and detail. */
  const why = (s: SiteRow): { k: string; v: string; tone: "r" | "a"; r: string } => {
    if (s.openProblems > 0) return { k: "Open problem", v: `${s.openProblems} open problem${s.openProblems === 1 ? "" : "s"}`, tone: "r", r: s.missingPictureDays ? `${s.missingPictureDays} day${s.missingPictureDays === 1 ? "" : "s"} without pictures.` : "Resolve it on the site page." };
    if (s.overdue.length) return { k: "Overdue", v: s.overdue.map((o) => OVERDUE_TEXT[o] ?? o).join(", "), tone: "r", r: s.stage === "delivery" && !s.scope ? "Decide: install and commission by us, or delivery only." : `Expected date passed while the site is at ${s.stageLabel}.` };
    if (s.stage === "delivery" && !s.scope) return { k: "Decision pending", v: "Scope not decided", tone: "a", r: "Install and commission by us, or delivery only?" };
    if (hasDocIssue(s)) return { k: "Documents", v: `${missingDocs(s)[0]} missing`, tone: "a", r: missingDocs(s).length > 1 ? `Also ${missingDocs(s).slice(1).join(", ")}.` : "Final 50% waits on the documents." };
    if (s.late) return { k: "Late", v: `${s.daysInStage} days at ${s.stageLabel}`, tone: "a", r: `More than ${lateAfterDays} days in one stage.` };
    return { k: "Pictures", v: `${s.missingPictureDays} day${s.missingPictureDays === 1 ? "" : "s"} without pictures`, tone: "a", r: "Mark each installation day yes or no." };
  };

  return (
    <div className="ops-home">
      {error && <p className="ops-feedback" role="alert">{error}</p>}
      <div className="ops-welcome">
        <div><h1>{greeting()}, {session.user.displayName}.</h1><p>Where every site stands today · {longDate()}{regionScope ? ` · ${regionScope} only` : ""}</p></div>
        <span className="ops-pill">{loadedAt ? `Updated ${new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(loadedAt)} · refreshes every minute` : "Loading…"}</span>
      </div>

      <div className="ops-kgrid" aria-label="Key figures">
        <button type="button" className="ops-card ops-kc" onClick={() => onGo("sites-new")}>
          <div className="ops-kc-top"><span className="ops-kc-ic">{I.plus}</span><span className="ops-trend">{n(m.awaiting.length)} heads-up{m.awaiting.length === 1 ? "" : "s"} awaiting PO</span></div>
          <div className="ops-kc-l">New sites</div><div className="ops-kc-v">{n(m.fresh.length)}</div><div className="ops-kc-p">IPO received, planning not started</div>
        </button>
        <button type="button" className="ops-card ops-kc" onClick={() => onGo("sites-ongoing")}>
          <div className="ops-kc-top"><span className="ops-kc-ic hot">{I.site}</span><span className={`ops-trend${m.completed.length ? " ok" : ""}`}>{n(m.completed.length)} closed in 30 days</span></div>
          <div className="ops-kc-l">Ongoing sites</div><div className="ops-kc-v">{n(m.ongoing.length)}</div>
          <div className="ops-kc-p">{ready ? m.stageCounts(["planning", "delivery", "installation", "commissioning", "handover", "doc_dispatch"]).filter((x) => !x.endsWith(" 0")).join(" · ") || "none in progress" : "…"}</div>
        </button>
        <button type="button" className="ops-card ops-kc" onClick={() => onGo("sites-ongoing")}>
          <div className="ops-kc-top"><span className="ops-kc-ic">{I.clock}</span><span className={`ops-trend${m.overdue ? " bad" : ""}`}>{n(m.overdue)} past an expected date</span></div>
          <div className="ops-kc-l">Late or overdue</div><div className="ops-kc-v">{n(m.late.length)}</div><div className="ops-kc-p">more than {lateAfterDays} days in a stage, or past an expected date</div>
        </button>
        <button type="button" className="ops-card ops-kc" onClick={() => onGo("sites-ongoing")}>
          <div className="ops-kc-top"><span className="ops-kc-ic">{I.warn}</span><span className={`ops-trend${m.pictures ? " bad" : ""}`}>{n(m.pictures)} day{m.pictures === 1 ? "" : "s"} without pictures</span></div>
          <div className="ops-kc-l">Open problems</div><div className="ops-kc-v">{n(m.problems)}</div>
          <div className="ops-kc-p">{m.problems ? m.ongoing.filter((s) => s.openProblems > 0).map(label).join(", ") : "nothing open"}</div>
        </button>
      </div>

      <div className="ops-dgrid">
        <section className="ops-card ops-sc">
          <div className="ops-sc-h"><h3>Where the sites are</h3><button type="button" className="ops-link" onClick={() => onGo("sites")}>All sites →</button></div>
          {ready && sites.length === 0 ? <p className="ops-empty">No sites yet. A site appears here when its IPO is issued to Operations.</p> : (
            <>
              <div className="ops-pipe" role="group" aria-label="Sites by stage">
                {stages.map((s) => { const c = m.byStage.get(s.key) ?? 0; return c ? <button type="button" key={s.key} style={{ flex: `${c} 1 0`, background: STAGE_COLOURS[s.key], color: stageInk(s.key) }} title={`${s.label}: ${c}`} onClick={() => onOpenStage(s.key)}>{c}</button> : null; })}
              </div>
              <div className="ops-leg">
                {stages.map((s) => <button type="button" key={s.key} onClick={() => onOpenStage(s.key)}><i style={{ background: STAGE_COLOURS[s.key] }} />{s.label}<b>{m.byStage.get(s.key) ?? 0}</b></button>)}
              </div>
              <div className="ops-flow">IPO received → Under planning → Delivery → Installation → Commissioning → Handover → Doc dispatch → Closed. Delivery-only sites close straight after Delivery.</div>
            </>
          )}
        </section>
        <section className="ops-card ops-sc">
          <div className="ops-sc-h"><h3>Next 7 days</h3><span className="count">{fmtShort(t)} – {fmtShort(week)}</span></div>
          <div className="ops-list">
            <h4>Deliveries expected</h4>
            {m.deliveries.length === 0 ? <p>No deliveries expected this week.</p> : m.deliveries.map((s) => <button type="button" key={s.id} onClick={() => onOpenSite(s.id)}><span>{label(s)}<small>{s.customer ?? "—"}{s.region ? ` · ${s.region}` : ""}</small></span><span className="when">{relDay(s.expectedDelivery!)}</span></button>)}
            <h4>Installations starting</h4>
            {m.starts.length === 0 ? <p>No installation starts expected this week.</p> : m.starts.map((s) => <button type="button" key={s.id} onClick={() => onOpenSite(s.id)}><span>{label(s)}<small>{s.stageLabel} · expected start</small></span><span className="when">{relDay(s.expectedStart!)}</span></button>)}
            <h4>Completions due</h4>
            {m.completions.length === 0 ? <p>No completions due this week.</p> : m.completions.map((s) => <button type="button" key={s.id} onClick={() => onOpenSite(s.id)}><span>{label(s)}<small>{s.stageLabel}{s.openProblems ? ` · ${s.openProblems} open problem${s.openProblems === 1 ? "" : "s"}` : ""}</small></span><span className="when">{relDay(s.expectedCompletion!)}</span></button>)}
            <h4>Customer POs expected</h4>
            {m.posSoon.length === 0 ? <p>{n(m.awaiting.length)} heads-up{m.awaiting.length === 1 ? "" : "s"} awaiting a PO, none expected this week.</p> : m.posSoon.map((a) => <button type="button" key={a.record_id} onClick={() => onGo("operations")}><span>{a.site_name ?? a.number}{a.site_code ? ` (${a.site_code})` : ""}<small>Heads-up {a.snapshot ? a.number : ""}</small></span><span className="when">{relDay(a.snapshot!.expectedDate!)}</span></button>)}
          </div>
        </section>
      </div>

      <section className="ops-card ops-recs">
        <div className="ops-recs-h">{I.warn}<h3>Needs attention</h3><span className="count">{n(m.attention.length)} site{m.attention.length === 1 ? "" : "s"}</span></div>
        {ready && m.attention.length === 0 ? <p className="ops-list" style={{ color: "var(--ops-muted)" }}>Nothing is late or overdue, no open problems, no missing pictures, no documents missing.</p> : (
          <div className="ops-rrow">
            {m.attention.map((s) => { const w = why(s); return (
              <button type="button" key={s.id} className="ops-rec" onClick={() => onOpenSite(s.id)}>
                <div className="ops-rec-h"><h4>{label(s)}</h4><span className="ops-rbadge">{s.stageLabel} · {s.daysInStage}d</span></div>
                <div className="ops-rk">{w.k}</div><div className={`ops-rv ${w.tone}`}>{w.v}</div><div className="ops-rr">{w.r}</div>
                <div className="chips">
                  {s.late && <span className="sw-chip sw-chip--danger">Late</span>}
                  {s.overdue.map((o) => <span key={o} className="sw-chip sw-chip--danger">{OVERDUE_TEXT[o] ?? o}</span>)}
                  {s.openProblems > 0 && <span className="sw-chip sw-chip--danger">{s.openProblems} problem{s.openProblems === 1 ? "" : "s"}</span>}
                  {s.missingPictureDays > 0 && <span className="sw-chip sw-chip--warning">{s.missingPictureDays} day{s.missingPictureDays === 1 ? "" : "s"} no pictures</span>}
                  {hasDocIssue(s) && missingDocs(s).map((d) => <span key={d} className="sw-chip sw-chip--warning">{d}</span>)}
                </div>
              </button>
            ); })}
          </div>
        )}
      </section>

      <div className="ops-dgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        <section className="ops-card ops-sc">
          <div className="ops-sc-h"><h3>Closed, last 30 days</h3><button type="button" className="ops-link" onClick={() => onGo("sites-completed")}>All →</button></div>
          <div className="ops-list">
            {ready && m.completed.length === 0 ? <p>No site closed in the last 30 days.</p> : m.completed.slice(0, 6).map((s) => <button type="button" key={s.id} onClick={() => onOpenSite(s.id)}><span>{label(s)}<small>{s.scope === "delivery_only" ? "delivery only" : "installed and documented"}</small></span><span className="when">{fmtShort(s.closedAt?.slice(0, 10))}</span></button>)}
          </div>
        </section>
        <section className="ops-card ops-sc">
          <div className="ops-sc-h"><h3>Documentation issues</h3><button type="button" className="ops-link" onClick={() => onGo("sites-docs")}>All →</button></div>
          <div className="ops-list">
            {ready && m.docs.length === 0 ? <p>Every site that reached Doc dispatch has its documents.</p> : m.docs.slice(0, 6).map((s) => <button type="button" key={s.id} onClick={() => onOpenSite(s.id)}><span>{label(s)}<small>missing {missingDocs(s).join(", ")}</small></span><span className="when">{s.stageLabel}</span></button>)}
          </div>
        </section>
      </div>

      <section className="ops-card">
        <div className="ops-tc-h"><h3>Latest heads-ups</h3><button type="button" className="ops-link" onClick={() => onGo("operations")}>BOQ to Operations →</button></div>
        <div className="pz-table-scroll">
          <table className="ops-table">
            <thead><tr><th>Site</th><th>Customer</th><th>Region</th><th>Received</th><th>PO expected</th><th>Items</th><th>Status</th></tr></thead>
            <tbody>
              {ready && m.latestAdvance.length === 0 ? <tr><td colSpan={7} className="ops-empty">No advance BOQs received.</td></tr> : m.latestAdvance.map((a) => (
                <tr key={a.record_id} data-clickable onClick={() => onGo("operations")}>
                  <td className="site"><b>{a.site_name ?? a.number}{a.site_code ? ` (${a.site_code})` : ""}</b><small>{a.number}</small></td>
                  <td>{a.customer_name ?? "—"}</td><td>{a.region || "—"}</td>
                  <td className="date">{fmtShort(a.updated_at.slice(0, 10))}</td><td className="date">{a.snapshot?.expectedDate ? fmtShort(a.snapshot.expectedDate) : "—"}</td>
                  <td>{Array.isArray(a.snapshot?.items) ? a.snapshot!.items!.length : "—"}</td>
                  <td><span className={`sw-chip${a.confirmed_issuance_id ? " sw-chip--ok" : ""}`}>{a.confirmed_issuance_id ? "Final received" : "Awaiting PO"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="ops-foot">{session.user.displayName} · Operations</p>
    </div>
  );
}
