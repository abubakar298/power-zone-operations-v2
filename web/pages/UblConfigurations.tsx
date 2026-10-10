import {useEffect,useState} from 'react';
import {Decimal} from 'decimal.js';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {StatusBadge} from '../ui/StatusBadge.js';
import {money,decimalDisplay} from '../numbers.js';
import {displayUnit} from '../../server/boq/unit.js';

const amount=(v:string|null|undefined)=>v==null?'Unavailable':money(v);
function budgetSummary(s:any){
 if(!s)return {cost:null,selling:null,markup:null,percent:null};
 const cost=s.combinedTemplateBudget==null?null:new Decimal(s.combinedTemplateBudget);
 const selling=new Decimal(s.panel.sellingExcludingGst).add(new Decimal(s.fixedAgreedTotal).sub(s.panel.sellingIncludingGst).div('1.18'));
 const markup=cost?selling.sub(cost):null;
 return {cost:cost?.toString(),selling:selling.toString(),markup:markup?.toString(),percent:cost?.gt(0)&&markup?`${decimalDisplay(markup.div(cost).mul(100).toString(),2)}%`:null};
}
export function UblConfigurations({session,onBack}:{session:Session;onBack:()=>void}){
 const [list,setList]=useState<any[]>([]),[id,setId]=useState(()=>{const value=new URLSearchParams(window.location.hash.slice(1)).get('configuration');return ['20-20-30','25-20-30','30-30-40','35-30-40'].includes(value??'')?value!:''}),[detail,setDetail]=useState<any>(),[tab,setTab]=useState('Current BOQ');
 const [selectedBudget,setSelectedBudget]=useState<number>(),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){const data=await api<any>('/ubl');setList(await Promise.all(data.configurations.map(async (c:any)=>{const d=await api<any>(`/ubl/${c.id}`);return {...c,summary:d.canRefresh?d.budgets[0]?.snapshot:null};}))); }
 useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
 useEffect(()=>{let alive=true;setDetail(undefined);setSelectedBudget(undefined);setError('');if(id)void api<any>(`/ubl/${id}`).then(d=>{if(alive)setDetail(d)}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false};},[id]);
 async function refresh(){
  if(!notes.trim()){setError('Enter the reason for this dated budget refresh.');return;}
  if(!window.confirm('Create a new dated UBL budget from current Rate Master costs? Previous budgets and agreed prices will remain unchanged.'))return;
  setBusy(true);setError('');setMessage('');try{await api(`/ubl/${id}/budgets`,{csrf:session.csrfToken,body:{expectedVersion:detail.budgets[0]?.version??0,requestKey:crypto.randomUUID(),notes:notes.trim()}});setDetail(await api(`/ubl/${id}`));setSelectedBudget(undefined);setNotes('');setMessage('New budget version saved. Earlier budgets and fixed selling prices are preserved.');await load();}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const current=detail?.technical.at(-1),original=detail?.technical.find((t:any)=>t.version===1);
 const budget=detail?.budgets.find((b:any)=>b.version===(selectedBudget??detail.budgets[0]?.version));
 const snap=budget?.snapshot;
 const selectedSummary=budgetSummary(snap);
 return <section className="pz-stack" aria-busy={busy}>
  <div className="pz-action-row"><Button variant="neutral" onClick={onBack}>Back to Customers & Sites</Button></div>
  <div><h2>UBL Hybrid Solar configurations</h2><p>Agreed selling prices, original BOQs, current site amendments and dated budgets for United Bank Limited.</p></div>
  {error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status" className="form-success">{message}</p>}
  <div className="pz-table-scroll"><table className="master-table"><thead><tr><th>UBL option</th><th className="numeric">Budgeted cost (PKR)</th><th className="numeric">Selling price excl. GST (PKR)</th><th className="numeric">Budgeted markup amount (PKR)</th><th className="numeric">Budgeted markup %</th><th>Action</th></tr></thead><tbody>{list.map(c=>{const summary=budgetSummary(c.summary);return <tr key={c.id}><th>{c.id}</th><td className="numeric">{amount(summary.cost)}</td><td className="numeric">{amount(summary.selling)}</td><td className="numeric">{amount(summary.markup)}</td><td className="numeric">{summary.percent??'Unavailable'}</td><td><Button variant="secondary" onClick={()=>{setId(c.id);setTab('Current BOQ');setMessage('');window.history.replaceState(null,'',`/dashboard#workspace=ubl&configuration=${c.id}`)}}>Open {c.id}</Button></td></tr>})}</tbody></table></div>
  <p>Latest saved budgets, excluding GST. Markup is calculated on cost from the agreed selling price excluding GST. Confidential figures are available only to Management and Administrator.</p>
  {id&&!detail&&<p role="status">Loading saved configuration…</p>}
  {detail&&<><div className="pz-panel pz-stack"><h3>{id} · UBL Hybrid Solar</h3><div className="pz-action-row" role="group" aria-label="UBL configuration sections">{['Current BOQ','Original agreed BOQ','Budget versions','Negotiation history'].map(t=><Button key={t} variant="neutral" aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</Button>)}</div>
   <p><a href={`/api/ubl/${id}/source.pdf`} download>Download original Financial Proposal R3</a> · Original document preserved.</p>
   {(tab==='Current BOQ'||tab==='Original agreed BOQ')&&<><h4>{tab} · Technical V{tab==='Current BOQ'?current.version:1}</h4>{tab==='Current BOQ'&&<p>{current.notes} <strong>Date unspecified.</strong></p>}<div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Item</th><th>Description / agreed specification</th><th>Brands</th><th>UOM</th><th className="numeric">Qty</th><th>Scope</th></tr></thead><tbody>{(tab==='Current BOQ'?current:original).snapshot.rows.map((r:any)=><tr key={r.id}><td>{r.id}</td><td><strong>{r.description}</strong><br/>{r.specification}{r.routeAllowance&&<><br/>{r.routeAllowance}</>}</td><td>{r.brands}</td><td>{displayUnit(r.unit,r.quantity)}</td><td className="numeric">{decimalDisplay(r.quantity,2)}</td><td>{r.includedIn?'Included with inverter — no separate cost':r.deferred?'Deferred internet — no cost or allocation assumed':r.bundle?`${r.bundle} bundle; constituent retained`:'Included'}</td></tr>)}</tbody></table></div></>}
   {tab==='Negotiation history'&&<><h4>Commercial negotiation history</h4><p>Historical summary budgets remain as supplied; no historical item-cost breakdown is inferred.</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Stage</th><th>Agreed date</th><th className="numeric">Total incl. GST</th><th className="numeric">Panels excl. GST</th>{detail.canRefresh&&<th className="numeric">Historical summary budget</th>}<th>Technical scope</th></tr></thead><tbody>{detail.history.map((h:any)=><tr key={h.stage}><th>{h.stage}</th><td>{h.snapshot.date}</td><td className="numeric">{amount(h.snapshot.totalIncludingGst)}</td><td className="numeric">{amount(h.snapshot.panelSellingExcludingGst)}</td>{detail.canRefresh&&<td className="numeric">{amount(h.snapshot.historicalSummaryBudget)}</td>}<td>Original agreed BOQ V{h.snapshot.technicalVersion}</td></tr>)}</tbody></table></div><p>R3 PDF proposal-stage final: PKR {amount(detail.configuration.source.proposalStageFinalTotal)}. The confirmed 10 July 2026 agreed price takes precedence.</p><h4>Later technical amendments</h4><p>{current.notes}</p><p><strong>Date unspecified</strong> · Technical V2, separately identifiable from the July commercial agreement.</p></>}
   {tab==='Budget versions'&&<><h4>Dated budget versions</h4><p>Opening a saved budget does not refresh rates. Budgeted costs use the saved Rate Master buying rates. Markup is calculated from agreed selling prices excluding GST.</p>
    {detail.canRefresh&&<div className="pz-stack"><label htmlFor="ubl-budget-notes">Budget refresh reason</label><input id="ubl-budget-notes" value={notes} onChange={e=>setNotes(e.target.value)} disabled={busy}/><div><Button variant="primary" onClick={()=>void refresh()} disabled={busy}>{busy?'Saving budget…':detail.budgets.length?'Refresh costs — create new version':'Create initial dated budget'}</Button></div></div>}
    {!detail.budgets.length?<p>No budget has been saved. Management or Administrator can create the initial dated budget.</p>:<><label htmlFor="ubl-budget-version">Saved budget</label><select id="ubl-budget-version" value={selectedBudget??detail.budgets[0].version} onChange={e=>setSelectedBudget(Number(e.target.value))}>{detail.budgets.map((b:any)=><option key={b.id} value={b.version}>V{b.version} · {new Date(b.created_at).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})} · {b.created_by_name}</option>)}</select><p>Refresh reason: {budget.notes}</p><StatusBadge tone={snap.issues.length?'warning':'success'}>{snap.issues.length?'Missing Rate Master inputs':'Budget costs complete'}</StatusBadge>
     <div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Item / Rate Master mapping</th><th>Status</th><th className="numeric">Budgeted cost (PKR)</th></tr></thead><tbody>{snap.rows.map((r:any)=><tr key={r.id}><td><strong>{r.id} · {r.description}</strong><ul>{r.components.map((p:any)=><li key={p.key}>{p.key} · {decimalDisplay(p.quantity,2)} {p.rateUnit??''} · {p.rateVersion?`Rate V${p.rateVersion} (${p.rateStatus})`:'Missing from Rate Master'}{p.rate!=null&&<> · Rate: PKR {amount(p.rate)} per {p.rateUnit??'unit'}</>}{p.cost!=null&&<> · PKR {amount(p.cost)}</>}</li>)}</ul></td><td>{r.includedIn?'Included with inverter — no separate cost':r.cost==null?'Missing rate':'Budgeted from Rate Master'}</td><td className="numeric">{amount(r.cost)}</td></tr>)}</tbody></table></div>
     {detail.canRefresh&&<p>Saved V{budget.version}: budgeted cost PKR {amount(selectedSummary.cost)} · markup PKR {amount(selectedSummary.markup)} · markup {selectedSummary.percent??'Unavailable'}.</p>}
     <p>Enter missing purchasing rates in Rate Master using the listed mapping names, then refresh costs to save a new dated budget. Missing rates are not treated as zero. Markup percentages are calculated on purchasing cost, not on sales.</p>
     {!!snap.issues.length&&<div className="pz-stack"><h4>Inputs awaiting review</h4>{snap.issues.map((issue:any)=><p key={issue.id}><strong>{issue.id}</strong> · {issue.reason}</p>)}</div>}
    </>}
   </>}
  </div></>}
 </section>;
}
