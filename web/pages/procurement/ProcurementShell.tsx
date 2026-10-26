import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { NotificationCenter } from "../../components/NotificationCenter.js";
import { PurchaseRequests } from "./PurchaseRequests.js";
import { MiscSites } from "./MiscSites.js";
import "../ops/ops.css";
import "../../components/global-search.css";
import "./procurement.css";
import { fmtAt, fmtDay, fmtShort, pkr, qty, relDay, shiftDays, short, stageText, STATUS_CHIP, type InventoryRow, type Overview, type RequestDetail } from "./types.js";

const PasswordChange = lazy(() => import("../Dashboard.js").then((m) => ({ default: m.PasswordChange })));
type View = "dashboard" | "received" | "upcoming" | "stock" | "misc" | "requests" | "account";
const VIEWS: View[] = ["dashboard", "received", "upcoming", "stock", "misc", "requests", "account"];
const PAGE: Record<Exclude<View, "dashboard">, { title: string; note: string }> = {
  received: { title: "POs received", note: "Every site with a customer PO and an IPO. Material is checked against stock, oldest PO first." },
  upcoming: { title: "Upcoming POs", note: "Heads-up BOQs from Coordination whose customer PO has not arrived yet. Their material counts into what to buy." },
  stock: { title: "Inventory status", note: "What Store has, what the received and upcoming POs need, what is on order, and what is left to buy." },
  misc: { title: "Misc items", note: "Misc items BOQs filled by Design with the survey report, site by site. Store sends them to site; until then they count into what to buy." },
  requests: { title: "Purchase requests", note: "Needed items go on a request, vendors quote, Abu Bakar approves, you order, Store receives." },
  account: { title: "My account", note: "Your identity and access to the Procurement workspace." },
};
const REGIONS = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan", "Azad Jammu and Kashmir", "Islamabad Capital Territory"];
const I = {
  dashboard: <svg className="i" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" /></svg>,
  po: <svg className="i" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></svg>,
  clock: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  box: <svg className="i" viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>,
  misc: <svg className="i" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="19" cy="18" r="2" /></svg>,
  req: <svg className="i" viewBox="0 0 24 24"><path d="M9 5h6l1 2h3v13H5V7h3z" /><path d="M9 13l2 2 4-4" /></svg>,
  account: <svg className="i" viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>,
  key: <svg className="i" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="M10.9 12.1 20 3M15 8l3 3M18 5l3 3" /></svg>,
  out: <svg className="i" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
  info: <svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 16v.01" /></svg>,
};
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const firstName = (n: string) => n.split(/\s+/)[0] || n;
const siteLabel = (n: string | null, c: string | null) => `${n ?? "Site"}${c ? ` (${c})` : ""}`;
const inventoryStatus = (i: InventoryRow) =>
  !i.boughtByBuyer ? { cls: "sw-chip", text: "Not bought by Procurement" }
  : Number(i.toBuy) > 0 && i.shortForReceived ? { cls: "sw-chip sw-chip--danger", text: "Short for received POs" }
  : Number(i.toBuy) > 0 ? { cls: "sw-chip sw-chip--danger", text: "To buy" }
  : Number(i.onOrder) > 0 ? { cls: "sw-chip sw-chip--warning", text: "On order" }
  : Number(i.requested) > 0 ? { cls: "sw-chip sw-chip--warning", text: "On a request" }
  : { cls: "sw-chip sw-chip--ok", text: "Enough" };

/**
 * The Procurement buyer's own shell (Moaz, 20 Oct 2026): POs received, upcoming POs, inventory status and
 * purchase requests. Same look as the Operations shell; nothing from the Operations workspace is in it.
 */
