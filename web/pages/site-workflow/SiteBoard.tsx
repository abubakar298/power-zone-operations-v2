import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Field } from "../../ui/Field.js";
import { SiteDetail, type Reference } from "./SiteDetail.js";
import "./site-workflow.css";
import {
  STAGE_COLOURS, STAGE_LABELS, stageInk, fmtDay, inMode, missingDocs, MODE_TEXT, OVERDUE_TEXT, type BoardMode, type SiteRow, type StageKey,
} from "./stages.js";

interface Overview extends Reference { sites: SiteRow[]; lateAfterDays: number }

/** The sites board: one list, filtered by `mode`, opening a site page in place. */
export function SiteBoard({ session, mode = "all", initialSiteId, initialStage }: { session: Session; mode?: BoardMode; initialSiteId?: string; initialStage?: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const [opened, setOpened] = useState<string | undefined>();
  const [applied, setApplied] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [stage, setStage] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<Overview>("/site-workflow")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load sites."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // A site or stage handed over from the dashboard applies once; afterwards the page behaves normally.
  useEffect(() => { if (initialSiteId && initialSiteId !== opened) { setOpened(initialSiteId); setSelected(initialSiteId); } }, [initialSiteId, opened]);
  useEffect(() => { if (initialStage && initialStage !== applied) { setApplied(initialStage); setStage(initialStage); } }, [initialStage, applied]);

  const scoped = useMemo(() => (data ? data.sites.filter((s) => inMode(s, mode)) : []), [data, mode]);
  const byStage = useMemo(() => { const m = new Map<string, number>(); for (const s of scoped) m.set(s.stage, (m.get(s.stage) ?? 0) + 1); return m; }, [scoped]);
  const regions = useMemo(() => [...new Set(scoped.map((s) => s.region).filter(Boolean) as string[])].sort(), [scoped]);
  const visible = useMemo(() => {
    const text = q.trim().toLowerCase();
    return scoped.filter((s) =>
      (!region || s.region === region) && (!stage || s.stage === stage) &&
      (!text || [s.siteName, s.siteCode, s.customer, s.ipoNumber, s.boqNumber].some((v) => (v ?? "").toLowerCase().includes(text))));
  }, [scoped, q, region, stage]);

  if (selected && data) return <SiteDetail session={session} id={selected} reference={data} onBack={() => { setSelected(undefined); void load(); }} />;
  const text = MODE_TEXT[mode];
  return (
    <div className="sw">
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      <section className="pz-panel pz-stack">
        <div className="sw-head"><h2>{text.title}</h2><small>{data ? `${scoped.length} site${scoped.length === 1 ? "" : "s"}` : "Loading…"}</small></div>
        <p className="sw-muted">{text.note}</p>
        {data && scoped.length > 0 && (mode === "all" || mode === "ongoing") && (
          <div className="sw-legend" aria-label="Sites by stage">
            {data.stages.map((s) => (
              <button type="button" key={s.key} aria-pressed={stage === s.key} onClick={() => setStage(stage === s.key ? "" : s.key)}>
                <i className="sw-dot" style={{ background: STAGE_COLOURS[s.key] }} />{s.label} · {byStage.get(s.key) ?? 0}
              </button>
            ))}
          </div>
        )}
        <div className="pz-form-grid">
          <Field id="sw-q" label="Search"><input id="sw-q" placeholder="Site, customer, IPO or BOQ number" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field id="sw-region" label="Region">
            <select id="sw-region" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All regions</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </Field>
          {(mode === "all" || mode === "ongoing") && (
            <Field id="sw-stage" label="Stage">
              <select id="sw-stage" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{data?.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </Field>
          )}
        </div>
        <div className="pz-table-scroll">
          <table className="pz-table sw-table">
            <thead>
              <tr><th>Site</th><th>Customer</th><th>Region</th><th>Stage</th><th>Scope</th><th>Expected delivery</th><th>Delivered</th><th>Started</th><th>Handed over</th><th>{mode === "docs" ? "Missing documents" : "Flags"}</th></tr>
            </thead>
            <tbody>
              {!data ? <tr><td colSpan={10}>Loading…</td></tr>
              : visible.length === 0 ? <tr><td colSpan={10}>{scoped.length === 0 ? text.empty : "No sites match these filters."}</td></tr>
              : visible.map((s) => (
                <tr key={s.id} data-clickable onClick={() => setSelected(s.id)}>
                  <td><strong>{s.siteName ?? "Site"}</strong>{s.siteCode ? ` (${s.siteCode})` : ""}<br /><small>IPO {s.ipoNumber}</small></td>
                  <td>{s.customer ?? "—"}</td>
                  <td>{s.region ?? "—"}</td>
                  <td>
                    <span className="sw-stage-tag" style={{ background: STAGE_COLOURS[s.stage as StageKey], color: stageInk(s.stage as StageKey) }}>{STAGE_LABELS[s.stage as StageKey]}</span>
                    <br /><small>{s.stage === "closed" ? `closed ${fmtDay(s.closedAt?.slice(0, 10))}` : `${s.daysInStage} day${s.daysInStage === 1 ? "" : "s"}`}</small>
                  </td>
                  <td>{s.scope === "delivery_only" ? "Delivery only" : s.scope === "installation" ? "Install & commission" : "—"}</td>
                  <td>{fmtDay(s.expectedDelivery)}</td>
                  <td>{fmtDay(s.deliveredOn)}</td>
                  <td>{fmtDay(s.startedOn)}</td>
                  <td>{fmtDay(s.handedOverOn)}</td>
                  <td>
                    <div className="sw-chips">
                      {mode === "docs" ? missingDocs(s).map((m) => <span key={m} className="sw-chip sw-chip--warning">{m}</span>) : (
                        <>
                          {s.late && <span className="sw-chip sw-chip--danger">Late</span>}
                          {s.overdue.map((o) => <span key={o} className="sw-chip sw-chip--danger">{OVERDUE_TEXT[o] ?? o}</span>)}
                          {s.openProblems > 0 && <span className="sw-chip sw-chip--danger">{s.openProblems} problem{s.openProblems === 1 ? "" : "s"}</span>}
                          {s.missingPictureDays > 0 && <span className="sw-chip sw-chip--warning">{s.missingPictureDays} day{s.missingPictureDays === 1 ? "" : "s"} no pictures</span>}
                          {!s.late && s.overdue.length === 0 && s.openProblems === 0 && s.missingPictureDays === 0 && <span className="sw-chip sw-chip--ok">On track</span>}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sw-muted">Late means more than {data?.lateAfterDays ?? 2} days in the same stage. Overdue compares the expected dates set under planning with today. Click a row to open the site.</p>
      </section>
    </div>
  );
}
