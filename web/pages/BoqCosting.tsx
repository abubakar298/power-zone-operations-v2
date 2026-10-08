import { decimalDisplay as format } from "../numbers.js";
import { SharePdf } from "../components/SharePdf.js";
import type { BoqSnapshot } from "../../server/boq/engine.js";
export function BoqCosting({
  snapshot: s,
  number,
  createdAt,
  pdfUrl,
}: {
  snapshot: BoqSnapshot;
  number?: string;
  createdAt?: string;
  pdfUrl: string;
}) {
  const bessOnly=s.survey.family === "bess-only";
  return (
    <section className="boq-costing">
      <div className="panel-heading">
        <h2>{number ?? "Costing preview"}</h2>
        <a className="dark-button" href={pdfUrl} download>
          Download costing PDF
        </a>
        <SharePdf url={pdfUrl} filename={`${number ?? "BOQ"}-costing.pdf`} />
      </div>
      <p>
        {s.customer.name} · {s.survey.siteName} · Site code {s.survey.siteCode}{" "}
        {createdAt && `· ${new Date(createdAt).toLocaleString()}`}
      </p>
      <div className="summary-grid">
        <div className="summary-card">
          <span>{bessOnly ? "Solution family" : "PV capacity"}</span>
          <strong>{bessOnly ? "BESS Only · UPS with Installation" : `${format(s.engineering.pvKwp,2)} kWp`}</strong>
        </div>
        <div className="summary-card">
          <span>Solution ID</span>
          <strong>{s.engineering.solutionId}</strong>
          <p>
            {format(s.engineering.batteryModules, 0)} battery modules ·{" "}
            {format(s.engineering.bms, 0)} BMS {!bessOnly && <>· {format(s.engineering.strings,0)} strings</>}
          </p>
        </div>
        <div className="summary-card">
          <span>{(s as any).costVisibility ? "Project cost excluding BESS" : "Budgeted project cost"}</span>
          <strong>PKR {format(s.total, 2)}</strong>
          {!bessOnly && <p>PKR {format(s.perWatt, 2)} / W</p>}
        </div>
      </div>
      {s.engineering.singlePhaseScope && !bessOnly && (
        <section className="detail-panel">
          <h3>Single-phase calculation basis</h3>
          <p>10mm² single-core AC cable: {s.engineering.singlePhaseScope.cable.fixedTotalMetres} m fixed termination + {s.engineering.singlePhaseScope.cable.loadPanelConductorMetres} m load-panel conductors. Route: {s.engineering.singlePhaseScope.cable.loadPanelRunMetres} m × line and neutral ({s.engineering.singlePhaseScope.cable.loadPanelBasis}).</p>
          <p>DC protection: {s.engineering.singlePhaseScope.dc.roomBreakers} inverter-room + {s.engineering.singlePhaseScope.dc.rooftopBreakers} rooftop 500 V, 2-pole breakers. VPD inside the AC protection box; no external AC SPD.</p>
          <p>Provisional costs requiring review: DC breaker PKR 4,950 each; AC box/accessories bundle PKR 5,000; DC enclosure bundle PKR 5,000. Current Rate Master values take precedence. Electrical verification remains pending. Commercial preparation is enabled; this is not an installation clearance.</p>
        </section>
      )}
      {s.warnings.length > 0 && (
        <details className="rate-notice">
          <summary>{s.warnings.length} rate statuses require review</summary>
          {s.warnings.map((w: string) => (
            <p key={w}>{w}</p>
          ))}
        </details>
      )}
      <h3>Project Costing Summary</h3>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="numeric">Budgeted Cost (PKR)</th>
            <th className="numeric">Cost/W</th>
          </tr>
        </thead>
        <tbody>
          {s.summary.map((x) => (
            <tr key={x.name}>
              <td>{x.name}</td>
              <td className="numeric">{format(x.cost, 2)}</td>
              <td className="numeric">{bessOnly ? "—" : format(x.perWatt, 2)}</td>
            </tr>
          ))}
          <tr>
            <th>{(s as any).costVisibility ? "PROJECT COST EXCLUDING BESS" : "TOTAL PROJECT COST"}</th>
            <th className="numeric">{format(s.total, 2)}</th>
            <th className="numeric">{bessOnly ? "—" : format(s.perWatt, 2)}</th>
          </tr>
        </tbody>
      </table>
      <h3>EPC Costing Breakup</h3>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="numeric">Budgeted Cost (PKR)</th>
            <th className="numeric">Cost/W</th>
          </tr>
        </thead>
        <tbody>
          {s.epc.map((x) => (
            <tr key={x.name}>
              <td>{x.name}</td>
              <td className="numeric">{format(x.cost, 2)}</td>
              <td className="numeric">{bessOnly ? "—" : format(x.perWatt, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Project Costing Detailed Breakup</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "Item / Description",
                "Brand",
                "Detailed Specification",
                "Qty",
                "UOM",
                "Unit Rate (PKR)",
                "Total Cost (PKR)",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.key}>
                <td>{l.description}</td>
                <td>
                  {l.brand || "—"}
                  {l.brandAlternatives.length > 0 && (
                    <small className="brand-alternatives">
                      {l.brandAlternatives.join(", ")}
                    </small>
                  )}
                </td>
                <td>{l.specification || "—"}</td>
                <td className="numeric">
                  {format(l.qty, Number(l.qty) % 1 ? 2 : 0)}
                </td>
                <td>{l.unit}</td>
                <td className="numeric">
                  {(l as any).costRestricted ? "Restricted" : format(l.rate, Number(l.rate) % 1 ? 4 : 0)}
                </td>
                <td className="numeric">{(l as any).costRestricted ? "Restricted" : format(l.total, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Prepared by {s.survey.preparedBy}.{" "}
        {number
          ? "Saved BOQ revision is immutable. Rates, rules, brands and approved specifications are preserved as used on this record."
          : "Preview uses the current master data. A final review is required before saving."}
      </p>
      {s.survey.uploadIds.length > 0 && (
        <details>
          <summary>
            Survey source documents ({s.survey.uploadIds.length})
          </summary>
          {s.survey.uploadIds.map((id: string, i: number) => (
            <p key={id}>
              <a href={`/api/boqs/uploads/${id}`}>Download source {i + 1}</a>
            </p>
          ))}
          <pre className="source-text">
            {s.survey.ocrText ||
              "No extracted text recorded; source documents reviewed manually."}
          </pre>
        </details>
      )}
    </section>
  );
}
