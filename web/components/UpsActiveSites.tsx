import {useState,type ReactNode} from 'react';
import {Decimal} from 'decimal.js';
import {wholeMoney} from '../numbers.js';
import {Button} from '../ui/Button.js';
import {UpsDeliveryAgeing} from './UpsDeliveryAgeing.js';

export function UpsActiveSites({register,children}:{register:any,onPreview:(id:string)=>void,children?:ReactNode,prices?:any[]}){
 const [configuration,setConfiguration]=useState(register.configurations.find((c:any)=>c.activeSites>0)?.configuration??register.configurations[0]?.configuration??'');
 const [showRequired,setShowRequired]=useState(false);
 const programs=register.programs.filter((p:any)=>p.configuration===configuration),scoped=register.configurations.find((c:any)=>c.configuration===configuration);
 const total=(key:string)=>programs.reduce((n:number,p:any)=>n+(p.progressSummary?.[key]??0),0);
 const agreedSites=programs.reduce((n:number,p:any)=>n+p.totalSites,0);
 const amount=(key:string)=>programs.reduce((n:Decimal,p:any)=>n.add(p.progressSummary?.[key]??0),new Decimal(0));
 const money=(n:Decimal|null)=>n===null?'Needs reconciliation':`PKR ${wholeMoney(n.toString())}`;
 const cards=[
  {label:'Active Sites',count:`${scoped?.activeSites??0}/${agreedSites}`,detail:''},
  {label:'Completed',count:`${total('completed')}/${scoped?.activeSites??0}`,detail:`Incomplete Sites: ${total('remainingToComplete')}`},
  {label:'Delivered',count:`${total('delivered')}/${total('remainingToComplete')}`,detail:'Installation pending'},
  {label:'Data Required',count:total('dataRequired'),detail:'Completed sites · recovery and payment details required'},
  ...(total('reviewRequired')?[{label:'Accounts review required',count:total('reviewRequired'),detail:'Installation evidence needs reconciliation'}]:[]),
  {label:'Extra cable invoices',count:total('extraCableInvoices'),detail:`Payable: ${money(amount('extraCablePayable'))}`,notes:[`Paid: ${money(amount('extraCablePaid'))}`,`Balance: ${money(amount('extraCableBalance'))}`]}
 ];
 return <section className="workspace-buckets pz-stack" aria-label="Active UPS sites">
  <h3>{configuration==='6-5'?'6 kW + 5 kWh':'6 kW + 10 kWh'}</h3>
  {register.configurations.length>1&&<div className="pz-action-row">{register.configurations.map((c:any)=><Button key={c.configuration} variant={configuration===c.configuration?'secondary':'neutral'} aria-pressed={configuration===c.configuration} onClick={()=>setConfiguration(c.configuration)}>{c.configuration==='6-5'?'6 kW + 5 kWh':'6 kW + 10 kWh'}</Button>)}</div>}
  <div className="stage-grid">{cards.map(c=>c.label==='Data Required'?<button type="button" className={`stage-card${showRequired?' selected':''}`} key={c.label} aria-expanded={showRequired} onClick={()=>setShowRequired(!showRequired)}><span>{c.label}</span><strong>{c.count}</strong><small>{c.detail}</small></button>:<article className="stage-card" key={c.label}><span style={['Active Sites','Completed','Delivered'].includes(c.label)?{fontSize:'var(--pz-text-lg)'}:undefined}>{c.label}</span><strong>{c.count}</strong>{c.detail&&<small>{c.detail}</small>}{c.notes?.map(note=><small key={note}>{note}</small>)}</article>)}</div>
  {showRequired&&<section className="pz-panel pz-stack" aria-label="Completed sites requiring data"><div className="pz-action-row"><h3>Data Required</h3><Button variant="neutral" onClick={()=>setShowRequired(false)}>Close</Button></div><p>These sites are completed per Management confirmation. Missing dates and remaining system payments are unverified.</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Site / order</th><th>Site name</th><th>Data required</th></tr></thead><tbody>{register.rows.filter((r:any)=>r.configuration===configuration&&r.dataRequired).map((r:any)=><tr key={r.id}><td>{r.orderNumber}</td><td>{r.site||'Name required'}</td><td>{r.dataRequired.fields.join('; ')}</td></tr>)}{!total('dataRequired')&&<tr><td colSpan={3}>No sites currently require additional data.</td></tr>}</tbody></table></div></section>}
  {programs.some((p:any)=>p.programKey.startsWith('UPS:UBL:'))&&<UpsDeliveryAgeing key={configuration} rows={programs.flatMap((p:any)=>(p.progressSummary?.deliveryAgeing??[]).map((r:any)=>({...r,id:`${p.programKey}:${r.orderNumber}`})))} asOf={programs[0]?.progressSummary?.deliveryAgeingAsOf}/>}
  {children}
  {register.programs.some((p:any)=>p.configuration===configuration)&&<div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Batch order</th><th className="numeric">Sites ordered</th><th className="numeric">Active sites</th><th className="numeric">Remaining</th></tr></thead><tbody>{register.programs.filter((p:any)=>p.configuration===configuration).map((p:any)=><tr key={p.programKey}><th>{p.projectReference}</th><td className="numeric">{p.totalSites}</td><td className="numeric">{p.activeSites}</td><td className="numeric">{p.remainingSites}</td></tr>)}</tbody></table></div>}
  {register.programs.filter((p:any)=>p.configuration===configuration).map((p:any)=>{const s=p.progressSummary;if(!s)return null;const entries=[
   ['Completed · payment receipt recorded',s.completedReceived],
   ['Completed · payment pending',s.completedPending],
   ...(s.completedPaymentUnknown?[['Completed · payment unverified',s.completedPaymentUnknown]]:[]),
   ['Delivered, installation pending · payment receipt recorded',s.deliveredReceived],
   ['Delivered, installation pending · payment pending until completion',s.deliveredPending],
   ...(s.deliveredPaymentUnknown?[['Delivered, installation pending · payment unverified',s.deliveredPaymentUnknown]]:[]),
   ['Accounts review required',s.reviewRequired],
   ['Confirmed not delivered',s.notDelivered],
   ['Delivery / completion unverified',s.unverified]
  ];return <section className="pz-panel pz-stack" key={p.programKey} aria-label={`Batch status ${p.projectReference}`}><h3>Batch status · {p.projectReference}</h3><p>{s.completed} completed · {s.installationPending} installation pending · {s.reviewRequired} under review · {s.unverified} unverified</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Status</th><th className="numeric">Sites</th></tr></thead><tbody>{entries.map(([label,count])=><tr key={label}><td>{label}</td><td className="numeric">{count}</td></tr>)}<tr><th>Total registered</th><th className="numeric">{s.listedSites}</th></tr></tbody></table></div><p>{s.remainingToComplete} registered sites not yet completed · {s.notListed} of {p.totalSites} batch positions not yet listed</p><p className="pz-caption">Completed includes Management-confirmed sites awaiting data; Actual includes approved financial closures only. System receipts include the confirmed 50% advance where recorded and only system-invoice payments; extra cable invoices are separate at their recorded amounts. Unverified main-order receipts are not assumed unpaid: the displayed balance needs reconciliation. Unverified sites are not assumed undelivered. Historical receipts remain valid under the earlier delivery-based terms.</p></section>;})}
  {register.importedSites>0&&<p className="pz-caption">Historical costing is retained with its source. Only costs recorded for approved closed sites enter Actual.</p>}
 </section>;
}
