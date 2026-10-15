import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../api.js";
import { Field } from "../ui/Field.js";
import { StatusBadge } from "../ui/StatusBadge.js";

interface CableLine {
  executionId: string; siteName: string | null; siteCode: string | null; customer: string | null; region: string | null; stage: string;
  itemKey: string; name: string; unit: string; boqQty: string; issuedQty: string | null; usedQty: string | null; returnedQty: string;
  variance: string | null; direction: string; flagged: boolean; note: string; updatedAt: string | null; updatedBy: string | null;
}
interface AdditionalItem {
  executionId: string; siteName: string | null; siteCode: string | null; customer: string | null; region: string | null; stage: string;
  id: string; itemKey: string | null; itemName: string | null; description: string; quantity: string; unit: string; reason: string; createdAt: string; createdBy: string;
}
interface SiteRow { id: string; siteName: string | null; siteCode: string | null; customer: string | null; region: string | null; siteType: string | null; stage: string; stageLabel: string; daysInStage: number; late: boolean; poDate: string | null; startDate: string | null; endDate: string | null; openProblems: number; missingPictureDays: number }

const fmtAt = (v: string | null) => (v ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(v)) : "—");
const fmtDay = (v: string | null) => (v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${v}T00:00:00`)) : "—");
const stageName = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function download(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SiteReports({ session }: { session: Session }) {
  void session;
  const [tab, setTab] = useState<"stages" | "cables" | "additional">("stages");
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [stages, setStages] = useState<{ key: string; label: string }[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [cables, setCables] = useState<{ lines: CableLine[]; flaggedSites: number; sitesReported: number } | null>(null);
  const [additional, setAdditional] = useState<AdditionalItem[]>([]);
  const [error, setError] = useState("");
  const [region, setRegion] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, c, a] = await Promise.all([
        api<{ sites: SiteRow[]; stages: { key: string; label: string }[]; regions: string[] }>("/site-execution"),
        api<{ lines: CableLine[]; flaggedSites: number; sitesReported: number }>("/site-execution/reports/cable-variance"),
        api<{ items: AdditionalItem[] }>("/site-execution/reports/additional-items"),
      ]);
      setSites(s.sites); setStages(s.stages); setRegions(s.regions); setCables(c); setAdditional(a.items); setError("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to load reports."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const inRegion = <T extends { region: string | null }>(rows: T[]) => rows.filter((r) => !region || (r.region ?? "") === region);
  const siteRows = useMemo(() => inRegion(sites), [sites, region]);
  const cableRows = useMemo(() => inRegion(cables?.lines ?? []).filter((l) => !onlyFlagged || l.flagged), [cables, region, onlyFlagged]);
  const additionalRows = useMemo(() => inRegion(additional), [additional, region]);
  const stageCounts = useMemo(() => {
    const c: Record<string, { total: number; late: number }> = {};
    for (const s of siteRows) { c[s.stage] ??= { total: 0, late: 0 }; c[s.stage].total++; if (s.late) c[s.stage].late++; }
    return c;
  }, [siteRows]);

  return (
    <div className="pz-stack">
      <section className="pz-panel pz-stack">
        <div className="stage-grid">
          <button type="button" className={`stage-card${tab === "stages" ? " active" : ""}`} onClick={() => setTab("stages")}><strong>{siteRows.length}</strong><span>Site stages</span></button>
          <button type="button" className={`stage-card${tab === "cables" ? " active" : ""}`} onClick={() => setTab("cables")}><strong>{cables?.flaggedSites ?? 0}</strong><span>Sites with cable variance</span></button>
          <button type="button" className={`stage-card${tab === "additional" ? " active" : ""}`} onClick={() => setTab("additional")}><strong>{additionalRows.length}</strong><span>Additional items</span></button>
        </div>
        <Field id="rp-region" label="Region">
          <select id="rp-region" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      </section>

      {tab === "stages" && (
        <section className="pz-panel pz-stack">
          <div className="pz-action-row">
            <h3>Where every site stands</h3>
            <button type="button" className="pz-button pz-button--secondary" onClick={() => download("site-stages.csv",
              ["Site", "Code", "Customer", "Region", "Type", "Stage", "Days in stage", "Late", "PO date", "Start", "End", "Open problems", "Days without pictures"],
              siteRows.map((s) => [s.siteName, s.siteCode, s.customer, s.region, s.siteType, s.stageLabel, s.daysInStage, s.late ? "Yes" : "No", s.poDate, s.startDate, s.endDate, s.openProblems, s.missingPictureDays]))}>
              Download CSV
            </button>
          </div>
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Stage</th><th>Sites</th><th>Late</th></tr></thead>
              <tbody>{stages.map((s) => <tr key={s.key}><td>{s.label}</td><td>{stageCounts[s.key]?.total ?? 0}</td><td>{stageCounts[s.key]?.late ? <StatusBadge tone="danger">{stageCounts[s.key].late}</StatusBadge> : "—"}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Site</th><th>Customer</th><th>Region</th><th>Stage</th><th>Days</th><th>Start</th><th>End</th><th>Problems</th><th>Missing pictures</th></tr></thead>
              <tbody>
                {siteRows.length === 0 ? <tr><td colSpan={9}>No sites.</td></tr> : siteRows.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.siteName ?? "—"}</strong>{s.siteCode ? ` (${s.siteCode})` : ""}</td>
                    <td>{s.customer ?? "—"}</td><td>{s.region ?? "—"}</td>
                    <td><StatusBadge tone={s.stage === "closed" ? "success" : s.late ? "danger" : "pending"}>{s.stageLabel}</StatusBadge></td>
                    <td>{s.daysInStage}{s.late ? " · late" : ""}</td><td>{fmtDay(s.startDate)}</td><td>{fmtDay(s.endDate)}</td>
                    <td>{s.openProblems || "—"}</td><td>{s.missingPictureDays || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "cables" && (
        <section className="pz-panel pz-stack">
          <div className="pz-action-row">
            <h3>Cable variance</h3>
            <label><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only lines with a variance</label>
            <button type="button" className="pz-button pz-button--secondary" onClick={() => download("cable-variance.csv",
              ["Site", "Code", "Customer", "Region", "Cable", "Unit", "BOQ", "Sent to Store", "Used", "Returned", "Variance", "Action", "Note", "Entered by", "Entered at"],
              cableRows.map((l) => [l.siteName, l.siteCode, l.customer, l.region, l.name, l.unit, l.boqQty, l.issuedQty, l.usedQty, l.returnedQty, l.variance, l.direction, l.note, l.updatedBy, l.updatedAt]))}>
              Download CSV
            </button>
          </div>
          <p><small>{cables?.sitesReported ?? 0} site{(cables?.sitesReported ?? 0) === 1 ? "" : "s"} with cable usage entered. Every difference from the BOQ is flagged: extra cable used is invoiced, extra cable charged but not used is refunded.</small></p>
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Site</th><th>Cable</th><th>BOQ</th><th>Used</th><th>Returned</th><th>Variance</th><th>Action</th><th>Entered</th></tr></thead>
              <tbody>
                {cableRows.length === 0 ? <tr><td colSpan={8}>Nothing to show.</td></tr> : cableRows.map((l) => (
                  <tr key={`${l.executionId}-${l.itemKey}`}>
                    <td><strong>{l.siteName ?? "—"}</strong>{l.siteCode ? ` (${l.siteCode})` : ""}<br /><small>{l.customer} · {stageName(l.stage)}</small></td>
                    <td>{l.name}<br /><small>{l.unit}</small></td>
                    <td>{l.boqQty}</td><td>{l.usedQty ?? "—"}</td><td>{l.returnedQty}</td>
                    <td>{l.variance == null ? "—" : <StatusBadge tone={l.flagged ? "danger" : "success"}>{Number(l.variance) > 0 ? `+${l.variance}` : l.variance}</StatusBadge>}</td>
                    <td>{l.direction}{l.note ? <><br /><small>{l.note}</small></> : null}</td>
                    <td><small>{l.updatedBy ?? "—"}<br />{fmtAt(l.updatedAt)}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "additional" && (
        <section className="pz-panel pz-stack">
          <div className="pz-action-row">
            <h3>Items used outside the quotation</h3>
            <button type="button" className="pz-button pz-button--secondary" onClick={() => download("additional-items.csv",
              ["Site", "Code", "Customer", "Region", "Stage", "Item", "Description", "Quantity", "Unit", "Reason", "Entered by", "Entered at"],
              additionalRows.map((a) => [a.siteName, a.siteCode, a.customer, a.region, stageName(a.stage), a.itemName ?? a.itemKey, a.description, a.quantity, a.unit, a.reason, a.createdBy, a.createdAt]))}>
              Download CSV
            </button>
          </div>
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead><tr><th>Site</th><th>Item</th><th>Quantity</th><th>Reason</th><th>Entered</th></tr></thead>
              <tbody>
                {additionalRows.length === 0 ? <tr><td colSpan={5}>No additional items recorded.</td></tr> : additionalRows.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.siteName ?? "—"}</strong>{a.siteCode ? ` (${a.siteCode})` : ""}<br /><small>{a.customer} · {stageName(a.stage)}</small></td>
                    <td>{a.description}{a.itemName ? <><br /><small>{a.itemName}</small></> : null}</td>
                    <td>{a.quantity} {a.unit}</td>
                    <td>{a.reason || "—"}</td>
                    <td><small>{a.createdBy}<br />{fmtAt(a.createdAt)}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
