import {useState} from 'react';
import {Decimal} from 'decimal.js';
import {wholeMoney} from '../numbers.js';
const stages=[{key:'submitted',label:'Invoice submitted',clock:'Since submission'},{key:'awaiting-completion',label:'Awaiting completion',clock:'Since delivery'},{key:'unsubmitted',label:'Invoice not submitted',clock:'Since completion'},{key:'review',label:'Invoice status needs review',clock:'Date required'}];
const bands=[{key:'0-7',label:'0–7 days',color:'var(--pz-age-recent)'},{key:'8-14',label:'8–14 days',color:'var(--pz-age-followup)'},{key:'15-30',label:'15–30 days',color:'var(--pz-age-attention)'},{key:'31+',label:'31+ days',color:'var(--pz-age-overdue)'},{key:'unknown',label:'Date required',color:'var(--pz-age-unknown)'}];
export function UpsReceivablesAgeing({programs}:{programs:any[]}){
 const [hovered,setHovered]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null);
 const rows=programs.flatMap(p=>(p.progressSummary?.receivablesAgeing?.rows??[]).map((r:any)=>({...r,siteId:`${p.programKey}:${r.orderNumber}`,id:`${p.programKey}:${r.orderNumber}:${r.invoice}`})));
 const unverified=programs.reduce((n,p)=>n+(p.progressSummary?.receivablesAgeing?.unverifiedPaymentSites??0),0),amountRequired=programs.reduce((n,p)=>n+(p.progressSummary?.receivablesAgeing?.amountRequiredSites??0),0);
 const groups=stages.filter(s=>s.key!=='review'||rows.some(r=>r.stage==='review')).map(s=>{const scoped=rows.filter(r=>r.stage===s.key);return {...s,total:scoped.reduce((n,r)=>n.add(r.amount),new Decimal(0)),bands:bands.map(b=>{const matching=scoped.filter(r=>r.band===b.key);return {...b,id:`${s.key}:${b.key}`,rows:matching,amount:matching.reduce((n,r)=>n.add(r.amount),new Decimal(0))};})};});
 const maximum=Decimal.max(1,...groups.map(g=>g.total));
 const segments=groups.flatMap(g=>g.bands.map(b=>({...b,stage:g.label})));
 const popup=segments.find(b=>b.id===hovered),current=segments.find(b=>b.id===selected);
 return <section className="pz-panel pz-stack pz-ups-receivables" aria-label="Receivables ageing" onKeyDown={e=>{if(e.key==='Escape')setHovered(null);}}>
  <div><h3>Receivables Ageing</h3><p className="pz-caption">Outstanding system invoices · PKR including GST</p></div>
  <div className="pz-ups-receivables-legend">{bands.filter(b=>b.key!=='unknown'||rows.some(r=>r.band==='unknown')).map(b=><span key={b.key}><i className="pz-ups-ageing-swatch" style={{background:b.color}} aria-hidden="true"/>{b.label}</span>)}</div>
  {groups.map(g=><div key={g.key} className="pz-ups-receivables-row"><div className="pz-ups-receivables-label"><div><strong>{g.label}</strong><small>{g.clock}</small></div></div>
   <div className="pz-ups-receivables-track" onMouseLeave={()=>setHovered(null)}>
    {g.total.gt(0)?g.bands.filter(b=>b.amount.gt(0)).map(b=><button key={b.key} type="button" className="pz-ups-receivables-segment" style={{background:b.color,width:`${b.amount.div(maximum).mul(100).toString()}%`,color:b.key==='8-14'?'var(--pz-surface)':'var(--pz-text)'}} aria-label={`${g.label}, ${b.label}: PKR ${wholeMoney(b.amount.toString())}`} aria-pressed={selected===b.id} onMouseEnter={()=>setHovered(b.id)} onFocus={()=>setHovered(b.id)} onBlur={()=>setHovered(null)} onClick={()=>setSelected(selected===b.id?null:b.id)}><span>{wholeMoney(b.amount.toString())}</span><small>{new Set(b.rows.map(r=>r.siteId)).size} {new Set(b.rows.map(r=>r.siteId)).size===1?'site':'sites'}</small></button>):<span className="pz-caption">None recorded</span>}
    {popup&&popup.id.startsWith(g.key+':')&&<div role="tooltip" className="pz-ups-ageing-tooltip"><strong>{popup.stage} · {popup.label}</strong>{popup.rows.slice(0,5).map(r=><div key={r.id}><span>{r.orderNumber} · {r.site||'Name required'}</span><small>PKR {wholeMoney(r.amount)} · {r.days??'—'} days</small></div>)}{popup.rows.length>5&&<small>+{popup.rows.length-5} more · select to view all</small>}</div>}
   </div>
  </div>)}
  {current&&<div className="pz-table-scroll"><table className="master-table"><caption>{current.stage} · {current.label}</caption><thead><tr><th>Order</th><th>Site</th><th>Invoice</th><th className="numeric">Days</th><th className="numeric">PKR incl. GST</th></tr></thead><tbody>{current.rows.map(r=><tr key={r.id}><td>{r.orderNumber}</td><td>{r.site||'Name required'}</td><td>{r.invoice}</td><td className="numeric">{r.days??'Date required'}</td><td className="numeric">{wholeMoney(r.amount)}</td></tr>)}</tbody></table></div>}
  <p className="pz-caption">Extra cables excluded.{unverified>0?` ${unverified} payment statuses unverified.`:''}{amountRequired>0?` ${amountRequired} invoice amounts required.`:''}</p>
 </section>;
}
