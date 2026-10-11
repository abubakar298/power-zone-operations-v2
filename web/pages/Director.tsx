import { AccountsWorkspace } from "./AccountsWorkspace.js";
import { money } from "../numbers.js";
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { Coordinator } from "./Coordinator.js";
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
    [error, setError] = useState(""),
    [closureCount, setClosureCount] = useState<number>();
  useEffect(() => {
    void api<any>("/accounts-workspace")
      .then((d) =>
        setClosureCount(
          d.closures.filter((c: any) => c.stage === "Awaiting Management")
            .length,
        ),
      )
      .catch(() => setClosureCount(undefined));
  }, [tab]);
  useEffect(() => {
    let active = true;
    setError("");
    setData(undefined);
    setSelected("");
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
    <div className="director-portal">
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
              className={tab === t ? "primary" : "workflow-button"}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Job closing" && closureCount !== undefined
                ? ` · ${closureCount}`
                : ""}
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
      {tab === "Job closing" && <AccountsWorkspace session={session} />}
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
              <div className="summary-grid director-summary">
                <div>
                  <h4>Budgeted cost</h4>
                  <strong>PKR {money(data.totals.budgetedCost)}</strong>
                </div>
                <div>
                  <h4>Budgeted selling revenue</h4>
                  <strong>PKR {money(data.totals.sellingRevenue)}</strong>
                </div>
                <div>
                  <h4>Overall margin · priced proposals</h4>
                  <strong>
                    {data.totals.budgetedMarginPercent === null
                      ? "—"
                      : `${data.totals.budgetedMarginPercent}%`}
                  </strong>
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
                <table className="order-table">
                  <thead>
                    <tr>
                      <th>Customer / site</th>
                      <th>BOQ / quotation</th>
                      <th>Budgeted cost</th>
                      <th>Selling revenue</th>
                      <th>Budgeted profit</th>
                      <th>Total margin %</th>
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
                          <small>Quoted: {p.quotedDate ?? "—"}</small>
                          <br />
                          {p.ipoNumber ?? ""}
                        </td>
                        <td>{money(p.budgetedCost)}</td>
                        <td>{money(p.sellingRevenue)}</td>
                        <td>{money(p.budgetedProfit)}</td>
                        <td>
                          {p.budgetedMarginPercent === null
                            ? "—"
                            : `${p.budgetedMarginPercent}%`}
                        </td>
                        <td>
                          <button
                            className="workflow-button"
                            onClick={() => setSelected(p.id)}
                          >
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
                  <h3>
                    {proposal.customer} · {proposal.site}
                  </h3>
                  <h4>Quotation version history</h4>
                  <p>
                    Every saved quotation version for this proposal, with its
                    original attached costing. Earlier versions are shown for
                    reference and are not added to portfolio totals. Saved
                    versions do not confirm customer delivery.
                  </p>
                  <div className="table-scroll">
                    <table className="order-table">
                      <thead>
                        <tr>
                          <th>Quotation / quoted date</th>
                          <th>Attached BOQ</th>
                          <th>Budgeted cost</th>
                          <th>Selling revenue</th>
                          <th>Customer payable</th>
                          <th>Total margin %</th>
                          <th>PDF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proposal.quotationVersions.map((v: any) => (
                          <tr key={v.id}>
                            <td>
                              {v.number}
                              <br />
                              {v.quotedDate}
                            </td>
                            <td>{v.boqNumber}</td>
                            <td>{money(v.budgetedCost)}</td>
                            <td>{money(v.sellingRevenue)}</td>
                            <td>{money(v.customerPayable)}</td>
                            <td>
                              {v.budgetedMarginPercent === null
                                ? "—"
                                : `${v.budgetedMarginPercent}%`}
                            </td>
                            <td>
                              <a
                                href={`/api/commercial/quotations/${v.id}/quotation.pdf`}
                              >
                                Quotation
                              </a>{" "}
                              ·{" "}
                              <a
                                href={`/api/boqs/${v.boqRevisionId}/costing.pdf`}
                              >
                                Costing
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!proposal.quotationVersions.length && (
                    <p>No saved quotations for this proposal yet.</p>
                  )}
                  <h4>Latest quotation · Peachtree phase comparison</h4>
                  <p>
                    {proposal.basis} · customer payable: PKR{" "}
                    {money(proposal.customerPayable)}
                  </p>
                  <div className="table-scroll">
                    <table className="order-table">
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
    </div>
  );
}
