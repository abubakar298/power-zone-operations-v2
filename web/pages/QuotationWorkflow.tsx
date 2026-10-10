import {RevisionComparison,hasRevisionPriceChange} from '../components/RevisionComparison.js';
import { BoqCosting } from "./BoqCosting.js";
import { money } from "../numbers.js";
import { SharePdf } from "../components/SharePdf.js";
import { ExternalApproval } from "../components/ExternalApproval.js";
import { CostingWorkflowHistory } from "../components/CostingWorkflowHistory.js";
import { Decimal } from "decimal.js";
import { useEffect, useState, type ReactNode } from "react";
import { api, type Session } from "../api.js";
import { confirmTransition, confirmRevision, confirmDiscountProposal } from "../confirm.js";
import type { QuotationSnapshot } from "../../server/commercial/engine.js";
function useAdjustmentPreview(q: any, session: Session, enabled: boolean, kind: "discount" | "targetMarkup", value: string) {
  const [result, setResult] = useState<any>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    setResult(undefined); setFailure("");
    if (!enabled || (kind === "targetMarkup" && !value.trim())) { setPending(false); return; }
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
  const [costing,setCosting]=useState<any>(),[costingError,setCostingError]=useState("");
  useEffect(()=>{let active=true;setCosting(undefined);setCostingError("");if(manager&&q.boq_revision_id)api<any>(`/boqs/${q.boq_revision_id}`).then(r=>{if(active)setCosting(r);}).catch(e=>{if(active)setCostingError(e.message);});return()=>{active=false;};},[manager,q.boq_revision_id]);

  const [priceAcknowledged,setPriceAcknowledged]=useState(false);
  const [notes, setNotes] = useState("");
  const [revision, setRevision] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discount, setDiscount] = useState(q.snapshot.input.discount ?? "0");
  const [mode, setMode] = useState<"discount" | "margin">("discount");
  const [targetMargin, setTargetMargin] = useState("");
  const percentageValid = /^\d{1,2}(\.\d{1,2})?$/.test(targetMargin.trim());
  const lump = useAdjustmentPreview(q, session, manager, "discount", discount);
  const baseline = useAdjustmentPreview(q, session, manager, "discount", q.snapshot.input.discount ?? "0");
  const target = useAdjustmentPreview(q, session, manager && percentageValid, "targetMarkup", targetMargin);
  const selected = mode === "discount" ? lump : target;
  const metrics = selected.result;
  const calculating = selected.pending;
  const effectiveDiscount = mode === "discount" ? discount : (target.result?.discount ?? "");
  useEffect(() => {
    setDiscount(q.snapshot.input.discount ?? "0"); setMode("discount");
    setTargetMargin(""); setRevision(false); setNotes(""); setError("");
  }, [q.id]);
  async function createFinalQuotation(){
    const choices:Array<{key:"discount"|"margin";label:string;discount:string;payable:string}>=[];
    if(lump.result&&!lump.pending&&!lump.failure)choices.push({key:"discount",label:"Discount amount",discount:money(lump.result.discount),payable:money(lump.result.proposed.payable)});
    if(targetMargin.trim()&&target.result&&!target.pending&&!target.failure)choices.push({key:"margin",label:`Target markup ${targetMargin}%`,discount:money(target.result.discount),payable:money(target.result.proposed.payable)});
    if(!choices.length){setError("Wait for a valid adjustment comparison.");return;}
    const chosen=await confirmDiscountProposal(choices);if(!chosen)return;
    const value=chosen==="discount"?lump.result:target.result;
    if(!notes.trim()){setError("Enter adjustment instructions for Atif in Review comments.");return;}
    if(!confirmTransition("Send adjustments to Atif","The quotation will move to Revision required. Atif must revise and resubmit it for your final approval."))return;
    setBusy(true);setError("");try{await api("/coordinator/events",{csrf:session.csrfToken,body:{quotationId:q.id,kind:"Changes requested",notes:`${notes.trim()}\nProposed total discount: PKR ${money(value.discount)}. Proposed net payable: PKR ${money(value.proposed.payable)}.`}});onChange(await api(`/commercial/quotations/${q.id}`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function transition(kind: string) {
    let actionDiscount = effectiveDiscount;
    let actionMetrics = metrics;

    if (kind === "Changes requested" && manager && (targetMargin.trim() || (discount.trim() && Number(discount) !== Number(q.snapshot.input.discount ?? 0)))) {
      if ((!discount.trim() && !targetMargin.trim()) || (discount.trim() && (lump.pending || !lump.result)) || (targetMargin.trim() && (target.pending || !target.result || !percentageValid))) {
        setError("Enter at least one valid discount proposal and wait for its calculated totals."); return;
      }
      const choices: Array<{key: "discount" | "margin"; label: string; discount: string; payable: string}> = [];
      if (discount.trim()) choices.push({key: "discount", label: "Discount amount", discount: money(lump.result.discount), payable: money(lump.result.proposed.payable)});
      if (targetMargin.trim()) choices.push({key: "margin", label: `Target markup ${targetMargin}%`, discount: money(target.result.discount), payable: money(target.result.proposed.payable)});
      const chosen = await confirmDiscountProposal(choices);
      if (!chosen) return;
      setMode(chosen);
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
      !(await (
        ["Changes requested", "Approved"].includes(kind)
          ? confirmRevision
          : async (a: string, d: string) => confirmTransition(a, d)
      )(
        kind === "Approved"
          ? "Approve quotation"
          : kind === "Submitted"
            ? "Send quotation for approval"
            : "Request quotation revision",
        `${q.number} will move to the next workflow stage. The saved quotation stays unchanged.${kind === "Changes requested" && actionMetrics ? ` Proposed discount: PKR ${money(actionDiscount)}. Customer payable: PKR ${money(actionMetrics.proposed.payable)}.` : ""}`,
      ))
    )
      return;
    if(kind==="Approved"&&hasRevisionPriceChange(q.snapshot)&&!priceAcknowledged){setError("Review and acknowledge the changed payable before approving.");return;}
    setBusy(true);
    setError("");
    try {
      const feedback =
        kind === "Changes requested" && proposedChange
          ? `${notes.trim()}\nProposed total discount: PKR ${money(actionDiscount || "0")}. Proposed net payable: PKR ${money(actionMetrics.proposed.payable)}.`
          : notes.trim();
      await api("/coordinator/events", {
        body: { quotationId: q.id, kind, notes: feedback, acknowledgePriceChange:priceAcknowledged },
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
      <RevisionComparison snapshot={q.snapshot} acknowledged={priceAcknowledged} onAcknowledge={manager?setPriceAcknowledged:undefined}/>
      {q.external_approval && (
        <section aria-label="Recorded external approval">
          <strong>External approval recorded</strong>
          <p>
            Method: {q.external_approval.channel} · Approver:{" "}
            {q.external_approval.approver} · {q.external_approval.comments}
          </p><p>Document: {q.number} · Recorded by: {q.external_approval.recorded_by_name??"Not available"} · Recorded: {new Date(q.external_approval.created_at).toLocaleString()} · Decision date: {q.external_approval.decision_at?new Date(q.external_approval.decision_at).toLocaleString():"Not available"}
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
          <p>Enter a discount amount, a target markup percentage, or both to compare their effects. Choose the proposal only when sending for revision. Saved quotation values remain unchanged.</p>
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 270px), 1fr))", gap: "1rem"}}>
            {(["discount", "margin"] as const).map(choice => {
              const state = choice === "discount" ? lump : (targetMargin.trim() ? target : baseline);
              return <section key={choice} aria-label={choice === "discount" ? "Discount amount comparison" : "Target markup comparison"} className="detail-panel">
                <h4>{choice === "discount" ? "Discount amount" : "Target markup"}</h4>
                <label>{choice === "discount" ? "Discount amount (PKR)" : "Target markup (%)"}
                  <input aria-label={choice === "discount" ? "Management discount amount (PKR)" : "Target markup (%)"} type="number" min="0" max={choice === "margin" ? "99.99" : undefined} step="0.01" value={choice === "discount" ? discount : targetMargin} onChange={e => choice === "discount" ? setDiscount(e.target.value) : setTargetMargin(e.target.value)} />
                </label>
                <div aria-live="polite">
                  {state.pending ? <p>Updating totals…</p> : (choice === "margin" && targetMargin.trim() && !percentageValid) ? <p role="alert">Enter a target markup percentage from 0 to 100, with at most two decimal places.</p> : state.failure ? <p role="alert">{state.failure}</p> : state.result ? <div className="table-scroll"><table>
                    <thead><tr><th>Measure</th><th>Quoted / budgeted</th><th>After discount</th></tr></thead>
                    <tbody>
                      <tr><th>Budgeted cost (PKR)</th><td>{money(state.result.cost)}</td><td>{money(state.result.cost)}</td></tr>
                      <tr><th>Budgeted profit (PKR)</th><td>{money(state.result.original.profit)}</td><td>{money(state.result.proposed.profit)}</td></tr>
                      <tr><th>Quoted price without GST (PKR)</th><td>{money(state.result.original.revenue)}</td><td>{money(state.result.proposed.revenue)}</td></tr>
                      <tr><th>Applicable GST (PKR)</th><td>{money(state.result.original.tax)}</td><td>{money(state.result.proposed.tax)}</td></tr>
                      <tr><th>Final payable (PKR)</th><td>{money(state.result.original.payable)}</td><td>{money(state.result.proposed.payable)}</td></tr>
                      <tr><th>Discount amount (PKR)</th><td>{money(q.snapshot.input.discount ?? "0")}</td><td>{money(state.result.discount)}</td></tr>
                      <tr><th>Markup on cost</th><td>{state.result.original.profitPercent ?? "N/A"}%</td><td>{state.result.proposed.profitPercent ?? "N/A"}%</td></tr>
                    </tbody>
                  </table></div> : <p>Enter a discount to compare.</p>}
                </div>
              </section>;
            })}
          </div>
          <p>Target markup uses approved budgeted cost: pre-tax selling price = cost × (1 + markup %). Profit and markup exclude GST. Solar remains unchanged under the existing discount allocation policy.</p>
          {q.workflow_latest !== false && q.workflow_status === "Submitted" && <>
            <label>Revision instructions<textarea aria-label="Discount revision instructions" maxLength={1700} value={notes} onChange={e => setNotes(e.target.value)} /></label>
            <button disabled={busy || !notes.trim()} onClick={() => void transition("Changes requested")}>Send for revision</button>
          </>}

        </section>
      )}
      {manager&&costingError&&<p role="alert">{costingError}</p>}
      {manager&&costing&&<section className="detail-panel"><h3>Project Costing Summary</h3>{([costing.snapshot.summary,costing.snapshot.epc] as any[][]).map((rows,index)=><div key={index}>{index===1&&<h4>EPC Summary</h4>}<div className="table-scroll"><table><thead><tr><th>{index?"EPC category":"Project category"}</th><th>Budgeted cost (PKR)</th></tr></thead><tbody>{rows.map(row=><tr key={row.name}><th>{row.name}</th><td>{money(row.cost)}</td></tr>)}</tbody><tfoot><tr><th>{index?"Total EPC":"Total Project Cost"}</th><td><strong>{money(rows.reduce((total,row)=>total.plus(row.cost),new Decimal(0)).toString())}</strong></td></tr></tfoot></table></div></div>)}</section>}
      {renderPreview(q.snapshot)}
      {manager&&costing&&<BoqCosting snapshot={costing.snapshot} number={costing.number} createdAt={costing.created_at} pdfUrl={`/api/boqs/${costing.id}/costing.pdf`}/>}

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
                Final approve quotation
              </button>
              <button disabled={busy||lump.pending||target.pending} onClick={()=>void createFinalQuotation()}>Send selected adjustments to Atif</button>
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
