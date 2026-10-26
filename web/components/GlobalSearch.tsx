import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Session } from "../api.js";
import "./global-search.css";
import { STAGE_COLOURS, STAGE_LABELS, stageInk, type StageKey } from "../pages/site-workflow/stages.js";

interface SiteHit { id: string; siteName: string | null; siteCode: string | null; customer: string | null; region: string | null; stage: StageKey; stageLabel: string; ipoNumber: string; boqNumber: string }
interface HeadsUpHit { reference: string; recordId: string; customer: string; site: string; siteCode: string; region: string; stage: string; final: boolean }
type Hit = { kind: "site"; site: SiteHit } | { kind: "headsup"; headsUp: HeadsUpHit };

const WORKFLOW_STAGES: Record<string, string> = {
  request_review: "Survey request", survey_requested: "Survey requested", survey_scheduled: "Survey scheduled", report_received: "Report received",
  technical_review: "Technical review", design_handed_off: "Design review", management_review: "Management review", commercial_revision: "Revisions",
  approved_dispatch: "Ready to send", customer_tracking: "Customer follow-up", advance_pending: "Advance planning", po_receipt: "PO receipt",
  order_exception: "Order exception", issued: "Issued", deferred: "Deferred", declined: "Declined",
};
const norm = (v: unknown) => String(v ?? "").toLowerCase();

/**
 * One search for the whole Operations workspace (Moaz, 19 Oct 2026): sites after their IPO and
 * heads-up BOQs before it. Lives in the top bar; the pages carry no search boxes of their own.
 */
export function GlobalSearch({ session, onOpenSite, onOpenHeadsUp }: { session: Session; onOpenSite: (siteId: string) => void; onOpenHeadsUp: (reference: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [sites, setSites] = useState<SiteHit[]>([]);
  const [headsUps, setHeadsUps] = useState<HeadsUpHit[]>([]);
  const [loadedAt, setLoadedAt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (Date.now() - loadedAt < 60_000) return;
    const [s, a] = await Promise.all([
      api<{ sites: SiteHit[] }>("/site-workflow").catch(() => ({ sites: [] as SiteHit[] })),
      api<{ requests: any[] }>("/project-workflow/advance-inbox").catch(() => ({ requests: [] as any[] })),
    ]);
    setSites(s.sites);
    setHeadsUps(a.requests.map((r: any) => ({
      reference: r.snapshot?.headsupGroup ?? r.number, recordId: r.record_id, customer: r.customer_name ?? "—", site: r.site_name ?? r.snapshot?.site ?? "—",
      siteCode: r.site_code ?? r.snapshot?.siteCode ?? "", region: r.region || "", final: Boolean(r.confirmed_issuance_id),
      stage: r.operations_stage ? `Operations: ${STAGE_LABELS[r.operations_stage as StageKey] ?? r.operations_stage}` : WORKFLOW_STAGES[r.workflow_stage ?? ""] ?? String(r.workflow_stage ?? "").replace(/_/g, " "),
    })));
    setLoadedAt(Date.now());
  }, [loadedAt]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) { e.preventDefault(); input.current?.focus(); } };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const text = q.trim().toLowerCase();
    if (!text) return [];
    const words = text.split(/\s+/);
    const match = (fields: unknown[]) => { const hay = fields.map(norm).join(" "); return words.every((w) => hay.includes(w)); };
    const s = sites.filter((x) => match([x.siteName, x.siteCode, x.customer, x.region, x.stageLabel, x.ipoNumber, x.boqNumber])).slice(0, 6).map((site): Hit => ({ kind: "site", site }));
    const h = headsUps.filter((x) => match([x.reference, x.customer, x.site, x.siteCode, x.region, x.stage])).slice(0, 6).map((headsUp): Hit => ({ kind: "headsup", headsUp }));
    return [...s, ...h];
  }, [q, sites, headsUps]);
  useEffect(() => { setActive(0); }, [q]);

  const choose = (hit: Hit) => {
    setOpen(false); setQ(""); input.current?.blur();
    if (hit.kind === "site") onOpenSite(hit.site.id); else onOpenHeadsUp(hit.headsUp.reference);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); input.current?.blur(); return; }
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(hits[active] ?? hits[0]); }
  };
  const siteHits = hits.filter((h) => h.kind === "site"), headsUpHits = hits.filter((h) => h.kind === "headsup");
  const showMenu = open && q.trim().length > 0;

  return (
    <div className="gs" ref={root} role="search">
      <label className="gs-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input ref={input} type="search" value={q} placeholder="Search sites and heads-ups: site, code, customer, IPO, region…" aria-label={`Search the ${session.user.role} workspace`}
          aria-expanded={showMenu} aria-controls="gs-menu" autoComplete="off"
          onFocus={() => { setOpen(true); void load(); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={onKeyDown} />
        {!q && <kbd>/</kbd>}
      </label>
      {showMenu && (
        <div className="gs-menu" id="gs-menu" role="listbox" aria-label="Search results">
          {hits.length === 0 ? <p className="gs-empty">{loadedAt ? "Nothing matches." : "Loading…"}</p> : (
            <>
              {siteHits.length > 0 && <div className="gs-group">Sites</div>}
              {siteHits.map((h) => h.kind === "site" && (
                <button type="button" key={h.site.id} role="option" className="gs-item" aria-selected={hits[active] === h} onMouseEnter={() => setActive(hits.indexOf(h))} onClick={() => choose(h)}>
                  <span><strong>{h.site.siteName ?? "Site"}{h.site.siteCode ? ` (${h.site.siteCode})` : ""}</strong><small>{h.site.customer ?? "—"}{h.site.region ? ` · ${h.site.region}` : ""} · IPO {h.site.ipoNumber}</small></span>
                  <span className="gs-tag" style={{ background: STAGE_COLOURS[h.site.stage], color: stageInk(h.site.stage) }}>{h.site.stageLabel}</span>
                </button>
              ))}
              {headsUpHits.length > 0 && <div className="gs-group">Heads-ups (before IPO)</div>}
              {headsUpHits.map((h) => h.kind === "headsup" && (
                <button type="button" key={`${h.headsUp.reference}-${h.headsUp.recordId}`} role="option" className="gs-item" aria-selected={hits[active] === h} onMouseEnter={() => setActive(hits.indexOf(h))} onClick={() => choose(h)}>
                  <span><strong>{h.headsUp.site}{h.headsUp.siteCode ? ` (${h.headsUp.siteCode})` : ""}</strong><small>{h.headsUp.customer}{h.headsUp.region ? ` · ${h.headsUp.region}` : ""} · {h.headsUp.reference}</small></span>
                  <span className="gs-tag" style={{ background: "var(--pz-pending-bg)", color: "var(--pz-pending)" }}>{h.headsUp.final ? "Final received" : h.headsUp.stage}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
