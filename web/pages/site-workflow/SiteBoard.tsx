import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Field } from "../../ui/Field.js";
import { SiteDetail, type Reference } from "./SiteDetail.js";
import "./site-workflow.css";
import {
  STAGE_COLOURS, STAGE_LABELS, stageInk, fmtDay, fmtShort, inMode, missingDocs, MODE_TEXT, OVERDUE_TEXT, type BoardMode, type SiteRow, type StageKey,
} from "./stages.js";

interface Overview extends Reference { sites: SiteRow[]; lateAfterDays: number }

/**
 * The sites board: one list, filtered by `mode`, opening a site page in place.
 * `variant="ops"` renders the Operations shell layout (tabs, pill filters, portal table); the default
 * layout is unchanged for every other login. `regionScope` pre-filters to one region.
 */
export function SiteBoard({ session, mode = "all", initialSiteId, initialSiteNonce = 0, initialStage, variant, regionScope = "" }: {
  session: Session; mode?: BoardMode; initialSiteId?: string; initialSiteNonce?: number; initialStage?: string; variant?: "ops"; regionScope?: string;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const [openedNonce, setOpenedNonce] = useState<number | undefined>();
  const [applied, setApplied] = useState<string | undefined>();
  const [region, setRegion] = useState("");
  const [stage, setStage] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<Overview>("/site-workflow")); setError(""); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load sites."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // A site or stage handed over from the dashboard applies once; afterwards the page behaves normally.
  useEffect(() => { if (initialSiteId && initialSiteNonce !== openedNonce) { setOpenedNonce(initialSiteNonce); setSelected(initialSiteId); } }, [initialSiteId, initialSiteNonce, openedNonce]);
  useEffect(() => { if (initialStage && initialStage !== applied) { setApplied(initialStage); setStage(initialStage); } }, [initialStage, applied]);

  const scoped = useMemo(() => (data ? data.sites.filter((s) => inMode(s, mode) && (!regionScope || s.region === regionScope)) : []), [data, mode, regionScope]);
  const byStage = useMemo(() => { const m = new Map<string, number>(); for (const s of scoped) m.set(s.stage, (m.get(s.stage) ?? 0) + 1); return m; }, [scoped]);
  const regions = useMemo(() => [...new Set(scoped.map((s) => s.region).filter(Boolean) as string[])].sort(), [scoped]);
  const visible = useMemo(() => scoped.filter((s) => (!region || s.region === region) && (!stage || s.stage === stage)), [scoped, region, stage]);
  const stageTabs = mode === "all" || mode === "ongoing";

  if (selected && data) return <SiteDetail session={session} id={selected} reference={data} onBack={() => { setSelected(undefined); void load(); }} />;
  const text = MODE_TEXT[mode];
  const flags = (s: SiteRow) => mode === "docs" ? missingDocs(s).map((m) => <span key={m} className="sw-chip sw-chip--warning">{m}</span>) : (
    <>
      {s.late && <span className="sw-chip sw-chip--danger">Late</span>}
      {s.overdue.map((o) => <span key={o} className="sw-chip sw-chip--danger">{OVERDUE_TEXT[o] ?? o}</span>)}
      {s.openProblems > 0 && <span className="sw-chip sw-chip--danger">{s.openProblems} problem{s.openProblems === 1 ? "" : "s"}</span>}
      {s.missingPictureDays > 0 && <span className="sw-chip sw-chip--warning">{s.missingPictureDays} day{s.missingPictureDays === 1 ? "" : "s"} no pictures</span>}
      {!s.late && s.overdue.length === 0 && s.openProblems === 0 && s.missingPictureDays === 0 && <span className="sw-chip sw-chip--ok">On track</span>}
    </>
  );
  const scopeText = (s: SiteRow) => (s.scope === "delivery_only" ? "Delivery only" : s.scope === "installation" ? "Install & commission" : "—");
  const stageCell = (s: SiteRow, cls: string) => (
    <>
      <span className={cls} style={{ background: STAGE_COLOURS[s.stage as StageKey], color: stageInk(s.stage as StageKey) }}>{STAGE_LABELS[s.stage as StageKey]}</span>
      <br /><small>{s.stage === "closed" ? `closed ${fmtDay(s.closedAt?.slice(0, 10))}` : `${s.daysInStage} day${s.daysInStage === 1 ? "" : "s"}`}</small>
    </>
  );
  const emptyText = scoped.length === 0 ? text.empty : "No sites match these filters.";
  const lateNote = `Late means more than ${data?.lateAfterDays ?? 2} days in the same stage. Overdue compares the expected dates set under planning with today. Click a row to open the site.`;

  if (variant === "ops") return (
    <div className="sw">
      {error && <p className="ops-feedback" role="alert">{error}</p>}
      <div className="ops-banner"><svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 16v.01" /></svg>{text.note} {lateNote}</div>
      <section className="ops-card" aria-label={text.title}>
        {stageTabs && data && (
          <div className="ops-tabs" role="tablist" aria-label="Stage">
            <button type="button" aria-pressed={!stage} onClick={() => setStage("")}>All <span className="n">{scoped.length}</span></button>
            {data.stages.map((s) => (
              <button type="button" key={s.key} aria-pressed={stage === s.key} onClick={() => setStage(stage === s.key ? "" : s.key)}>
                <i style={{ background: STAGE_COLOURS[s.key] }} />{s.label} <span className="n">{byStage.get(s.key) ?? 0}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ops-tools">
          {!regionScope && (
            <label className="ops-pill"><select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All regions</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}</select><svg className="i chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></label>
          )}
          <span className="count">{data ? `${visible.length} of ${scoped.length} site${scoped.length === 1 ? "" : "s"}` : "Loading…"}</span>
        </div>
        <div className="pz-table-scroll">
          <table className="ops-table">
            <thead><tr><th>Site</th><th>Region</th><th>Stage</th><th>Scope</th><th>Delivery</th><th>Installation</th><th>{mode === "docs" ? "Missing documents" : "Flags"}</th></tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={7} className="ops-empty">Loading…</td></tr>
              : visible.length === 0 ? <tr><td colSpan={7} className="ops-empty">{emptyText}</td></tr>
              : visible.map((s) => (
                <tr key={s.id} data-clickable onClick={() => setSelected(s.id)}>
                  <td className="site"><b>{s.siteName ?? "Site"}{s.siteCode ? ` (${s.siteCode})` : ""}</b><small>{s.customer ?? "—"}</small></td>
                  <td>{s.region ?? "—"}</td>
                  <td>{stageCell(s, "ops-stage")}</td>
                  <td>{scopeText(s)}</td>
                  <td className="date">{s.expectedDelivery ? `expected ${fmtShort(s.expectedDelivery)}` : "—"}<br />{s.deliveredOn ? `delivered ${fmtShort(s.deliveredOn)}` : "not delivered"}</td>
                  <td className="date">{s.scope === "delivery_only" ? "—" : s.startedOn ? `started ${fmtShort(s.startedOn)}` : "not started"}<br />{s.scope === "delivery_only" ? "delivery only" : s.handedOverOn ? `handed over ${fmtShort(s.handedOverOn)}` : "—"}</td>
                  <td><div className="sw-chips">{flags(s)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  return (
    <div className="sw">
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      <section className="pz-panel pz-stack">
        <div className="sw-head"><h2>{text.title}</h2><small>{data ? `${scoped.length} site${scoped.length === 1 ? "" : "s"}` : "Loading…"}</small></div>
        <p className="sw-muted">{text.note}</p>
        {data && scoped.length > 0 && stageTabs && (
          <div className="sw-legend" aria-label="Sites by stage">
            {data.stages.map((s) => (
              <button type="button" key={s.key} aria-pressed={stage === s.key} onClick={() => setStage(stage === s.key ? "" : s.key)}>
                <i className="sw-dot" style={{ background: STAGE_COLOURS[s.key] }} />{s.label} · {byStage.get(s.key) ?? 0}
              </button>
            ))}
          </div>
        )}
        <div className="pz-form-grid">
          <Field id="sw-region" label="Region">
            <select id="sw-region" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All regions</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </Field>
          {stageTabs && (
            <Field id="sw-stage" label="Stage">
              <select id="sw-stage" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{data?.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            </Field>
          )}
        </div>
        <div className="pz-table-scroll">
          <table className="pz-table sw-table">
            <thead>
              <tr><th>Site</th><th>Region</th><th>Stage</th><th>Scope</th><th>Delivery</th><th>Installation</th><th>{mode === "docs" ? "Missing documents" : "Flags"}</th></tr>
            </thead>
            <tbody>
              {!data ? <tr><td colSpan={7}>Loading…</td></tr>
              : visible.length === 0 ? <tr><td colSpan={7}>{emptyText}</td></tr>
              : visible.map((s) => (
                <tr key={s.id} data-clickable onClick={() => setSelected(s.id)}>
                  <td><strong>{s.siteName ?? "Site"}</strong>{s.siteCode ? ` (${s.siteCode})` : ""}<br /><small>{s.customer ?? "—"}</small></td>
                  <td>{s.region ?? "—"}</td>
                  <td>{stageCell(s, "sw-stage-tag")}</td>
                  <td>{scopeText(s)}</td>
                  <td className="sw-nowrap">{s.expectedDelivery ? `expected ${fmtShort(s.expectedDelivery)}` : "—"}<br /><small>{s.deliveredOn ? `delivered ${fmtShort(s.deliveredOn)}` : "not delivered"}</small></td>
                  <td className="sw-nowrap">{s.scope === "delivery_only" ? "—" : s.startedOn ? `started ${fmtShort(s.startedOn)}` : "not started"}<br /><small>{s.scope === "delivery_only" ? "delivery only" : s.handedOverOn ? `handed over ${fmtShort(s.handedOverOn)}` : "—"}</small></td>
                  <td><div className="sw-chips">{flags(s)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sw-muted">{lateNote}</p>
      </section>
    </div>
  );
}
