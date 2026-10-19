import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { GlobalSearch } from "../../components/GlobalSearch.js";
import { NotificationCenter } from "../../components/NotificationCenter.js";
import { hasDocIssue, shiftDays, type SiteRow } from "../site-workflow/stages.js";
import { SiteBoard } from "../site-workflow/SiteBoard.js";
import { OperationsHome, type HomeTarget } from "../site-workflow/OperationsHome.js";
import { SiteReport } from "../site-workflow/SiteReport.js";
import "./ops.css";

const Operations = lazy(() => import("../Operations.js").then((m) => ({ default: m.Operations })));
const PasswordChange = lazy(() => import("../Dashboard.js").then((m) => ({ default: m.PasswordChange })));

type View = "dashboard" | "operations" | "sites-new" | "sites-ongoing" | "sites-completed" | "sites-docs" | "sites" | "reports" | "account";
const VIEWS: View[] = ["dashboard", "operations", "sites-new", "sites-ongoing", "sites-completed", "sites-docs", "sites", "reports", "account"];
const PAGE: Record<Exclude<View, "dashboard">, { title: string; note: string }> = {
  operations: { title: "BOQ to Operations", note: "Advance BOQs received from Coordination, before and after the IPO. Click a row to open it." },
  "sites-new": { title: "New sites", note: "IPO received, planning not started." },
  "sites-ongoing": { title: "Ongoing sites", note: "Every site that is not closed, from IPO received to Doc dispatch." },
  "sites-completed": { title: "Sites completed (last 30 days)", note: "Sites closed in the last 30 days." },
  "sites-docs": { title: "Documentation issues", note: "Sites at Doc dispatch, or closed, still missing the DO date, acknowledgement, submission to the customer or customer sign-off." },
  sites: { title: "All sites", note: "Every site after its IPO." },
  reports: { title: "Site report", note: "Every site's stage and dates, cable variance against BOQ, and items used outside the quotation. Downloadable." },
  account: { title: "My account", note: "Your identity and access to the Operations workspace." },
};
const REGIONS = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan", "Azad Jammu and Kashmir", "Islamabad Capital Territory"];
const ICON = {
  dashboard: <svg className="i" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" /></svg>,
  boq: <svg className="i" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></svg>,
  plus: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>,
  site: <svg className="i" viewBox="0 0 24 24"><path d="M4 19h16M6 19V9l6-4 6 4v10" /><path d="M10 19v-5h4v5" /></svg>,
  done: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>,
  docs: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 16v.01" /></svg>,
  all: <svg className="i" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M9 5v14" /></svg>,
  report: <svg className="i" viewBox="0 0 24 24"><path d="M5 19V9M12 19V5M19 19v-7" /></svg>,
  account: <svg className="i" viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>,
  logout: <svg className="i" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
  key: <svg className="i" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="M10.9 12.1 20 3M15 8l3 3M18 5l3 3" /></svg>,
};

/**
 * The Operations login's own shell (Moaz, 19 Oct 2026): the AMC portal's layout with the V2 accent.
 * Header with the one search, bell and account; sidebar with a region scope and the menu with counts;
 * the same pages and data as before. No other login uses this.
 */
