import { Decimal } from "decimal.js";
const amount = (value: string) =>
  new Decimal(value).toNumber().toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function CostingWorkflowHistory({ review }: { review: any }) {
  const history = review.workflow_history ?? [];
  if (!review.base_revision_id) return null;
  const previous = history.at(-1);
  const context = review.revision_context;
  const difference =
    previous?.budgeted_cost != null
      ? new Decimal(review.snapshot.total).minus(previous.budgeted_cost)
      : null;
  return (
    <section
      className="detail-panel"
      aria-label="BOQ revision workflow history"
    >
      <h3>Document workflow history</h3>
      <p>
        Earlier budgets and quotations remain unchanged. The revised submission
        has its own costing decision.
      </p>
      <div className="table-scroll">
        <table className="master-table" style={{ minWidth: 960 }} aria-label="Document workflow history">
          <thead>
            <tr>
              <th scope="col">Document / stage</th>
              <th scope="col">Date</th>
              <th scope="col">Status</th>
              <th scope="col">Quotation number</th>
              <th scope="col" className="numeric">Quoted amount (PKR)</th>
              <th scope="col">Survey / revision details</th>
              <th scope="col" className="numeric">
                Budgeted cost (PKR)
              </th>
            </tr>
          </thead>
          <tbody>
            {history.flatMap((b: any, index: number) => [
              <tr key={b.id}>
                <td>
                  <strong>
                    {index === 0 ? "Original BOQ" : "BOQ revision"}
                  </strong>
                  <br />
                  {b.number}
                </td>
                <td>{new Date(b.created_at).toLocaleString()}</td>
                <td>Approved</td><td>—</td><td className="numeric">—</td>
                <td>
                  {b.survey_type === "General quotation"
                    ? "Quick BOQ · no survey"
                    : "Survey-based BOQ"}
                  {b.revision_origin && (
                    <p>
                      {b.revision_origin}: {b.revision_reason}
                    </p>
                  )}
                </td>
                <td className="numeric">{amount(b.budgeted_cost)}</td>
              </tr>,
              ...b.quotations.map((q: any) => (
                <tr key={q.id}>
                  <td>
                    <strong>Quotation</strong>
                    <br />
                    {q.number}
                  </td>
                  <td>{new Date(q.quoted_at).toLocaleString()}</td>
                  <td>
                    {q.status === "Submitted"
                      ? "Awaiting quotation approval"
                      : q.status}
                  </td>
                  <td>{q.number}</td>
                  <td className="numeric">{q.net_total != null ? amount(q.net_total) : "—"}</td>
                  <td>Based on {b.number}</td>
                  <td className="numeric">{amount(b.budgeted_cost)}</td>
                </tr>
              )),
            ])}
            <tr>
              <td>
                <strong>Revision request</strong>
                {context?.source_quotation && <p>{context.source_quotation}</p>}
              </td>
              <td>—</td>
              <td>Revision requested</td><td>{context?.source_quotation ?? "—"}</td><td className="numeric">—</td>
              <td>
                <strong>
                  {context?.origin ??
                    review.revision_origin ??
                    "Type not recorded"}
                </strong>
                <p>{context?.reason ?? review.revision_reason}</p>
                {context?.requested_by && (
                  <p>Requester (as recorded): {context.requested_by}</p>
                )}
                {context?.management_feedback &&
                  context.management_feedback !== context.reason && (
                    <p>Management feedback: {context.management_feedback}</p>
                  )}
              </td>
              <td className="numeric">—</td>
            </tr>
            <tr>
              <td>
                <strong>Revised costing</strong>
                <br />
                Draft version {review.draft_version}
              </td>
              <td>{new Date(review.created_at).toLocaleString()}</td>
              <td>{review.status}</td><td>Not yet prepared</td><td className="numeric">—</td>
              <td>
                {difference && (
                  <span>
                    {difference.isNegative()
                      ? "Decrease"
                      : difference.isZero()
                        ? "Change"
                        : "Increase"}{" "}
                    from previous approved budget: PKR{" "}
                    {amount(difference.abs().toString())}
                  </span>
                )}
              </td>
              <td className="numeric">
                <strong>{amount(review.snapshot.total)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
