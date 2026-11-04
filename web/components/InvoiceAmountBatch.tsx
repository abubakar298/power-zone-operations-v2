import {useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {FinancialValue} from '../ui/FinancialValue.js';
type Line={rowId:string;invoice:string;site:string;customer:string;programme:string;ipo:string;order:string;proposedAmount:string;outstanding:string;received:string|null};
type Skip={rowId:string;invoice:string;site:string;customer:string;kind:'skipped'|'exception';reason:string};
type Plan={sourceVersion:number;fingerprint:string;reference:string;basis:string;eligible:Line[];skipped:Skip[];totals:{programme:string;amount:string;count:number;total:string;outstanding:string}[];total:string;batches:{reference:string;applied:number;created_at:string;applied_by:string}[]};
const top={verticalAlign:'top'} as const;
/** Owner-confirmed bulk entry of missing original amounts: review the live list, then apply it once. */
export function InvoiceAmountBatch({onApplied}:{onApplied:()=>void}){
 const [plan,setPlan]=useState<Plan>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
 async function review(){setBusy(true);setError('');setResult('');try{setPlan(await api<Plan>('/accounts-workspace/invoice-amount-batch'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function apply(){
  if(!plan||!window.confirm(`Fill ${plan.eligible.length} original invoice amounts (total PKR ${Number(plan.total).toLocaleString('en-PK')})? Outstanding balances, payments and submissions stay unchanged.`))return;
  setBusy(true);setError('');
  try{const session=await api<any>('/auth/session'),saved=await api<any>('/accounts-workspace/invoice-amount-batch',{csrf:session.csrfToken,body:{fingerprint:plan.fingerprint}});setResult(`${saved.reference}: ${saved.applied} invoice amounts ${saved.alreadyApplied?'were already applied':'applied'}. Outstanding balances and payments are unchanged.`);setPlan(undefined);onApplied();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const exceptions=plan?.skipped.filter(s=>s.kind==='exception')??[],skipped=plan?.skipped.filter(s=>s.kind==='skipped')??[];
 return <details className="accounts-list-panel"><summary>Owner-confirmed UPS invoice amounts</summary>
  <p className="pz-caption">Fills the missing original invoice total for verified standard UPS invoices in “Outstanding known, original invoice total missing”: UBL CHP-163 (6 kW / 10 kWh) PKR 450,000 — the remaining balance invoice, not the 900,000 contract — and Meezan 80-site (6 kW / 5 kWh) PKR 660,000. Each record is matched to its own customer, programme and site; balances, payments and submissions are not changed.</p>
  <div className="pz-action-row"><Button variant="secondary" loading={busy&&!plan} disabled={busy} onClick={()=>void review()}>{plan?'Review list again':'Review list'}</Button>{plan&&!!plan.eligible.length&&<Button variant="primary" loading={busy} onClick={()=>void apply()}>Apply {plan.eligible.length} amounts</Button>}</div>
  {result&&<p role="status">{result}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
  {plan&&<>
   <p className="pz-caption">Batch {plan.reference} · source version {plan.sourceVersion} · {plan.eligible.length} to fill · {exceptions.length} exceptions · {skipped.length} skipped. Total original amounts to fill: PKR <FinancialValue places={0} value={plan.total}/> (not new revenue or receivables).</p>
   <div className="pz-table-scroll"><table><thead><tr><th>SR#</th><th>Programme</th><th>Amount per invoice · PKR</th><th>Invoices</th><th>Amounts to fill · PKR</th><th>Outstanding kept · PKR</th></tr></thead><tbody>{plan.totals.map((t,i)=><tr key={t.programme}><td style={top}>{i+1}</td><td style={top}><strong>{t.programme}</strong></td><td style={top}><FinancialValue places={0} value={t.amount}/></td><td style={top}>{t.count}</td><td style={top}><FinancialValue places={0} value={t.total}/></td><td style={top}><FinancialValue places={0} value={t.outstanding}/></td></tr>)}</tbody></table></div>
   {!!plan.eligible.length&&<div className="pz-table-scroll"><table><thead><tr><th>SR#</th><th>Invoice / site</th><th>Customer / programme</th><th>Current amount</th><th>Proposed amount · PKR</th><th>Outstanding kept · PKR</th></tr></thead><tbody>{plan.eligible.map((r,i)=><tr key={r.rowId}><td style={top}>{i+1}</td><td style={top}><strong>{r.invoice}</strong><small>{r.site} · {r.ipo} · {r.order}</small></td><td style={top}><strong>{r.customer}</strong><small>{r.programme}</small></td><td style={top}>Not recorded</td><td style={top}><FinancialValue places={0} value={r.proposedAmount}/></td><td style={top}><FinancialValue places={0} value={r.outstanding}/>{r.received&&Number(r.received)>0&&<small>Received {Number(r.received).toLocaleString('en-PK')}</small>}</td></tr>)}</tbody></table></div>}
   {!!plan.skipped.length&&<div className="pz-table-scroll"><table><thead><tr><th>SR#</th><th>Invoice / site</th><th>Customer</th><th>Result</th><th>Reason</th></tr></thead><tbody>{[...exceptions,...skipped].map((r,i)=><tr key={r.rowId}><td style={top}>{i+1}</td><td style={top}><strong>{r.invoice||'—'}</strong><small>{r.site}</small></td><td style={top}>{r.customer}</td><td style={top}><strong>{r.kind==='exception'?'Exception · review':'Skipped'}</strong></td><td style={top}>{r.reason}</td></tr>)}</tbody></table></div>}
   {!!plan.batches.length&&<p className="pz-caption">Applied batches: {plan.batches.map(b=>`${b.reference} · ${b.applied} amounts · ${b.applied_by} · ${String(b.created_at).slice(0,10)}`).join(' | ')}</p>}
  </>}
 </details>;
}
