import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { Coordinator } from "./Coordinator.js";
const money = (v: string | null) =>
  v === null
    ? "Not entered"
    : new Intl.NumberFormat("en-PK", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(v));
export function Director({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: (task: any) => void;
}) {
  const [tab, setTab] = useState("Approvals"),
    [customer, setCustomer] = useState(""),
    [data, setData] = useState<any>(),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    void api<any>(
      `/director/portfolio${customer !== "" ? `?customerId=${customer}` : ""}`,
    )
      .then((d) => {
        if (active) {
          setData(d);
          setSelected("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [customer]);
  const proposal = data?.proposals.find((p: any) => p.id === selected);
  return (
    <>
      <section className="detail-panel">
        <div className="panel-heading">
          <div>
            <h2>Director Operations</h2>
            <p>
              Review approvals and follow customer proposals, site budgets and
              margins.
            </p>
          </div>
        </div>
        <div className="survey-actions">
          {["Approvals", "Customer & site budgets", "Job closing"].map((t) => (
            <button
              key={t}
              className={tab === t ? "primary" : ""}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Job closing" ? " · 0" : ""}
            </button>
          ))}
        </div>
      </section>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {tab === "Approvals" && <Coordinator session={session} onOpen={onOpen} />}
      {tab === "Job closing" && (
        <section className="detail-panel">
          <h3>Jobs awaiting Director sign-off</h3>
          <p>
            No closing requests have been received. Accounts job-closing
            submissions will be connected in the Accounts milestone.
          </p>
        </section>
      )}
      {tab === "Customer & site budgets" && (
        <section className="detail-panel">
          <h3>Customer & site portfolio</h3>
          <label>
            Customer
            <select
              aria-label="Reporting customer"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            >
              <option value="">All customers</option>
              {data?.customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {!data ? (
            <p>Loading budgets…</p>
          ) : (
            <>
              <div className="survey-grid">
                <div>
                  <h4>Budgeted cost</h4>
                  <strong>PKR {money(data.totals.budgetedCost)}</strong>
                </div>
                <div>
                  <h4>Budgeted selling revenue</h4>
                  <strong>PKR {money(data.totals.sellingRevenue)}</strong>
                </div>
                <div>
                  <h4>Priced / awaiting quotation</h4>
                  <strong>
                    {data.totals.pricedProposals} /{" "}
                    {data.totals.unpricedProposals}
                  </strong>
                </div>
              </div>
              <p>
                One current quotation per BOQ family; earlier revisions and
                versions are excluded from totals. Revenue follows the saved
                quotation’s tax display and allocated discount. Showing up to{" "}
                {data.recordLimit} proposals.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Customer / site</th>
                      <th>BOQ / quotation</th>
                      <th>Budgeted cost</th>
                      <th>Selling revenue</th>
                      <th>Budgeted profit</th>
                      <th>View</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.proposals.map((p: any) => (
                      <tr key={p.id}>
                        <td>
                          {p.customer}
                          <br />
                          {p.site} · {p.siteCode}
                        </td>
                        <td>
                          {p.boqNumber}
                          <br />
                          {p.quotationNumber ?? "Quotation pending"}
                          <br />
                          {p.ipoNumber ?? ""}
                        </td>
                        <td>{money(p.budgetedCost)}</td>
                        <td>{money(p.sellingRevenue)}</td>
                        <td>{money(p.budgetedProfit)}</td>
                        <td>
                          <button onClick={() => setSelected(p.id)}>
                            View site budget
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.proposals.length && (
                <p>No approved BOQ budgets for this customer yet.</p>
              )}
              {proposal && (
                <section className="detail-panel">
                  <h3>{proposal.site} · Peachtree phase comparison</h3>
                  <p>
                    {proposal.basis} · customer payable: PKR{" "}
                    {money(proposal.customerPayable)}
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>PT phase</th>
                          <th>Budgeted cost</th>
                          <th>Selling amount</th>
                          <th>Budgeted profit</th>
                          <th>Margin %</th>
                          <th>Actual cost</th>
                          <th>Margin variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proposal.phases.map((p: any) => (
                          <tr key={p.name}>
                            <td>{p.name}</td>
                            <td>{money(p.budgetedCost)}</td>
                            <td>{money(p.sellingAmount)}</td>
                            <td>{money(p.budgetedProfit)}</td>
                            <td>
                              {p.budgetedMarginPercent === null
                                ? "—"
                                : `${p.budgetedMarginPercent}%`}
                            </td>
                            <td>Not entered</td>
                            <td>Not available</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    Actual costing will come from Accounts. Missing actual costs
                    are not treated as zero. Margin here means profit divided by
                    selling revenue; quotation markup is profit divided by cost.
                  </p>
                  <div className="survey-actions">
                    <a href={`/api/boqs/${proposal.boqRevisionId}/costing.pdf`}>
                      Download costing PDF
                    </a>
                    {proposal.quotationId && (
                      <a
                        href={`/api/commercial/quotations/${proposal.quotationId}/quotation.pdf`}
                      >
                        Download quotation PDF
                      </a>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