export function OperationsShell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [view, setView] = useState<View>("dashboard");
  const [region, setRegion] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [siteToOpen, setSiteToOpen] = useState<string>();
  const [siteNonce, setSiteNonce] = useState(0);
  const [stageToOpen, setStageToOpen] = useState<string>();
  const [advanceToOpen, setAdvanceToOpen] = useState<string>();
  const [advanceNonce, setAdvanceNonce] = useState(0);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [advanceCount, setAdvanceCount] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const go = useCallback((next: View) => { setView(next); setMenuOpen(false); window.scrollTo(0, 0); window.history.replaceState(null, "", `/dashboard#workspace=${next}`); }, []);
  const openSite = useCallback((id: string) => { setSiteToOpen(id); setSiteNonce((n) => n + 1); setStageToOpen(undefined); go("sites"); }, [go]);
  const openStage = useCallback((stage: string) => { setStageToOpen(stage); setSiteToOpen(undefined); go("sites"); }, [go]);
  const openHeadsUp = useCallback((reference: string) => { setAdvanceToOpen(reference); setAdvanceNonce((n) => n + 1); go("operations"); }, [go]);
  const onGo = useCallback((target: HomeTarget) => go(target), [go]);

  // Menu counts, refreshed every minute; the pages load their own data as before.
  const loadCounts = useCallback(async () => {
    const [s, a] = await Promise.all([
      api<{ sites: SiteRow[] }>("/site-workflow").catch(() => ({ sites: [] as SiteRow[] })),
      api<{ requests: { region?: string; confirmed_issuance_id: string | null }[] }>("/project-workflow/advance-inbox").catch(() => ({ requests: [] })),
    ]);
    setSites(s.sites);
    setAdvanceCount(a.requests.filter((r) => !region || (r.region || "") === region).length);
  }, [region]);
  useEffect(() => { void loadCounts(); const t = setInterval(() => void loadCounts(), 60_000); return () => clearInterval(t); }, [loadCounts, view]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc); return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const counts = useMemo(() => {
    const scoped = region ? sites.filter((s) => s.region === region) : sites;
    return {
      fresh: scoped.filter((s) => s.stage === "ipo_received").length,
      ongoing: scoped.filter((s) => s.stage !== "closed").length,
      completed: scoped.filter((s) => s.closedAt && s.closedAt.slice(0, 10) >= shiftDays(-30)).length,
      docs: scoped.filter(hasDocIssue).length,
      all: scoped.length,
    };
  }, [sites, region]);

  async function logout() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const current = await api<Session>("/auth/session");
      await api("/auth/logout", { body: {}, csrf: current.csrfToken });
      onLogout();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout();
      else setError(err instanceof Error ? err.message : "Could not sign out.");
    } finally { setBusy(false); }
  }
  const initials = session.user.displayName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const item = (key: View, label: string, icon: ReactElement, count?: number | null, hot = false) => (
    <button type="button" className={`ops-nav-item${view === key ? " active" : ""}`} aria-current={view === key ? "page" : undefined} onClick={() => go(key)}>
      {icon}<span>{label}</span>{count != null && <span className={`nb${hot && count > 0 ? " hot" : ""}`}>{count}</span>}
    </button>
  );

  return (
    <div className="ops">
      <header className="ops-hdr">
        <button type="button" className="ops-brand" aria-label="Power Zone — Dashboard" onClick={() => go("dashboard")}>
          <span className="mark"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg></span>
          <span>Power Zone<small>Operations</small></span>
        </button>
        <GlobalSearch session={session} onOpenSite={openSite} onOpenHeadsUp={openHeadsUp} />
        <div className="ops-hdr-r">
          <NotificationCenter session={session} onOpen={(target) => { if (typeof target === "string" && (VIEWS as string[]).includes(target)) go(target as View); }} />
          <div className="ops-avatar" ref={menuRef}>
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Account menu" onClick={() => setMenuOpen(!menuOpen)}>{initials || "PZ"}</button>
            {menuOpen && (
              <div className="ops-menu" role="menu">
                <div className="who"><strong>{session.user.displayName}</strong><small>{session.user.email} · {session.user.role}</small></div>
                <button type="button" role="menuitem" onClick={() => go("account")}>{ICON.account}My account</button>
                <button type="button" role="menuitem" onClick={() => { go("account"); window.dispatchEvent(new Event("pz:change-password")); }}>{ICON.key}Change password</button>
                <button type="button" role="menuitem" onClick={() => void logout()} disabled={busy}>{ICON.logout}{busy ? "Signing out…" : "Sign out"}</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="ops-body">
        <aside className="ops-side">
          <label className="ops-scope"><small>Showing</small>
            <select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All regions</option>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <svg className="i" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
          </label>
          <nav className="ops-nav" aria-label="Main">
            {item("dashboard", "Dashboard", ICON.dashboard)}
            <div className="ops-nav-label">Project operations</div>
            {item("operations", "BOQ to Operations", ICON.boq, advanceCount)}
            {item("sites-new", "New sites", ICON.plus, counts.fresh)}
            {item("sites-ongoing", "Ongoing sites", ICON.site, counts.ongoing)}
            {item("sites-completed", "Sites completed (30 days)", ICON.done, counts.completed)}
            {item("sites-docs", "Documentation issues", ICON.docs, counts.docs, true)}
            {item("sites", "All sites", ICON.all, counts.all)}
            {item("reports", "Site report", ICON.report)}
          </nav>
          <div className="ops-side-foot">Operations · Power Zone V2</div>
        </aside>
        <main className="ops-main">
          {error && <p className="ops-feedback" role="alert">{error}</p>}
          {view !== "dashboard" && (
            <div className="ops-page-head"><div><h2>{PAGE[view].title}</h2><p>{PAGE[view].note}{region ? ` Showing ${region} only.` : ""}</p></div></div>
          )}
          <Suspense fallback={<p className="ops-foot">Loading…</p>}>
            {view === "dashboard" && <OperationsHome session={session} onGo={onGo} onOpenSite={openSite} onOpenStage={openStage} regionScope={region} />}
            {view === "operations" && <Operations session={session} initialAdvanceReference={advanceToOpen} advanceNonce={advanceNonce} regionScope={region} />}
            {view === "sites" && <SiteBoard session={session} mode="all" variant="ops" initialSiteId={siteToOpen} initialSiteNonce={siteNonce} initialStage={stageToOpen} regionScope={region} />}
            {view === "sites-new" && <SiteBoard session={session} mode="new" variant="ops" regionScope={region} />}
            {view === "sites-ongoing" && <SiteBoard session={session} mode="ongoing" variant="ops" regionScope={region} />}
            {view === "sites-completed" && <SiteBoard session={session} mode="completed" variant="ops" regionScope={region} />}
            {view === "sites-docs" && <SiteBoard session={session} mode="docs" variant="ops" regionScope={region} />}
            {view === "reports" && <SiteReport session={session} regionScope={region} />}
            {view === "account" && (
              <div className="ops-account">
                <section className="pz-panel pz-stack">
                  <h3>Your account</h3>
                  <div className="ops-kv">
                    <div><span>Name</span><b>{session.user.displayName}</b></div>
                    <div><span>Email</span><b>{session.user.email}</b></div>
                    <div><span>Role</span><b>{session.user.role}</b></div>
                  </div>
                  <div><button type="button" className="pz-button pz-button--neutral" onClick={() => void api<{ message: string }>("/accounts/verify-email", { body: {}, csrf: session.csrfToken }).then((r) => setError(r.message)).catch((e) => setError(e.message))}>Verify my email</button></div>
                </section>
                <section className="pz-panel pz-stack">
                  <h3>Change password</h3>
                  <PasswordChange session={session} onChanged={onLogout} />
                </section>
              </div>
            )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
