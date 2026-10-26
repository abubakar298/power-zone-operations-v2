import { lazy, Suspense, useEffect, useRef, useState, type ReactElement } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { NotificationCenter } from "../../components/NotificationCenter.js";
import "../ops/ops.css";
import "../../components/global-search.css";
import "../procurement/procurement.css";
import { QcSites } from "./QcSites.js";
import { QcKpi } from "./QcKpi.js";

const PasswordChange = lazy(() => import("../Dashboard.js").then((m) => ({ default: m.PasswordChange })));
type View = "sites" | "kpi" | "account";
const VIEWS: View[] = ["sites", "kpi", "account"];
const PAGE: Record<View, { title: string; note: string }> = {
  sites: { title: "Site documents", note: "Attach and submit each site's DCs, delivery and installation pictures, reports and acknowledgement as soon as they arrive. Pictures are shrunk before upload." },
  kpi: { title: "My KPI", note: "Delivery papers by 12:00 on the next working day (Mon–Fri); BESS installation papers within 3 days of BESS delivery." },
  account: { title: "My account", note: "Your identity and password." },
};
const I = {
  sites: <svg className="i" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></svg>,
  kpi: <svg className="i" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  account: <svg className="i" viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>,
  out: <svg className="i" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
};

/** The Quality Control login's own workspace (Moaz, 26 Oct 2026): site documents, KPI and account, nothing else. */
export function QcShell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [view, setView] = useState<View>(() => {
    const wanted = new URLSearchParams(window.location.hash.slice(1)).get("workspace");
    return wanted && (VIEWS as string[]).includes(wanted) ? (wanted as View) : "sites";
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [red, setRed] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const go = (next: View) => { setView(next); setMenuOpen(false); window.scrollTo(0, 0); window.history.replaceState(null, "", `/dashboard#workspace=${next}`); };
  useEffect(() => {
    const count = () => void api<{ sites: { qc: { red: boolean } }[] }>("/qc/sites").then((r) => setRed(r.sites.filter((s) => s.qc.red).length)).catch(() => undefined);
    count(); const t = setInterval(count, 120_000); return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc); return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  async function logout() {
    if (busy) return;
    setBusy(true);
    try { const current = await api<Session>("/auth/session"); await api("/auth/logout", { body: {}, csrf: current.csrfToken }); onLogout(); }
    catch (err) { if (err instanceof ApiError && err.status === 401) onLogout(); else setError(err instanceof Error ? err.message : "Could not sign out."); }
    finally { setBusy(false); }
  }
  const initials = session.user.displayName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const item = (key: View, label: string, icon: ReactElement, count?: number | null) => (
    <button type="button" className={`ops-nav-item${view === key ? " active" : ""}`} aria-current={view === key ? "page" : undefined} onClick={() => go(key)}>
      {icon}<span>{label}</span>{count != null && count > 0 && <span className="nb hot">{count}</span>}
    </button>
  );
  return (
    <div className="ops">
      <header className="ops-hdr">
        <button type="button" className="ops-brand" aria-label="Power Zone — Site documents" onClick={() => go("sites")}>
          <span className="mark"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg></span>
          <span>Power Zone<small>Quality Control</small></span>
        </button>
        <div />
        <div className="ops-hdr-r">
          <NotificationCenter session={session} onOpen={() => go("sites")} />
          <div className="ops-avatar" ref={menuRef}>
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Account menu" onClick={() => setMenuOpen(!menuOpen)}>{initials || "QC"}</button>
            {menuOpen && (
              <div className="ops-menu" role="menu">
                <div className="who"><strong>{session.user.displayName}</strong><small>{session.user.email} · Quality Control</small></div>
                <button type="button" role="menuitem" onClick={() => go("account")}>{I.account}My account</button>
                <button type="button" role="menuitem" onClick={() => void logout()} disabled={busy}>{I.out}{busy ? "Signing out…" : "Sign out"}</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="ops-body">
        <aside className="ops-side">
          <nav className="ops-nav" aria-label="Main">
            <div className="ops-nav-label">Quality Control</div>
            {item("sites", "Site documents", I.sites, red)}
            {item("kpi", "My KPI", I.kpi)}
          </nav>
          <div className="ops-side-foot">Quality Control · Power Zone V2</div>
        </aside>
        <main className="ops-main">
          {error && <p className="ops-feedback" role="alert">{error}</p>}
          <div className="ops-page-head"><div><h2>{PAGE[view].title}</h2><p>{PAGE[view].note}</p></div></div>
          {view === "sites" && <QcSites session={session} mode="upload" />}
          {view === "kpi" && <QcKpi />}
          {view === "account" && (
            <div className="ops-account">
              <section className="pz-panel pz-stack">
                <h3>Your account</h3>
                <div className="ops-kv"><div><span>Name</span><b>{session.user.displayName}</b></div><div><span>Email</span><b>{session.user.email}</b></div><div><span>Workspace</span><b>Quality Control</b></div></div>
              </section>
              <section className="pz-panel pz-stack"><h3>Change password</h3><Suspense fallback={null}><PasswordChange session={session} onChanged={onLogout} /></Suspense></section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
