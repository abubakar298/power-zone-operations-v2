import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { StatusBadge } from "../ui/StatusBadge.js";

interface Row {
  reference: string; recordId: string; customer: string; site: string; siteCode: string; region: string;
  stage: string; stageKey: string; received: string; expected: string | null; items: number; status: string; final: boolean;
}
const OPERATIONS_STAGES: Record<string, string> = {
  ipo_received: "IPO received", material_planning: "Material planning", procurement: "Procurement", delivery_scheduled: "Delivery scheduled",
  dispatched: "Dispatched", installation: "Installation", commissioning: "Commissioning", documents: "Documents", closed: "Closed",
};
const WORKFLOW_STAGES: Record<string, string> = {
  request_review: "Survey request", survey_requested: "Survey requested", survey_scheduled: "Survey scheduled", report_received: "Report received",
  technical_review: "Technical review", design_handed_off: "Design review", management_review: "Management review", commercial_revision: "Revisions",
  approved_dispatch: "Ready to send", customer_tracking: "Customer follow-up", advance_pending: "Advance planning", po_receipt: "PO receipt",
  order_exception: "Order exception", issued: "Issued", deferred: "Deferred", declined: "Declined",
};
const stageLabel = (operations: string | null, workflow: string | null) =>
  operations ? `Operations: ${OPERATIONS_STAGES[operations] ?? operations}` : WORKFLOW_STAGES[workflow ?? ""] ?? (workflow ?? "").replace(/_/g, " ") ?? "—";
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "");
const fmtDay = (v: string | null | undefined) => (v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(v.length === 10 ? `${v}T00:00:00` : v)) : "—");

/**
 * Search over received advance (heads-up) BOQs: customer, site, region, stage and date range.
 * `scope="upcoming"` keeps only heads-ups for sites whose IPO has not been issued yet (the "Heads up on new sites" page).
 */
export function AdvanceBoqSearch({ onOpen, scope = "all" }: { onOpen: (reference: string) => void; scope?: "all" | "upcoming" }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState("");
  const [site, setSite] = useState("");
  const [region, setRegion] = useState("");
  const [stage, setStage] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    let active = true;
    api<{ requests: any[] }>("/project-workflow/advance-inbox")
      .then((result) => {
        if (!active) return;
        setRows(result.requests.map((r: any) => ({
          reference: r.snapshot?.headsupGroup ?? r.number,
          recordId: r.record_id,
          customer: r.customer_name ?? "—",
          site: r.site_name ?? r.snapshot?.site ?? "—",
          siteCode: r.site_code ?? r.snapshot?.siteCode ?? "",
          region: r.region || "—",
          stageKey: r.operations_stage ? `ops:${r.operations_stage}` : `wf:${r.workflow_stage ?? ""}`,
          stage: stageLabel(r.operations_stage ?? null, r.workflow_stage ?? null),
          received: r.updated_at,
          expected: r.snapshot?.expectedDate ?? null,
          items: Array.isArray(r.snapshot?.items) ? r.snapshot.items.length : 0,
          status: r.mode,
          final: Boolean(r.confirmed_issuance_id),
        })));
        setError("");
      })
      .catch((e) => { if (active) setError(e instanceof ApiError ? e.message : "Unable to load advance BOQs."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // Upcoming = no final BOQ received and no operations record yet: the site is still ahead of its IPO.
  const pool = useMemo(() => (scope === "upcoming" ? rows.filter((r) => !r.final && !r.stageKey.startsWith("ops:")) : rows), [rows, scope]);
  const unique = (pick: (r: Row) => string) => [...new Set(pool.map(pick).filter((v) => v && v !== "—"))].sort((a, b) => a.localeCompare(b));
  const customers = useMemo(() => unique((r) => r.customer), [pool]);
  const sites = useMemo(() => unique((r) => r.site), [pool]);
  const regions = useMemo(() => unique((r) => r.region), [pool]);
  const stages = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of pool) seen.set(r.stageKey, r.stage);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [pool]);

  const visible = useMemo(() => {
    const text = q.trim().toLowerCase();
    return pool.filter((r) =>
      (!customer || r.customer === customer) &&
      (!site || r.site === site) &&
      (!region || r.region === region) &&
      (!stage || r.stageKey === stage) &&
      (!from || day(r.received) >= from) &&
      (!to || day(r.received) <= to) &&
      (!text || [r.reference, r.customer, r.site, r.siteCode].some((v) => v.toLowerCase().includes(text))));
  }, [pool, q, customer, site, region, stage, from, to]);
  const clear = () => { setQ(""); setCustomer(""); setSite(""); setRegion(""); setStage(""); setFrom(""); setTo(""); };
  const filtered = Boolean(q || customer || site || region || stage || from || to);

  return (
    <section className="pz-panel pz-stack" aria-label="Advance BOQ search">
      <h2>{scope === "upcoming" ? "Heads up on new sites" : "Find an advance BOQ"}</h2>
      <p className="pz-caption">
        {scope === "upcoming"
          ? "Advance BOQs for sites whose IPO has not been issued yet. Plan stock from these before the IPO arrives."
          : "Heads-up material forecasts received from Coordination. Filter by customer, site, region, stage or the date they were received."}
      </p>
      <div className="pz-form-grid">
        <Field id="abq-q" label="Search"><input id="abq-q" placeholder="Reference, customer or site" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field id="abq-customer" label="Customer">
          <select id="abq-customer" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>{customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field id="abq-site" label="Site">
          <select id="abq-site" value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">All sites</option>{sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field id="abq-region" label="Region">
          <select id="abq-region" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field id="abq-stage" label="Stage">
          <select id="abq-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>{stages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <Field id="abq-from" label="Received from"><input id="abq-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field id="abq-to" label="Received to"><input id="abq-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="pz-action-row">
        <span>{loading ? "Loading…" : `${visible.length} of ${pool.length} advance BOQ${pool.length === 1 ? "" : "s"}`}</span>
        {filtered && <Button variant="neutral" onClick={clear}>Clear filters</Button>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!loading && !error && (
        <div className="pz-table-scroll">
          <table className="pz-table">
            <thead><tr><th>Reference</th><th>Customer</th><th>Site</th><th>Region</th><th>Stage</th><th>Received</th><th>Expected</th><th>Items</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={10}>{pool.length === 0 ? (scope === "upcoming" ? "No heads-up BOQs for new sites right now." : "No advance BOQs received yet.") : "No advance BOQs match these filters."}</td></tr>
              ) : visible.map((r) => (
                <tr key={`${r.reference}-${r.recordId}`}>
                  <td><strong>{r.reference}</strong></td>
                  <td>{r.customer}</td>
                  <td>{r.site}{r.siteCode ? <><br /><small>{r.siteCode}</small></> : null}</td>
                  <td>{r.region}</td>
                  <td>{r.stage}</td>
                  <td>{fmtDay(r.received)}</td>
                  <td>{fmtDay(r.expected)}</td>
                  <td>{r.items}</td>
                  <td><StatusBadge tone={r.final ? "success" : "pending"}>{r.final ? "Final received" : r.status}</StatusBadge></td>
                  <td><Button variant="secondary" onClick={() => onOpen(r.reference)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
