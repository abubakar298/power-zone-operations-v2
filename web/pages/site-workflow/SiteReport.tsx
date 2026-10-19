import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import { StatusBadge } from "../../ui/StatusBadge.js";
import "./site-workflow.css";
import { STAGE_COLOURS, STAGE_LABELS, stageInk, fmtDay, type SiteRow, type StageKey } from "./stages.js";

interface SiteRef { siteId: string; siteName: string | null; siteCode: string | null; customer: string | null; region: string | null; stage: StageKey | null }
interface CableLine extends SiteRef { itemKey: string; name: string; unit: string; boqQty: string; usedQty: string | null; returnedQty: string; variance: string | null; direction: string; flagged: boolean; note: string }
interface ExtraItem extends SiteRef { id: string; description: string; quantity: string; unit: string; reason: string; addedBy: string; addedAt: string }
interface Report { sites: SiteRow[]; cables: CableLine[]; additionalItems: ExtraItem[] }

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function download(name: string, header: string[], rows: unknown[][]) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
const label = (s: SiteRef | SiteRow) => `${s.siteName ?? "Site"}${s.siteCode ? ` (${s.siteCode})` : ""}`;

/** Site report: every site's stage and dates, cable variance against BOQ, and items used outside the quotation. */
export function SiteReport({ session }: { session: Session }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [region, setRegion] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  useEffect(() => {
    let active = true;
    api<Report>("/site-workflow/report").then((r) => { if (active) { setReport(r); setError(""); } }).catch((e) => { if (active) setError(e instanceof ApiError ? e.message : "Unable to load the report."); });
    return () => { active = false; };
  }, []);
  const regions = useMemo(() => [...new Set((report?.sites ?? []).map((s) => s.region).filter(Boolean) as string[])].sort(), [report]);
  const sites = useMemo(() => (report?.sites ?? []).filter((s) => !region || s.region === region), [report, region]);
  const cables = useMemo(() => (report?.cables ?? []).filter((c) => (!region || c.region === region) && (!onlyFlagged || c.flagged)), [report, region, onlyFlagged]);
  const items = useMemo(() => (report?.additionalItems ?? []).filter((i) => !region || i.region === region), [report, region]);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="sw">
      {error && <p className="pz-feedback pz-feedback--danger" role="alert">{error}</p>}
      <section className="pz-panel pz-stack">
        <div className="sw-head"><h2>Site report</h2><small>{session.user.role === "Accounts" ? "Cable variance and additional items are what Accounts invoices or refunds." : "Downloads are CSV files that open in Excel."}</small></div>
        <div className="pz-form-grid">
          <Field id="sr-region" label="Region"><select id="sr-region" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All regions</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
        </div>
      </section>

      <section className="pz-panel pz-stack">
        <div className="sw-head"><h3>Stages and dates</h3><Button variant="secondary" disabled={!report} onClick={() => download(`sites-${stamp}.csv`,
          ["Site", "Code", "Customer", "Region", "Type", "Stage", "Days in stage", "Scope", "PO date", "Expected start", "Expected delivery", "Expected completion", "Delivered", "Started", "Installation completed", "Commissioned", "Handed over", "Sign-off", "DO date", "Acknowledgement", "Submitted to customer", "Advance claimed", "Final claimed", "Open problems", "Days without pictures", "Closed"],
          sites.map((s) => [s.siteName, s.siteCode, s.customer, s.region, s.siteType, s.stageLabel, s.daysInStage, s.scopeLabel, s.poDate, s.expectedStart, s.expectedDelivery, s.expectedCompletion, s.deliveredOn, s.startedOn, s.installationCompletedOn, s.commissionedOn, s.handedOverOn, s.customerSignoff === true ? "Yes" : s.customerSignoff === false ? "No" : "", s.doDate, s.acknowledgementDate, s.submittedToCustomerDate, s.advanceClaimed ? "Yes" : "No", s.finalClaimed ? "Yes" : "No", s.openProblems, s.missingPictureDays, s.closedAt?.slice(0, 10) ?? ""]))}>Download CSV</Button></div>
        <div className="pz-table-scroll">
          <table className="pz-table sw-table sw-table--compact">
            <thead><tr><th>Site</th><th>Customer</th><th>Region</th><th>Stage</th><th>Scope</th><th>Expected delivery</th><th>Delivered</th><th>Started</th><th>Commissioned</th><th>Handed over</th><th>Submitted</th><th>Closed</th></tr></thead>
            <tbody>
              {!report ? <tr><td colSpan={12}>Loading…</td></tr> : sites.length === 0 ? <tr><td colSpan={12}>No sites.</td></tr> : sites.map((s) => (
                <tr key={s.id}>
                  <td><strong>{label(s)}</strong></td><td>{s.customer ?? "—"}</td><td>{s.region ?? "—"}</td>
                  <td><span className="sw-stage-tag" style={{ background: STAGE_COLOURS[s.stage], color: stageInk(s.stage) }}>{STAGE_LABELS[s.stage]}</span></td>
                  <td>{s.scope === "delivery_only" ? "Delivery only" : s.scope === "installation" ? "Install & commission" : "—"}</td>
                  <td>{fmtDay(s.expectedDelivery)}</td><td>{fmtDay(s.deliveredOn)}</td><td>{fmtDay(s.startedOn)}</td><td>{fmtDay(s.commissionedOn)}</td><td>{fmtDay(s.handedOverOn)}</td><td>{fmtDay(s.submittedToCustomerDate)}</td><td>{fmtDay(s.closedAt?.slice(0, 10))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pz-panel pz-stack">
        <div className="sw-head"><h3>Cable variance against BOQ</h3><div className="pz-action-row">
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />Only flagged</label>
          <Button variant="secondary" disabled={!report} onClick={() => download(`cable-variance-${stamp}.csv`, ["Site", "Code", "Customer", "Region", "Stage", "Cable", "Unit", "BOQ", "Used", "Returned", "Variance", "Action", "Note"],
            cables.map((c) => [c.siteName, c.siteCode, c.customer, c.region, c.stage ? STAGE_LABELS[c.stage] : "", c.name, c.unit, c.boqQty, c.usedQty, c.returnedQty, c.variance, c.direction, c.note]))}>Download CSV</Button>
        </div></div>
        <p className="sw-muted">Extra cable used is invoiced to the customer; cable charged but not used is refunded.</p>
        <div className="pz-table-scroll">
          <table className="pz-table sw-table sw-table--compact">
            <thead><tr><th>Site</th><th>Cable</th><th>BOQ</th><th>Used</th><th>Returned</th><th>Variance</th><th>Note</th></tr></thead>
            <tbody>
              {!report ? <tr><td colSpan={7}>Loading…</td></tr> : cables.length === 0 ? <tr><td colSpan={7}>{onlyFlagged ? "No cable variance flagged." : "No cable usage entered yet."}</td></tr> : cables.map((c) => (
                <tr key={`${c.siteId}-${c.itemKey}`}>
                  <td><strong>{label(c)}</strong><br /><small>{c.customer ?? ""}{c.region ? ` · ${c.region}` : ""}</small></td>
                  <td>{c.name}<br /><small>{c.unit}</small></td><td>{c.boqQty}</td><td>{c.usedQty ?? "—"}</td><td>{c.returnedQty}</td>
                  <td><StatusBadge tone={c.flagged ? "warning" : "success"}>{c.variance != null && Number(c.variance) > 0 ? `+${c.variance}` : c.variance} · {c.direction}</StatusBadge></td>
                  <td>{c.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pz-panel pz-stack">
        <div className="sw-head"><h3>Items used outside the quotation</h3><Button variant="secondary" disabled={!report} onClick={() => download(`additional-items-${stamp}.csv`, ["Site", "Code", "Customer", "Region", "Stage", "Item", "Quantity", "Unit", "Reason", "Added by", "Added on"],
          items.map((i) => [i.siteName, i.siteCode, i.customer, i.region, i.stage ? STAGE_LABELS[i.stage] : "", i.description, i.quantity, i.unit, i.reason, i.addedBy, i.addedAt.slice(0, 10)]))}>Download CSV</Button></div>
        <div className="pz-table-scroll">
          <table className="pz-table sw-table sw-table--compact">
            <thead><tr><th>Site</th><th>Item</th><th>Quantity</th><th>Reason</th><th>Added</th></tr></thead>
            <tbody>
              {!report ? <tr><td colSpan={5}>Loading…</td></tr> : items.length === 0 ? <tr><td colSpan={5}>No additional items recorded.</td></tr> : items.map((i) => (
                <tr key={i.id}>
                  <td><strong>{label(i)}</strong><br /><small>{i.customer ?? ""}{i.region ? ` · ${i.region}` : ""}</small></td>
                  <td>{i.description}</td><td>{i.quantity} {i.unit}</td><td>{i.reason || "—"}</td><td>{i.addedBy}<br /><small>{fmtDay(i.addedAt.slice(0, 10))}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
