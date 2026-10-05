import type { BoqSnapshot } from "../../server/boq/engine.js";
const format = (v: string | number, decimals = 0) =>
  new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(v));
export function BoqCosting({
  snapshot: s,
  number,
  createdAt,
}: {
  snapshot: BoqSnapshot;
  number?: string;
  createdAt?: string;
}) {
  return (
    <section className="boq-costing">
      <div className="panel-heading">
        <h2>{number ?? "Costing preview"}</h2>
        {number && (
          <button className="dark-button" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        )}
      </div>
      <p>
        {s.customer.name} · {s.survey.siteName} · Site code {s.survey.siteCode}{" "}
        {createdAt && `· ${new Date(createdAt).toLocaleString()}`}
      </p>
      <div className="summary-grid">
        <div className="summary-card">
          <span>PV capacity</span>
          <strong>{format(s.engineering.pvKwp, 2)} kWp</strong>
        </div>
        <div className="summary-card">
          <span>Solution ID</span>
          <strong>{s.engineering.solutionId}</strong>
          <p>
            {format(s.engineering.batteryModules)} battery modules ·{" "}
            {format(s.engineering.bms)} BMS · {format(s.engineering.strings)}{" "}
            strings
          </p>
        </div>
        <div className="summary-card">
          <span>Budgeted project cost</span>
          <strong>PKR {format(s.total)}</strong>
          <p>PKR {format(s.perWatt, 2)} / W</p>
        </div>
      </div>
      {s.warnings.length > 0 && (
        <details className="rate-notice">
          <summary>{s.warnings.length} rate statuses require review</summary>
          {s.warnings.map((w: string) => (
            <p key={w}>{w}</p>
          ))}
        </details>
      )}
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
                  {format(l.rate, Number(l.rate) % 1 ? 4 : 0)}
                </td>
                <td className="numeric">{format(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
              <td className="numeric">{format(x.cost)}</td>
              <td className="numeric">{format(x.perWatt, 2)}</td>
            </tr>
          ))}
          <tr>
            <th>TOTAL PROJECT COST</th>
            <th className="numeric">{format(s.total)}</th>
            <th className="numeric">{format(s.perWatt, 2)}</th>
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
              <td className="numeric">{format(x.cost)}</td>
              <td className="numeric">{format(x.perWatt, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Prepared by {s.survey.preparedBy}.{" "}
        {number
          ? "Saved R0 is immutable. Rates, rules, brands and approved specifications are preserved as used on this record."
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
