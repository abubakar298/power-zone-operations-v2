import { Decimal } from "decimal.js";
import { useEffect, useState, type ReactNode } from "react";
import { api, type Session } from "../api.js";
import { confirmTransition } from "../confirm.js";
import type { QuotationSnapshot } from "../../server/commercial/engine.js";
const money = (v: string) =>
  Number(v).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const [metrics, setMetrics] = useState<any>();
  const [calculating, setCalculating] = useState(false);
  useEffect(() => {
    setDiscount(q.snapshot.input.discount ?? "0");
    setMetrics(undefined);
    setRevision(false);
    setNotes("");
    setError("");
  }, [q.id]);
  useEffect(() => {
    if (!manager) return;
    let cancelled = false;
    setCalculating(true);
    const timer = setTimeout(() => {
      void api(`/commercial/quotations/${q.id}/discount-review`, {
        body: { discount: discount.trim() || "0" },
        csrf: session.csrfToken,
      })
        .then((value) => {
          if (!cancelled) {
            setMetrics(value);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setMetrics(undefined);
            setError(e.message);
          }
        })
        .finally(() => {
          if (!cancelled) setCalculating(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q.id, discount, manager, session.csrfToken]);
  async function transition(kind: string) {
    const proposedChange =
      manager &&
      (discount.trim() || "0") !== String(q.snapshot.input.discount ?? "0") &&
      metrics &&
      Number(discount || 0) !== Number(q.snapshot.input.discount ?? 0);
    if (kind === "Approved" && proposedChange) {
      setError(
        "This discount is a preview. Request revision with the proposed discount before approving the saved quotation.",
      );
      return;
    }
    if (
      !confirmTransition(
        kind === "Approved"
          ? "Approve quotation"
          : kind === "Submitted"
            ? "Send quotation for approval"
            : "Request quotation revision",
        `${q.number} will move to the next workflow stage. The saved quotation stays unchanged.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const feedback =
        kind === "Changes requested" && proposedChange
          ? `${notes.trim()}\nProposed total discount: PKR ${money(discount || "0")}. Proposed net payable: PKR ${money(metrics.proposed.payable)}.`
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
  const normalizedDiscount = discount.trim() || "0";
  const gross = new Decimal(q.snapshot.footer.at(-1).amount).add(
    q.snapshot.input.discount ?? "0",
  );
  const validDiscount =
    /^\d{1,12}(\.\d{1,2})?$/.test(normalizedDiscount) &&
    new Decimal(normalizedDiscount).lte(gross);
  const snapshot =
    manager && validDiscount
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
      {renderPreview(
        snapshot,
        manager ? discount : undefined,
        manager ? setDiscount : undefined,
      )}
      <section aria-label="Quotation review actions">
        <h3>
          Quotation workflow ·{" "}
          {q.workflow_status ?? "Ready for approval submission"}
        </h3>
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
                      <th>Profit (PKR)</th>
                      <td>{money(metrics.original.profit)}</td>
                      <td>{money(metrics.proposed.profit)}</td>
                    </tr>
                    <tr>
                      <th>Profit % on cost</th>
                      <td>{metrics.original.profitPercent ?? "N/A"}%</td>
                      <td>{metrics.proposed.profitPercent ?? "N/A"}%</td>
                    </tr>
                    <tr>
                      <th>Margin % on sales</th>
                      <td>{metrics.original.marginPercent ?? "N/A"}%</td>
                      <td>{metrics.proposed.marginPercent ?? "N/A"}%</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
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
          manager && (
            <>
              <label>
                Review comments
                <textarea
                  maxLength={1700}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button
                disabled={busy || calculating || !metrics}
                onClick={() => void transition("Approved")}
              >
                Approve quotation
              </button>
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
                    disabled={busy || !notes.trim() || calculating || !metrics}
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
