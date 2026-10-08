import { money } from "../numbers.js";
import { SharePdf } from "../components/SharePdf.js";
import { ExternalApproval } from "../components/ExternalApproval.js";
import { CostingWorkflowHistory } from "../components/CostingWorkflowHistory.js";
import { Decimal } from "decimal.js";
import { useEffect, useState, type ReactNode } from "react";
import { api, type Session } from "../api.js";
import { confirmTransition, confirmRevision, confirmDiscountProposal } from "../confirm.js";
import type { QuotationSnapshot } from "../../server/commercial/engine.js";
function useAdjustmentPreview(q: any, session: Session, enabled: boolean, kind: "discount" | "targetMargin", value: string) {
  const [result, setResult] = useState<any>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    setResult(undefined); setFailure("");
    if (!enabled || (kind === "targetMargin" && !value.trim())) { setPending(false); return; }
    let cancelled = false; setPending(true);
    const timer = setTimeout(() => {
      void api<any>(`/commercial/quotations/${q.id}/discount-review`, {
        body: { [kind]: value.trim() || "0" }, csrf: session.csrfToken,
      }).then(v => { if (!cancelled) setResult(v); })
        .catch(e => { if (!cancelled) setFailure(e.message); })
        .finally(() => { if (!cancelled) setPending(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q.id, enabled, kind, value, session.csrfToken]);
  return { result, pending, failure };
}
export function QuotationWorkflow({
  session,
  quotation: q,
  onChange,
  renderPreview,
}: {
  session: Session;
  quotation: any;
  onChange: (q: any) => void;
  renderPreview: (
    snapshot: QuotationSnapshot,
    discount?: string,
    onDiscount?: (value: string) => void,
  ) => ReactNode;
}) {
  const manager = ["Admin", "Management"].includes(session.user.role);
  const author = q.created_by === session.user.id;
  const [notes, setNotes] = useState("");
  const [revision, setRevision] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discount, setDiscount] = useState(q.snapshot.input.discount ?? "0");
  const [mode, setMode] = useState<"discount" | "margin">("discount");
  const [targetMargin, setTargetMargin] = useState("");
  const lump = useAdjustmentPreview(q, session, manager, "discount", discount);
  const target = useAdjustmentPreview(q, session, manager, "targetMargin", targetMargin);
  const selected = mode === "discount" ? lump : target;
  const metrics = selected.result;
  const calculating = selected.pending;
  const effectiveDiscount = mode === "discount" ? discount : (target.result?.discount ?? "");
  useEffect(() => {
    setDiscount(q.snapshot.input.discount ?? "0"); setMode("discount");
    setTargetMargin(""); setRevision(false); setNotes(""); setError("");
  }, [q.id]);
  async function transition(kind: string) {
    let actionDiscount = effectiveDiscount;
    let actionMetrics = metrics;
    let proposalConfirmed = false;
    if (kind === "Changes requested" && manager && discount.trim() && targetMargin.trim()) {
      if (lump.pending || target.pending || !lump.result || !target.result) {
        setError("Both proposals must have valid calculated totals before choosing a discount order."); return;
      }
      const chosen = await confirmDiscountProposal([
        { key: "discount", label: "Lump-sum discount", discount: money(lump.result.discount), payable: money(lump.result.proposed.payable) },
        { key: "margin", label: `Target margin ${targetMargin}%`, discount: money(target.result.discount), payable: money(target.result.proposed.payable) },
      ]);
      if (!chosen) return;
      setMode(chosen); proposalConfirmed = true;
      actionMetrics = chosen === "discount" ? lump.result : target.result;
      actionDiscount = actionMetrics.discount;
    }
    const proposedChange =
      manager &&
      (actionDiscount.trim() || "0") !== String(q.snapshot.input.discount ?? "0") &&
      actionMetrics &&
      Number(actionDiscount || 0) !== Number(q.snapshot.input.discount ?? 0);
    if (
      kind === "Approved" &&
      ((mode === "margin" && (calculating || !metrics)) ||
        !validDiscount ||
        Number(actionDiscount.trim() || 0) !== Number(q.snapshot.input.discount ?? 0))
    ) {
      setError(
        "This discount is a preview. Request revision with the proposed discount before approving the saved quotation.",
      );
      return;
    }
    if (
      !proposalConfirmed && !(await (
        ["Changes requested", "Approved"].includes(kind)
          ? confirmRevision
          : async (a: string, d: string) => confirmTransition(a, d)
      )(
        kind === "Approved"
          ? "Approve quotation"
          : kind === "Submitted"
            ? "Send quotation for approval"
            : "Request quotation revision",
        `${q.number} will move to the next workflow stage. The saved quotation stays unchanged.`,
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const feedback =
        kind === "Changes requested" && proposedChange
          ? `${notes.trim()}\nProposed total discount: PKR ${money(actionDiscount || "0")}. Proposed net payable: PKR ${money(actionMetrics.proposed.payable)}.`
          : notes.trim();
      await api("/coordinator/events", {
        body: { quotationId: q.id, kind, notes: feedback },
        csrf: session.csrfToken,
      });
      onChange(await api(`/commercial/quotations/${q.id}`));
      setRevision(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to update quotation workflow.",
      );
    } finally {
      setBusy(false);
    }
  }
  const normalizedDiscount = effectiveDiscount.trim() || "0";
  const gross = new Decimal(q.snapshot.footer.at(-1).amount).add(
    q.snapshot.input.discount ?? "0",
  );
  const validDiscount =
    /^\d{1,12}(\.\d{1,2})?$/.test(normalizedDiscount) &&
    new Decimal(normalizedDiscount).lte(gross);
  const snapshot =
    manager &&
    validDiscount &&
    (mode === "discount" || (!calculating && metrics))
      ? {
          ...q.snapshot,
          footer: q.snapshot.footer.map((r: any) =>
            r.label === "Special Discount"
              ? { ...r, amount: new Decimal(normalizedDiscount).toFixed(2) }
              : r.label === "Net Total"
                ? { ...r, amount: gross.minus(normalizedDiscount).toFixed(2) }
                : r,
          ),
        }
      : q.snapshot;
  return (
    <>
      {q.external_approval && (
        <section aria-label="Recorded external approval">
          <strong>External approval recorded</strong>
          <p>
            Method: {q.external_approval.channel} · Approver:{" "}
            {q.external_approval.approver} · {q.external_approval.comments}
          </p>
          {q.external_approval.evidence?.map((e: any) => (
            <p key={e.id}>
              <a href={`/api/boqs/uploads/${e.id}`}>{e.filename}</a>
            </p>
          ))}
        </section>
      )}
      <CostingWorkflowHistory review={q} quotation={q} />
      {manager && (
        <section
          aria-label="Management pricing controls"
          className="quotation-review-panel"
        >
          <h3>
            {!q.snapshot.footer.some(
              (r: any) => r.label === "Subtotal Before Tax",
            )
              ? "Tax-inclusive quotation"
              : "GST shown separately"}
          </h3>
          <p>
            Internal preview only. Applicable tax remains included in payable
            and excluded from profit.
          </p>
          <p>Compare both proposals below. Choose one for the PDF preview and revision feedback; neither changes the saved quotation.</p>
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 270px), 1fr))", gap: "1rem"}}>
            {(["discount", "margin"] as const).map(choice => {
              const state = choice === "discount" ? lump : target;
              return <section key={choice} aria-label={choice === "discount" ? "Lump-sum discount comparison" : "Target margin comparison"} className="detail-panel">
                <h4>{choice === "discount" ? "Lump-sum discount" : "Target profit margin on sales"}</h4>
                <label>{choice === "discount" ? "Discount amount (PKR)" : "Target profit margin (%)"}
                  <input aria-label={choice === "discount" ? "Management discount amount (PKR)" : "Target profit margin (%)"} type="number" min="0" max={choice === "margin" ? "99.99" : undefined} step="0.01" value={choice === "discount" ? discount : targetMargin} onChange={e => choice === "discount" ? setDiscount(e.target.value) : setTargetMargin(e.target.value)} />
                </label>
                <div aria-live="polite">
                  {state.pending ? <p>Updating totals…</p> : state.failure ? <p role="alert">{state.failure}</p> : state.result ? <dl>
                    <dt>Discount (PKR)</dt><dd>{money(state.result.discount)}</dd>
                    <dt>Customer payable (PKR)</dt><dd>{money(state.result.proposed.payable)}</dd>
                    <dt>Profit excluding GST (PKR)</dt><dd>{money(state.result.proposed.profit)}</dd>
                    <dt>Profit margin on sales</dt><dd>{state.result.proposed.marginPercent ?? "N/A"}%</dd>
                  </dl> : <p>Enter a target margin to compare.</p>}
                </div>
                <label><input type="radio" name={`proposal-${q.id}`} aria-label={choice === "discount" ? "Use lump-sum discount proposal" : "Use target margin proposal"} checked={mode === choice} onChange={() => setMode(choice)} />Use this proposal for preview / revision</label>
              </section>;
            })}
          </div>
          <p>Margin = profit ÷ selling price before tax. Solar remains unchanged under the existing discount policy.</p>
        </section>
      )}
      {renderPreview(snapshot)}
      <section
        className="quotation-review-panel"
        aria-label="Quotation review actions"
      >
        <h3>
          Quotation workflow ·{" "}
          {q.workflow_status ?? "Ready for approval submission"}
        </h3>
        {q.workflow_notes && (
          <aside aria-label="Latest quotation feedback">
            <strong>Latest review feedback</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{q.workflow_notes}</p>
          </aside>
        )}
        {manager && (
          <div aria-label="Discount and profitability preview">
            <p>
              Discount preview only. Saved quotation and PDF remain unchanged.{" "}
              {calculating ? "Updating totals…" : ""}
            </p>
            {metrics && !calculating && (
              <>
                <p>
                  Approved BOQ cost: PKR {money(metrics.cost)} · {metrics.basis}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Measure</th>
                      <th>Saved quotation</th>
                      <th>Proposed discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>Customer net payable</th>
                      <td>{money(metrics.original.payable)}</td>
                      <td>{money(metrics.proposed.payable)}</td>
                    </tr>
                    <tr>
                      <th>Profit excluding GST (PKR)</th>
                      <td>{money(metrics.original.profit)}</td>
                      <td>{money(metrics.proposed.profit)}</td>
                    </tr>
                    <tr>
                      <th>Profit % on cost</th>
                      <td>{metrics.original.profitPercent ?? "N/A"}%</td>
                      <td>{metrics.proposed.profitPercent ?? "N/A"}%</td>
                    </tr>
                    <tr>
                      <th>Margin % on pre-tax sales</th>
                      <td>{metrics.original.marginPercent ?? "N/A"}%</td>
                      <td>{metrics.proposed.marginPercent ?? "N/A"}%</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
        {(error || selected.failure) && <p role="alert">{error || selected.failure}</p>}
        {q.workflow_latest !== false &&
          !q.workflow_status &&
          (manager || author) && (
            <button
              disabled={busy}
              onClick={() => void transition("Submitted")}
            >
              Send for approval
            </button>
          )}
        {q.workflow_latest !== false &&
          q.workflow_status === "Submitted" &&
          author &&
          session.user.role === "Coordinator" && (
            <ExternalApproval
              key={q.id}
              session={session}
              endpoint={`/coordinator/quotations/${q.id}/external-approval`}
              onApproved={async () =>
                onChange(await api(`/commercial/quotations/${q.id}`))
              }
            />
          )}
        {q.workflow_status === "Submitted" && (manager || author) && (
          <SharePdf
            url={`/api/commercial/quotations/${q.id}/quotation.pdf`}
            filename={`${q.number}.pdf`}
          />
        )}
        {q.workflow_latest !== false &&
          q.workflow_status === "Submitted" &&
          manager && (
            <>
              <label>
                Review comments
                <textarea
                  aria-label="Review comments"
                  maxLength={1700}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button
                disabled={busy}
                onClick={() => void transition("Approved")}
              >
                Approve quotation
              </button>
              <button disabled={busy} onClick={() => setRevision(true)}>Issue discount order</button>
              <button disabled={busy} onClick={() => setRevision(true)}>
                Request revision
              </button>
              {revision && (
                <form
                  aria-label="Quotation revision feedback"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void transition("Changes requested");
                  }}
                >
                  <p>
                    Enter the requested changes in Review comments. A proposed
                    discount will be included in the revision feedback.
                  </p>
                  <button
                    disabled={
                      busy ||
                      !notes.trim() ||
                      (Number(effectiveDiscount.trim() || 0) !==
                        Number(q.snapshot.input.discount ?? 0) &&
                        (calculating || !metrics))
                    }
                  >
                    Confirm revision request
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRevision(false)}
                  >
                    Cancel revision request
                  </button>
                </form>
              )}
            </>
          )}
        {q.workflow_latest === false && (
          <p>
            This is a historical quotation. Open the latest version for workflow
            actions.
          </p>
        )}
      </section>
    </>
  );
}
