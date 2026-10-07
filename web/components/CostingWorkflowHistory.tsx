import { Decimal } from "decimal.js";
const amount = (value: string) =>
  new Decimal(value)
    .toNumber()
    .toLocaleString("en-PK", {
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
      <ol>
        {history.map((b: any, index: number) => (
          <li key={b.id}>
            <strong>
              {index === 0 ? "Original approved BOQ" : "Approved BOQ revision"}:{" "}
              {b.number}
            </strong>
            <p>
              {b.survey_type === "General quotation"
                ? "Quick BOQ · no survey"
                : "Survey-based BOQ"}{" "}
              · Budgeted cost: PKR {amount(b.budgeted_cost)} ·{" "}
              {new Date(b.created_at).toLocaleString()}
            </p>
            {b.revision_origin && (
              <p>
                {b.revision_origin} · {b.revision_reason}
              </p>
            )}
            {b.quotations.length ? (
              <ul>
                {b.quotations.map((q: any) => (
                  <li key={q.id}>
                    Quotation {q.number} ·{" "}
                    {new Date(q.quoted_at).toLocaleString()} ·{" "}
                    {q.status === "Submitted"
                      ? "Awaiting quotation approval"
                      : q.status}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No quotation prepared for this BOQ version.</p>
            )}
          </li>
        ))}
        <li>
          <strong>Revision requested</strong>
          <p>
            Revision type:{" "}
            {context?.origin ?? review.revision_origin ?? "Not recorded"}
          </p>
          {context?.source_quotation && (
            <p>Source quotation: {context.source_quotation}</p>
          )}
          {context?.requested_by && <p>Requested by: {context.requested_by}</p>}
          <p>Reason: {context?.reason ?? review.revision_reason}</p>
          {context?.management_feedback &&
            context.management_feedback !== context.reason && (
              <p>Management feedback: {context.management_feedback}</p>
            )}
        </li>
        <li>
          <strong>Revised costing · {review.status}</strong>
          <p>New budgeted cost: PKR {amount(review.snapshot.total)}</p>
          {difference && (
            <p>
              {difference.isNegative()
                ? "Decrease"
                : difference.isZero()
                  ? "Change"
                  : "Increase"}{" "}
              from previous approved budget: PKR{" "}
              {amount(difference.abs().toString())}
            </p>
          )}
        </li>
      </ol>
    </section>
  );
}