export function ProcurementShell({ session, onLogout, viewingAs, onReturn }: { session: Session; onLogout: () => void; viewingAs?: string; onReturn?: () => void }) {
  const [view, setView] = useState<View>(() => {
    const wanted = new URLSearchParams(window.location.hash.slice(1)).get("workspace");
    return wanted && (VIEWS as string[]).includes(wanted) ? (wanted as View) : "dashboard";
  });
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [region, setRegion] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openRequest, setOpenRequest] = useState<string>();
  const menuRef = useRef<HTMLDivElement>(null);

  const go = useCallback((next: View) => { setView(next); setMenuOpen(false); window.scrollTo(0, 0); window.history.replaceState(null, "", `/dashboard#workspace=${next}`); }, []);
  const load = useCallback(async () => {
    try { setData(await api<Overview>("/procurement/overview")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load the Procurement workspace."); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc); return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const openReq = useCallback((id: string) => { setOpenRequest(id); go("requests"); }, [go]);
  const fromToBuy = async () => {
    setBusy(true);
    try { const r = await api<RequestDetail>("/procurement/requests/from-to-buy", { body: {}, csrf: session.csrfToken }); void load(); openReq(r.id); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The request was not created."); }
    finally { setBusy(false); }
  };

  const scoped = useMemo(() => {
    if (!data) return null;
    const inRegion = (r: string | null) => !region || r === region;
    return { ...data, receivedPOs: data.receivedPOs.filter((p) => inRegion(p.region)), upcoming: data.upcoming.filter((u) => inRegion(u.region)) };
  }, [data, region]);
  const counts = useMemo(() => ({
    received: scoped?.receivedPOs.filter((p) => p.pending).length ?? null,
    upcoming: scoped?.upcoming.length ?? null,
    toBuy: data?.inventory.filter((i) => i.boughtByBuyer && Number(i.toBuy) > 0).length ?? null,
    requests: data?.requests.filter((r) => ["draft", "pending_approval", "approved", "ordered"].includes(r.status)).length ?? null,
  }), [scoped, data]);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try { const current = await api<Session>("/auth/session"); await api("/auth/logout", { body: {}, csrf: current.csrfToken }); onLogout(); }
    catch (err) { if (err instanceof ApiError && err.status === 401) onLogout(); else setError(err instanceof Error ? err.message : "Could not sign out."); }
    finally { setBusy(false); }
  }
  const initials = session.user.displayName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const item = (key: View, label: string, icon: ReactElement, count?: number | null, hot = false) => (
    <button type="button" className={`ops-nav-item${view === key ? " active" : ""}`} aria-current={view === key ? "page" : undefined} onClick={() => { if (key === "requests") setOpenRequest(undefined); go(key); }}>
      {icon}<span>{label}</span>{count != null && <span className={`nb${hot && count > 0 ? " hot" : ""}`}>{count}</span>}
    </button>
  );

  return (
    <div className="ops">
      <header className="ops-hdr">
        <button type="button" className="ops-brand" aria-label="Power Zone — Dashboard" onClick={() => go("dashboard")}>
          <span className="mark"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg></span>
          <span>Power Zone<small>Procurement</small></span>
        </button>
        <ProcSearch data={data} onGo={(v) => go(v)} onOpenRequest={openReq} />
        <div className="ops-hdr-r">
          <NotificationCenter session={session} onOpen={() => undefined} />
          <div className="ops-avatar" ref={menuRef}>
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Account menu" onClick={() => setMenuOpen(!menuOpen)}>{initials || "PZ"}</button>
            {menuOpen && (
              <div className="ops-menu" role="menu">
                <div className="who"><strong>{session.user.displayName}</strong><small>{session.user.email} · Procurement{viewingAs ? ` · viewed by ${viewingAs}` : ""}</small></div>
                {onReturn && <button type="button" role="menuitem" onClick={onReturn}>{I.out}Return to Management</button>}
                <button type="button" role="menuitem" onClick={() => go("account")}>{I.account}My account</button>
                <button type="button" role="menuitem" onClick={() => { go("account"); window.dispatchEvent(new Event("pz:change-password")); }}>{I.key}Change password</button>
                {!onReturn && <button type="button" role="menuitem" onClick={() => void logout()} disabled={busy}>{I.out}{busy ? "Signing out…" : "Sign out"}</button>}
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
            {item("dashboard", "Dashboard", I.dashboard)}
            <div className="ops-nav-label">Procurement</div>
            {item("received", "POs received", I.po, counts.received)}
            {item("upcoming", "Upcoming POs", I.clock, counts.upcoming)}
            {item("stock", "Inventory status", I.box, counts.toBuy, true)}
            {item("misc", "Misc items", I.misc)}
            {item("requests", "Purchase requests", I.req, counts.requests)}
          </nav>
          <div className="ops-side-foot">Procurement · Power Zone V2</div>
        </aside>
        <main className="ops-main">
          {error && <p className="ops-feedback" role="alert">{error}</p>}
          {view !== "dashboard" && <div className="ops-page-head"><div><h2>{PAGE[view].title}</h2><p>{PAGE[view].note}{region && view !== "stock" && view !== "misc" && view !== "requests" && view !== "account" ? ` Showing ${region} only.` : ""}</p></div></div>}
          {!scoped && view !== "account" && view !== "requests" && view !== "misc" ? <p className="ops-foot">Loading…</p> : (
            <>
              {view === "dashboard" && scoped && <Home session={session} data={scoped} region={region} onGo={go} onOpenRequest={openReq} />}
              {view === "received" && scoped && <ReceivedPage data={scoped} />}
              {view === "upcoming" && scoped && <UpcomingPage data={scoped} />}
              {view === "stock" && scoped && <StockPage data={scoped} busy={busy} onFromToBuy={() => void fromToBuy()} />}
            </>
          )}
          {view === "misc" && <MiscSites session={session} mode="buyer" />}
          {view === "requests" && <PurchaseRequests session={session} mode="buyer" openId={openRequest} onOpened={() => undefined} onChanged={() => void load()} key={openRequest ?? "list"} />}
          {view === "account" && (
            <div className="ops-account">
              <section className="pz-panel pz-stack">
                <h3>Your account</h3>
                <div className="ops-kv"><div><span>Name</span><b>{session.user.displayName}</b></div><div><span>Email</span><b>{session.user.email}</b></div><div><span>Workspace</span><b>Procurement</b></div></div>
              </section>
              <section className="pz-panel pz-stack"><h3>Change password</h3><Suspense fallback={null}><PasswordChange session={session} onChanged={onLogout} /></Suspense></section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ProcSearch({ data, onGo, onOpenRequest }: { data: Overview | null; onGo: (v: View) => void; onOpenRequest: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc); return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || !data) return [];
    const match = (...f: (string | null)[]) => { const h = f.join(" ").toLowerCase(); return words.every((w) => h.includes(w)); };
    return [
      ...data.requests.filter((r) => match(r.number, r.title, r.vendors)).slice(0, 5).map((r) => ({ key: `r${r.id}`, group: "Purchase requests", title: `${r.number} · ${r.title}`, sub: `${r.statusLabel} · ${r.lines} items`, act: () => onOpenRequest(r.id) })),
      ...data.receivedPOs.filter((p) => match(p.siteName, p.siteCode, p.customer, p.ipoNumber, p.region)).slice(0, 5).map((p) => ({ key: `p${p.issuanceId}`, group: "POs received", title: siteLabel(p.siteName, p.siteCode), sub: `${p.customer ?? ""} · IPO ${p.ipoNumber}`, act: () => onGo("received") })),
      ...data.upcoming.filter((u) => match(u.siteName, u.siteCode, u.customer, u.reference, u.region)).slice(0, 5).map((u) => ({ key: `u${u.recordId}${u.reference}`, group: "Upcoming POs", title: siteLabel(u.siteName, u.siteCode), sub: `${u.customer ?? ""} · ${u.reference}`, act: () => onGo("upcoming") })),
      ...data.inventory.filter((i) => match(i.name, i.itemKey)).slice(0, 5).map((i) => ({ key: `i${i.itemKey}`, group: "Inventory", title: i.name, sub: `in stock ${qty(i.inStock)} · to buy ${qty(i.toBuy)} ${i.unit}`, act: () => onGo("stock") })),
    ];
  }, [q, data, onGo, onOpenRequest]);
  const groups = [...new Set(hits.map((h) => h.group))];
  return (
    <div className="gs" ref={root} role="search">
      <label className="gs-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" value={q} placeholder="Search POs, sites, items, requests…" aria-label="Search the Procurement workspace" autoComplete="off"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { hits[0].act(); setOpen(false); setQ(""); } if (e.key === "Escape") setOpen(false); }} />
      </label>
      {open && q.trim() && (
        <div className="gs-menu" role="listbox">
          {hits.length === 0 ? <p className="gs-empty">Nothing matches.</p> : groups.map((g) => (
            <div key={g}>
              <div className="gs-group">{g}</div>
              {hits.filter((h) => h.group === g).map((h) => <button type="button" key={h.key} className="gs-item" onClick={() => { h.act(); setOpen(false); setQ(""); }}><span><strong>{h.title}</strong><small>{h.sub}</small></span></button>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Home({ session, data, region, onGo, onOpenRequest }: { session: Session; data: Overview; region: string; onGo: (v: View) => void; onOpenRequest: (id: string) => void }) {
  const t = shiftDays(0), soon = shiftDays(14);
  const buyable = data.inventory.filter((i) => i.boughtByBuyer);
  const toBuy = buyable.filter((i) => Number(i.toBuy) > 0);
  const shortNow = toBuy.filter((i) => i.shortForReceived);
  const pendingPos = data.receivedPOs.filter((p) => p.pending);
  const withAbuBakar = data.requests.filter((r) => r.status === "pending_approval");
  const posSoon = data.upcoming.filter((u) => u.expectedDate && u.expectedDate >= t && u.expectedDate <= soon);
  const deliveriesSoon = pendingPos.filter((p) => p.expectedDelivery && p.expectedDelivery <= soon).sort((a, b) => (a.expectedDelivery ?? "").localeCompare(b.expectedDelivery ?? ""));
  const activeRequests = data.requests.filter((r) => ["pending_approval", "approved", "ordered"].includes(r.status)).slice(0, 4);
  const bars = [...buyable].map((i) => ({ i, need: Number(i.receivedNeed) + Number(i.upcomingNeed) })).filter((x) => x.need > 0).sort((a, b) => b.need - a.need).slice(0, 7);
  const lastCount = data.inventory.map((i) => i.lastCountAt).filter(Boolean).sort().at(-1) ?? null;
  return (
    <div>
      <div className="ops-welcome">
        <div><h1>{greeting()}, {firstName(session.user.displayName)}.</h1><p>What has been ordered, what is coming, and what to buy · {fmtDay(t)}{region ? ` · ${region} only` : ""}</p></div>
        <span className="ops-pill">{lastCount ? `Last stock count ${fmtAt(lastCount)}` : "No stock count yet"}</span>
      </div>
      <div className="ops-kgrid">
        <button type="button" className="ops-card ops-kc" onClick={() => onGo("received")}>
          <div className="ops-kc-top"><span className="ops-kc-ic hot">{I.po}</span><span className={`ops-trend${pendingPos.some((p) => p.material === "short") ? " bad" : ""}`}>{pendingPos.filter((p) => p.material === "short").length} short of material</span></div>
          <div className="ops-kc-l">POs received</div><div className="ops-kc-v">{pendingPos.length}</div><div className="ops-kc-p">awaiting material · {data.receivedPOs.length - pendingPos.length} delivered</div>
        </button>
        <button type="button" className="ops-card ops-kc" onClick={() => onGo("upcoming")}>
          <div className="ops-kc-top"><span className="ops-kc-ic">{I.clock}</span><span className="ops-trend">{posSoon.length} expected in 14 days</span></div>
          <div className="ops-kc-l">Upcoming POs</div><div className="ops-kc-v">{data.upcoming.length}</div><div className="ops-kc-p">heads-ups from Coordination, PO not yet received</div>
        </button>
        <button type="button" className="ops-card ops-kc" onClick={() => onGo("stock")}>
          <div className="ops-kc-top"><span className="ops-kc-ic">{I.box}</span><span className={`ops-trend${shortNow.length ? " bad" : ""}`}>{shortNow.length} short for received POs</span></div>
          <div className="ops-kc-l">Items to buy</div><div className="ops-kc-v">{toBuy.length}</div><div className="ops-kc-p">of {buyable.length} items you buy, to cover every coming site</div>
        </button>
        <button type="button" className="ops-card ops-kc" onClick={() => onGo("requests")}>
          <div className="ops-kc-top"><span className="ops-kc-ic">{I.req}</span><span className="ops-trend">PKR {short(withAbuBakar.reduce((s, r) => s + Number(r.total), 0))} with Abu Bakar</span></div>
          <div className="ops-kc-l">Awaiting approval</div><div className="ops-kc-v">{withAbuBakar.length}</div><div className="ops-kc-p">{withAbuBakar[0] ? `${withAbuBakar[0].number} · ${withAbuBakar[0].lines} items` : "nothing waiting"}</div>
        </button>
      </div>

      <div className="ops-dgrid">
        <section className="ops-card ops-sc">
          <div className="ops-sc-h"><h3>Stock against coming sites</h3><button type="button" className="ops-link" onClick={() => onGo("stock")}>Inventory status →</button></div>
          {bars.length === 0 ? <p className="pr-muted">No received or upcoming POs need stock right now.</p> : (
            <div className="pc-bars">
              {bars.map(({ i, need }) => {
                const have = Number(i.inStock), pct = Math.min(100, Math.round((have / need) * 100));
                return (
                  <div className="pc-bar" key={i.itemKey}>
                    <div className="bl"><span>{i.name} <small>· {qty(i.receivedNeed)} for received, {qty(i.upcomingNeed)} for upcoming</small></span><b>{qty(have)} of {qty(need)} {i.unit}</b></div>
                    <div className="pc-track"><i className={have >= Number(i.receivedNeed) && have < need ? "warn" : ""} style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="pc-legend"><span><i style={{ background: "var(--ops-good)" }} />in stock</span><span><i style={{ background: "#f59e0b" }} />enough for received POs only</span><span><i style={{ background: "var(--ops-crit-soft)", border: "1px solid var(--ops-crit-line)" }} />still to buy</span></div>
        </section>
        <section className="ops-card ops-sc">
          <div className="ops-sc-h"><h3>Coming up</h3><span className="count">next 14 days</span></div>
          <div className="ops-list">
            <h4>POs expected</h4>
            {posSoon.length === 0 ? <p>No customer PO expected in the next 14 days.</p> : posSoon.slice(0, 5).map((u) => (
              <button type="button" key={`${u.recordId}${u.reference}`} onClick={() => onGo("upcoming")}><span>{siteLabel(u.siteName, u.siteCode)}<small>{u.customer ?? ""}{u.region ? ` · ${u.region}` : ""} · {u.items} items</small></span><span className="when">{relDay(u.expectedDate!)}</span></button>
            ))}
            <h4>Purchase requests</h4>
            {activeRequests.length === 0 ? <p>No request in progress.</p> : activeRequests.map((r) => (
              <button type="button" key={r.id} onClick={() => onOpenRequest(r.id)}><span>{r.number} · {r.title}<small>{r.lines} items · PKR {pkr(r.total)} · {r.statusLabel}</small></span><span className="when">{fmtShort(r.updatedAt.slice(0, 10))}</span></button>
            ))}
            <h4>Material needed on site</h4>
            {deliveriesSoon.length === 0 ? <p>No delivery expected in the next 14 days.</p> : deliveriesSoon.slice(0, 5).map((p) => (
              <button type="button" key={p.issuanceId} onClick={() => onGo("received")}><span>{siteLabel(p.siteName, p.siteCode)}<small>{p.material === "short" ? `short: ${p.shortItems.slice(0, 3).join(", ")}` : "material ready"}</small></span><span className="when">{relDay(p.expectedDelivery!)}</span></button>
            ))}
          </div>
        </section>
      </div>

      <section className="ops-card">
        <div className="ops-tc-h"><h3>Latest POs received</h3><button type="button" className="ops-link" onClick={() => onGo("received")}>All POs →</button></div>
        <ReceivedTable rows={data.receivedPOs.slice(0, 5)} />
      </section>
    </div>
  );
}

function ReceivedTable({ rows }: { rows: Overview["receivedPOs"] }) {
  // Each PO opens to show its details and every item that has to go to the site (Moaz, 26 Oct 2026).
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="pz-table-scroll">
      <table className="ops-table">
        <thead><tr><th>Site</th><th>Customer</th><th>Region</th><th>PO date</th><th className="num">Items</th><th>Delivery</th><th>Material</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className="ops-empty">No POs received.</td></tr> : rows.flatMap((p) => [
            <tr key={p.issuanceId}>
              <td className="site"><b>{siteLabel(p.siteName, p.siteCode)}</b><small>IPO {p.ipoNumber}{p.poNumber ? ` · PO ${p.poNumber}` : ""} · <button type="button" className="sw-link" aria-expanded={open === p.issuanceId} onClick={() => setOpen(open === p.issuanceId ? null : p.issuanceId)}>{open === p.issuanceId ? "Hide items" : `Items (${p.lines.length})`}</button></small></td>
              <td>{p.customer ?? "—"}</td><td>{p.region ?? "—"}</td><td className="date">{fmtDay(p.poDate)}</td><td className="num">{p.items}</td>
              <td className="date">{p.deliveredOn ? `delivered ${fmtShort(p.deliveredOn)}` : p.expectedDelivery ? `expected ${fmtShort(p.expectedDelivery)}` : "not planned"}</td>
              <td>{p.material === "delivered" ? <span className="sw-chip sw-chip--ok">Delivered</span>
                : p.material === "short" ? <span className="sw-chip sw-chip--warning" title={p.shortItems.join(", ")}>Short: {p.shortItems.slice(0, 2).join(", ")}{p.shortItems.length > 2 ? ` +${p.shortItems.length - 2}` : ""}</span>
                : <span className="sw-chip">Ready to deliver</span>}</td>
            </tr>,
            ...(open === p.issuanceId ? [
              <tr key={`${p.issuanceId}-items`} className="sw-open">
                <td colSpan={7}>
                  <div className="pr-po">
                    <div className="ops-kv">
                      <div><span>Customer PO</span><b>{p.poNumber ?? "not recorded"}</b></div>
                      <div><span>PO date</span><b>{fmtDay(p.poDate)}</b></div>
                      <div><span>Delivery wanted</span><b>{p.poDeliveryDate ? fmtDay(p.poDeliveryDate) : "not given"}</b></div>
                      <div><span>Deliver to</span><b>{p.deliveryAddress ?? "not given"}</b></div>
                    </div>
                    <table className="ops-table">
                      <thead><tr><th>Item</th><th className="num">Quantity</th><th>Material</th></tr></thead>
                      <tbody>{p.lines.length === 0 ? <tr><td colSpan={3} className="ops-empty">No material lines on this PO.</td></tr> : p.lines.map((l) => (
                        <tr key={l.itemKey}>
                          <td className="site"><b>{l.name}</b><small>{l.itemKey}{l.misc ? " · misc item" : ""}</small></td>
                          <td className="num">{qty(l.quantity)} {l.unit}</td>
                          <td>{!p.pending ? <span className="sw-chip sw-chip--ok">Delivered</span> : l.short ? <span className="sw-chip sw-chip--warning">Short</span> : <span className="sw-chip">In stock</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </td>
              </tr>,
            ] : []),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function ReceivedPage({ data }: { data: Overview }) {
  const [tab, setTab] = useState("all");
  const tabs = [
    { key: "all", label: "All", f: () => true },
    { key: "short", label: "Material short", f: (p: Overview["receivedPOs"][number]) => p.material === "short" },
    { key: "ready", label: "Ready to deliver", f: (p: Overview["receivedPOs"][number]) => p.material === "ready" },
    { key: "delivered", label: "Delivered", f: (p: Overview["receivedPOs"][number]) => p.material === "delivered" },
  ];
  const rows = data.receivedPOs.filter(tabs.find((t) => t.key === tab)!.f);
  return (
    <section className="ops-card">
      <div className="ops-tabs">{tabs.map((t) => <button type="button" key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label} <span className="n">{data.receivedPOs.filter(t.f).length}</span></button>)}</div>
      <ReceivedTable rows={rows} />
    </section>
  );
}

function UpcomingPage({ data }: { data: Overview }) {
  const [stage, setStage] = useState("");
  const stages = [...new Set(data.upcoming.map((u) => u.workflowStage ?? ""))].filter(Boolean);
  const rows = data.upcoming.filter((u) => !stage || u.workflowStage === stage);
  return (
    <section className="ops-card">
      <div className="ops-tabs">
        <button type="button" aria-pressed={!stage} onClick={() => setStage("")}>All <span className="n">{data.upcoming.length}</span></button>
        {stages.map((s) => <button type="button" key={s} aria-pressed={stage === s} onClick={() => setStage(s)}>{stageText(s)} <span className="n">{data.upcoming.filter((u) => u.workflowStage === s).length}</span></button>)}
      </div>
      <div className="pz-table-scroll">
        <table className="ops-table">
          <thead><tr><th>Site</th><th>Customer</th><th>Region</th><th>Stage</th><th>PO expected</th><th className="num">Items</th><th>Big items</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="ops-empty">No upcoming POs.</td></tr> : rows.map((u) => (
              <tr key={`${u.recordId}${u.reference}`}>
                <td className="site"><b>{siteLabel(u.siteName, u.siteCode)}</b><small>{u.reference}</small></td>
                <td>{u.customer ?? "—"}</td><td>{u.region ?? "—"}</td><td>{stageText(u.workflowStage)}</td><td className="date">{fmtDay(u.expectedDate)}</td><td className="num">{u.items}</td>
                <td className="pr-muted">{[Number(u.bigItems.panels) ? `${qty(u.bigItems.panels)} panels` : "", Number(u.bigItems.batteries) ? `${qty(u.bigItems.batteries)} batteries` : "", Number(u.bigItems.inverters) ? `${qty(u.bigItems.inverters)} inverter${Number(u.bigItems.inverters) === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StockPage({ data, busy, onFromToBuy }: { data: Overview; busy: boolean; onFromToBuy: () => void }) {
  const [tab, setTab] = useState("all");
  const tabs = [
    { key: "all", label: "All items", f: () => true },
    { key: "buy", label: "To buy", f: (i: InventoryRow) => i.boughtByBuyer && Number(i.toBuy) > 0 },
    { key: "short", label: "Short for received POs", f: (i: InventoryRow) => i.boughtByBuyer && i.shortForReceived },
    { key: "order", label: "On order or requested", f: (i: InventoryRow) => Number(i.onOrder) > 0 || Number(i.requested) > 0 },
    { key: "enough", label: "Enough", f: (i: InventoryRow) => i.boughtByBuyer && Number(i.toBuy) === 0 },
    { key: "misc", label: "Misc items", f: (i: InventoryRow) => i.misc },
    { key: "others", label: "Not bought by Procurement", f: (i: InventoryRow) => !i.boughtByBuyer },
  ];
  // Main stock first; misc site items follow under their own divider (Moaz, 24 Oct 2026).
  const rows = data.inventory.filter(tabs.find((t) => t.key === tab)!.f).sort((a, b) => Number(a.misc) - Number(b.misc));
  const firstMisc = rows.findIndex((i) => i.misc);
  return (
    <div className="pr">
      <div className="ops-banner">{I.info}To buy = received POs need + upcoming POs need − in stock − on order − already on a request. In stock = Store's latest count plus anything received after it; only Store changes counts. Batteries, BMS and inverters are shown for information; they are not bought through Procurement. Inventory covers all regions.</div>
      <div className="pr-actions"><Button variant="primary" loading={busy} disabled={!data.inventory.some((i) => i.boughtByBuyer && i.inRateMaster && Number(i.toBuy) > 0)} onClick={onFromToBuy}>Make a purchase request from "To buy"</Button></div>
      <section className="ops-card">
        <div className="ops-tabs">{tabs.map((t) => <button type="button" key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label} <span className="n">{data.inventory.filter(t.f).length}</span></button>)}</div>
        <div className="pz-table-scroll">
          <table className="ops-table">
            <thead><tr><th>Item</th><th className="num">In stock</th><th className="num">Received POs need</th><th className="num">Upcoming POs need</th><th className="num">On order</th><th className="num">On a request</th><th className="num">To buy</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={8} className="ops-empty">No items here.</td></tr> : rows.flatMap((i, n) => {
                const st = inventoryStatus(i);
                return [
                  ...(n === firstMisc ? [<tr key="misc-divider" className="pr-divider"><td colSpan={8}>Misc items <small>small site items from Design's misc items BOQs</small></td></tr>] : []),
                  <tr key={i.itemKey}>
                    <td className="site"><b>{i.name}</b><small>{i.misc ? "Misc item · " : ""}{i.unit}{i.lastCountAt ? ` · counted ${fmtAt(i.lastCountAt)}` : " · not counted yet"}{!i.inRateMaster ? " · not in the rate master" : ""}{i.unitMismatch ? ` · counted in ${i.stockUnit}` : ""}</small></td>
                    <td className="num">{qty(i.inStock)}</td>
                    <td className="num">{qty(i.receivedNeed)}</td><td className="num">{qty(i.upcomingNeed)}</td><td className="num">{qty(i.onOrder)}</td><td className="num">{qty(i.requested)}</td>
                    <td className="num"><b>{i.boughtByBuyer ? qty(i.toBuy) : "—"}</b></td>
                    <td><span className={st.cls}>{st.text}</span></td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
