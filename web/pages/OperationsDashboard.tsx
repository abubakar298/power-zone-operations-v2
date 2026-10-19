import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../api.js";
import { StatusBadge } from "../ui/StatusBadge.js";

interface SiteRow {
  id: string; siteName: string | null; siteCode: string | null; customer: string | null; region: string | null; stage: string; stageLabel: string;
  daysInStage: number; late: boolean; endDate: string | null; doDate: string | null; acknowledgementDate: string | null; submittedToCustomerDate: string | null;
  customerSignoff: boolean | null; openProblems: number; missingPictureDays: number; materialDeliveryPlanned: string | null;
}
interface StockItem { shortage: string; counted: boolean }
interface Reservation { executionId: string }
interface Advance { mode: string; confirmed_issuance_id: string | null }

export type DashboardTarget = "operations" | "sites-ongoing" | "sites-completed" | "sites-docs" | "sites" | "reserved" | "stock" | "reports";

const isoDay = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };
const fmt = (v: string | null) => (v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${v}T00:00:00`)) : "—");
const docsMissing = (s: SiteRow) => Boolean(s.endDate) && (!s.doDate || !s.acknowledgementDate || !s.submittedToCustomerDate || s.customerSignoff !== true);

/** Operations home: counts with one click to the page behind each, and the sites that need attention first. */
export function OperationsDashboard({ session, onGo, onOpenSite }: { session: Session; onGo: (target: DashboardTarget) => void; onOpenSite: (siteId: string) => void }) {
  void session;
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [stock, setStock] = useState<{ items: StockItem[]; reservations: Reservation[] } | null>(null);
  const [advance, setAdvance] = useState<Advance[] | null>(null);
  const [lateAfterDays, setLateAfterDays] = useState(2);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, st, a] = await Promise.all([
        api<{ sites: SiteRow[]; lateAfterDays: number }>("/site-execution"),
        api<{ items: StockItem[]; reservations: Reservation[] }>("/site-execution/stock"),
        api<{ requests: Advance[] }>("/project-workflow/advance-inbox").catch(() => ({ requests: [] })),
      ]);
      setSites(s.sites); setLateAfterDays(s.lateAfterDays); setStock(st); setAdvance(a.requests); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load the dashboard."); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);

  const m = useMemo(() => {
    const ongoing = sites.filter((s) => s.stage !== "closed");
    const completed = sites.filter((s) => s.endDate && s.endDate >= daysAgo(30) && s.endDate <= isoDay(new Date()));
    const docs = sites.filter(docsMissing);
    const late = ongoing.filter((s) => s.late);
    const problems = ongoing.reduce((n, s) => n + s.openProblems, 0);
    const pictures = ongoing.reduce((n, s) => n + s.missingPictureDays, 0);
    const deliveriesThisWeek = ongoing.filter((s) => s.materialDeliveryPlanned && s.materialDeliveryPlanned >= isoDay(new Date()) && s.materialDeliveryPlanned <= daysAgo(-7));
    const attention = [...ongoing]
      .filter((s) => s.late || s.openProblems > 0 || s.missingPictureDays > 0)
      .sort((a, b) => Number(b.late) - Number(a.late) || b.openProblems - a.openProblems || b.daysInStage - a.daysInStage)
      .slice(0, 10);
    return {
      ongoing: ongoing.length, completed: completed.length, docs: docs.length, late: late.length, problems, pictures,
      deliveriesThisWeek: deliveriesThisWeek.length, attention,
      short: stock?.items.filter((i) => Number(i.shortage) > 0).length ?? null,
      uncounted: stock?.items.filter((i) => !i.counted).length ?? null,
      reservations: stock?.reservations.length ?? null,
      reservedSites: stock ? new Set(stock.reservations.map((r) => r.executionId)).size : 0,
      advanceAwaiting: advance?.filter((a) => !a.confirmed_issuance_id).length ?? null,
    };
  }, [sites, stock, advance]);

  const tile = (count: number | null, label: string, target: DashboardTarget, tone?: "danger" | "warning") => (
    <button type="button" className="stage-card" onClick={() => onGo(target)} aria-label={`${label}: ${count ?? "loading"}`}>
      <strong style={tone === "danger" && count ? { color: "var(--pz-danger, #b42318)" } : undefined}>{count ?? "…"}</strong>
      <span>{label}</span>
    </button>
  );

  return (
    <div className="pz-stack">
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      <section className="pz-panel pz-stack">
        <h2>Sites</h2>
        <div className="stage-grid">
          {tile(m.ongoing, "Ongoing sites", "sites-ongoing")}
          {tile(m.late, `Late (over ${lateAfterDays} days in a stage)`, "sites-ongoing", "danger")}
          {tile(m.completed, "Completed in the last 30 days", "sites-completed")}
          {tile(m.docs, "Documentation issues", "sites-docs", "warning")}
          {tile(m.deliveriesThisWeek, "Material deliveries in the next 7 days", "sites-ongoing")}
        </div>
      </section>
      <section className="pz-panel pz-stack">
        <h2>Work on site</h2>
        <div className="stage-grid">
          {tile(m.problems, "Open problems", "sites-ongoing", "danger")}
          {tile(m.pictures, "Days without pictures", "sites-ongoing", "warning")}
          {tile(m.advanceAwaiting, "Advance BOQs awaiting PO", "operations")}
        </div>
      </section>
      <section className="pz-panel pz-stack">
        <h2>Stock</h2>
        <div className="stage-grid">
          {tile(m.short, "Items with a stock shortage", "stock", "danger")}
          {tile(m.reservations, `Reservations${m.reservedSites ? ` across ${m.reservedSites} site${m.reservedSites === 1 ? "" : "s"}` : ""}`, "reserved")}
          {tile(m.uncounted, "Items Store has not counted", "stock", "warning")}
        </div>
      </section>
      <section className="pz-panel pz-stack">
        <h2>Needs attention</h2>
        {m.attention.length === 0 ? <p>Nothing is late, no open problems and no missing pictures.</p> : (
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Site</th><th>Stage</th><th>Days</th><th>Open problems</th><th>Days without pictures</th><th>Delivery</th></tr></thead>
              <tbody>
                {m.attention.map((s) => (
                  <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => onOpenSite(s.id)}>
                    <td><strong>{s.siteName ?? "—"}</strong>{s.siteCode ? ` (${s.siteCode})` : ""}<br /><small>{s.customer ?? "—"}{s.region ? ` · ${s.region}` : ""}</small></td>
                    <td><StatusBadge tone={s.late ? "danger" : "pending"}>{s.stageLabel}</StatusBadge></td>
                    <td>{s.daysInStage}{s.late ? " · late" : ""}</td>
                    <td>{s.openProblems || "—"}</td>
                    <td>{s.missingPictureDays || "—"}</td>
                    <td>{fmt(s.materialDeliveryPlanned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p><small>Click a row to open the site. Figures refresh every minute.</small></p>
      </section>
    </div>
  );
}
