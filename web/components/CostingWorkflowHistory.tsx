import { money as amount } from "../numbers.js";
import { Decimal } from "decimal.js";
export function CostingWorkflowHistory({
  review,
  quotation,
}: {
  review: any;
  quotation?: any;
}) {
  const history = review.workflow_history ?? [];
  if (!quotation && !review.base_revision_id) return null;
  const previous = history.at(-1);
  const showMarkup = history.some((b:any)=>b.quotations?.some((q:any)=>Object.hasOwn(q,"budgeted_markup")));
  const markup = (q:any) => q?.budgeted_markup == null ? "—" : `${new Decimal(q.budgeted_markup).toFixed(2)}%`;
  const currentHistory = history.flatMap((b:any)=>b.quotations).find((q:any)=>q.id===quotation?.id);
  const quotationType = (q:any) => q?.quotation_type ?? "—";
  const settingsChanges = (q:any) => q?.settings_changes?.map((change:string)=><p key={change}>{change}</p>);
  const context = review.revision_context;
  const difference =
    !quotation && previous?.budgeted_cost != null
      ? new Decimal(review.snapshot.total).minus(previous.budgeted_cost)
      : null;
  return (
    <section
      className="detail-panel"
      aria-label="BOQ revision workflow history"
    >
      <h3>Document workflow history</h3>
      <p>
        Earlier budgets and quotations remain unchanged. Each review is recorded
        against its own document version.
      </p>
      <div className="table-scroll">
        <table
          className="master-table"
          style={{ minWidth: 960 }}
          aria-label="Document workflow history"
        >
          <thead>
            <tr>
              <th scope="col">Document / stage</th>
              <th scope="col">Date</th>
              <th scope="col">Status</th>
              <th scope="col">Quotation number</th><th scope="col">Quotation type</th>
              <th scope="col" className="numeric">
                Quoted amount (PKR)
              </th>
              <th scope="col">Survey / revision details</th>
              <th scope="col" className="numeric">
                Budgeted cost (PKR)
              </th>
              {showMarkup && <th scope="col" className="numeric">Budgeted markup on cost (%)</th>}
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
                <td>Approved</td>
                <td>—</td><td>—</td>
                <td className="numeric">—</td>
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
                <td className="numeric">{b.budgeted_cost == null ? "Restricted" : amount(b.budgeted_cost)}</td>
                {showMarkup && <td className="numeric">—</td>}
              </tr>,
              ...b.quotations
                .filter((q: any) => q.id !== quotation?.id)
                .map((q: any) => (
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
                    <td>{q.number}</td><td>{quotationType(q)}</td>
                    <td className="numeric">
                      {q.net_total != null ? amount(q.net_total) : "—"}
                    </td>
                    <td>
                      Based on {b.number}{settingsChanges(q)}
                      {q.revision && (
                        <p>
                          {q.revision.origin}: {q.revision.reason}
                        </p>
                      )}
                    </td>
                    <td className="numeric">{b.budgeted_cost == null ? "Restricted" : amount(b.budgeted_cost)}</td>
                    {showMarkup && <td className="numeric">{markup(q)}</td>}
                  </tr>
                )),
            ])}
            {!quotation && (
              <tr>
                <td>
                  <strong>Revision request</strong>
                  {context?.source_quotation && (
                    <p>{context.source_quotation}</p>
                  )}
                </td>
                <td>—</td>
                <td>Revision requested</td>
                <td>{context?.source_quotation ?? "—"}</td><td>—</td>
                <td className="numeric">—</td>
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
                {showMarkup && <td className="numeric">—</td>}
              </tr>
            )}
            {!quotation && (
              <tr>
                <td>
                  <strong>Revised costing</strong>
                  <br />
                  Draft version {review.draft_version}
                </td>
                <td>{new Date(review.created_at).toLocaleString()}</td>
                <td>{review.status}</td>
                <td>Not yet prepared</td><td>—</td>
                <td className="numeric">—</td>
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
                {showMarkup && <td className="numeric">—</td>}
              </tr>
            )}
            {quotation && (
              <tr>
                <td>
                  <strong>{quotation.workflow_status === "Submitted" ? "Quotation under review" : "Quotation"}</strong>
                </td>
                <td>{new Date(quotation.created_at).toLocaleString()}</td>
                <td>
                  {quotation.workflow_status === "Submitted"
                    ? "Awaiting quotation approval"
                    : (quotation.workflow_status ?? "Not submitted")}
                </td>
                <td>{quotation.number}</td><td>{quotationType(currentHistory)}</td>
                <td className="numeric">
                  {amount(
                    quotation.snapshot.footer.find(
                      (r: any) => r.label === "Net Total",
                    ).amount,
                  )}
                </td>
                <td>
                  Based on {previous?.number}{settingsChanges(currentHistory)}
                  {previous?.quotations?.find((q: any) => q.id === quotation.id)
                    ?.revision && (
                    <p>
                      {
                        previous.quotations.find(
                          (q: any) => q.id === quotation.id,
                        ).revision.origin
                      }
                      :{" "}
                      {
                        previous.quotations.find(
                          (q: any) => q.id === quotation.id,
                        ).revision.reason
                      }
                    </p>
                  )}
                  {quotation.workflow_notes && (
                    <p>Latest review feedback: {quotation.workflow_notes}</p>
                  )}
                </td>
                <td className="numeric">
                  {previous?.budgeted_cost != null
                    ? amount(previous.budgeted_cost)
                    : "—"}
                </td>
                {showMarkup && <td className="numeric">{markup(history.flatMap((b:any)=>b.quotations).find((q:any)=>q.id===quotation.id))}</td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
