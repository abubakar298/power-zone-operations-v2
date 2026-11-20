import { ErrorText } from "./parts.js";
import { CableQuantityComparison } from "./TechnicalReview.js";
import { solutionValues } from "../../../server/boq/solution-identity.js";
import { Decimal } from "decimal.js";
import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { decimalDisplay } from "../../numbers.js";

export function CoordinationTechnicalSummary({ session, detail }: any) {
  const r = detail.record;
  const [summary, setSummary] = useState<any>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setSummary(undefined);
    setError("");
    void api<any>(`/project-workflow/${r.id}/preview`, {
      csrf: session.csrfToken,
      body: { kind: "technical-summary" },
    })
      .then((data) => {
        if (live) setSummary(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [r.id, r.version, attempt]);
  const recommended =
    summary?.survey ?? detail.review?.survey ?? r.data.surveyInputs;
  let recommendedSolution = "Not available";
  if (recommended) {
    try {
      recommendedSolution = solutionValues(recommended).solutionId;
    } catch {
      recommendedSolution = "Needs review";
    }
  }
  const difference = (row: any) => {
    try {
      const delta = new Decimal(row.entered).sub(row.approved);
      const unit = row.field.includes("(W)") ? " W" : "";
      return delta.isZero()
        ? "No change"
        : `${decimalDisplay(delta.abs().toString())}${unit} ${delta.gt(0) ? "more" : "less"}`;
    } catch {
      return "N/A";
    }
  };
  return (
    <details className="pz-form-section pz-technical-summary">
      <summary>
        <span className="pz-technical-summary-heading">
          <h3>Submitted Technical Review Summary</h3>
          <span>
            Recommended Solution ID: <strong>{recommendedSolution}</strong>
          </span>
        </span>
      </summary>
      <div className="pz-stack pz-technical-summary-content">
        <ErrorText error={error} />
        {error && (
          <div>
            <Button
              variant="secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry Summary
            </Button>
          </div>
        )}
        {summary?.pending && <p>{summary.pending}</p>}
        {summary?.survey && (
          <>
            <p>
              <strong>{summary.status}</strong>
              {summary.reviewNumber ? ` · ${summary.reviewNumber}` : ""}
            </p>
            <div className="pz-table-scroll">
              <table className="pz-table">
                <tbody>
                  {[
                    ["panelQty", "Panel quantity"],
                    ["panelWattage", "Panel wattage (W)"],
                    ["totalWattage", "Total wattage (W)"],
                    ["bessId", "BESS configuration"],
                    ["inverter", "Inverter capacity"],
                    ["batteryKwh", "Battery capacity (kWh)"],
                    ["structure", "Structure"],
                  ].map(([key, title]) => (
                    <tr key={key}>
                      <th>{title}</th>
                      <td>{summary.survey[key] ?? "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{summary.remarks}</p>
            <h3>Panel Difference</h3>
            <div className="pz-table-scroll">
              <table className="pz-table">
                <thead>
                  <tr>
                    <th>Panel requirement</th>
                    <th>{summary.panelBaselineLabel}</th>
                    <th>Technical review</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.panels.map((row: any) => (
                    <tr
                      key={row.field}
                      className={
                        row.different ? "pz-survey-difference" : undefined
                      }
                    >
                      <th>{row.field}</th>
                      <td>{row.approved}</td>
                      <td>{row.entered}</td>
                      <td>{difference(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CableQuantityComparison
              rows={summary.cableRows}
              title="Cable Differences"
              baselineLabel={summary.baselineLabel}
            />
            <p>{summary.comparisonNote}</p>
          </>
        )}
      </div>
    </details>
  );
}
