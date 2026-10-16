import {useState,type ReactNode} from 'react';
import {Button} from '../ui/Button.js';
import {UpsDeliveryAgeing} from './UpsDeliveryAgeing.js';
import {UpsReceivablesAgeing} from './UpsReceivablesAgeing.js';

export function UpsActiveSites({register,children}:{register:any,onPreview:(id:string)=>void,children?:ReactNode,prices?:any[]}){
 const [configuration,setConfiguration]=useState(register.configurations.find((c:any)=>c.activeSites>0)?.configuration??register.configurations[0]?.configuration??'');
 const programs=register.programs.filter((p:any)=>p.configuration===configuration),scoped=register.configurations.find((c:any)=>c.configuration===configuration);
 const isBank=register.programs.length>0;
 const total=(key:string)=>programs.reduce((n:number,p:any)=>n+(p.progressSummary?.[key]??0),0);
 const agreedSites=programs.reduce((n:number,p:any)=>n+p.totalSites,0);
 const cards=[
  {label:'Active Sites',count:`${scoped?.activeSites??0}/${agreedSites}`,detail:isBank?`Pending: ${Math.max(0,agreedSites-(scoped?.activeSites??0))} POs`:''},
  {label:'Completed',count:`${total('completed')}/${scoped?.activeSites??0}`,detail:isBank?`Pending: ${Math.max(0,(scoped?.activeSites??0)-total('completed'))} Sites`:`Incomplete Sites: ${total('remainingToComplete')}`},
  ...(isBank?[{label:'Invoices Submitted',count:`${total('completedInvoicesSubmitted')}/${total('completed')}`,detail:`Pending: ${Math.max(0,total('completed')-total('completedInvoicesSubmitted'))} Sites`}]:[]),
  {label:'Delivered',count:`${total('delivered')}/${total('remainingToComplete')}`,detail:isBank?`Pending: ${Math.max(0,total('remainingToComplete')-total('delivered'))} Sites`:'Installation pending'},
  ...(isBank?[{label:'Installation Pending',count:`${total('installationPending')}/${total('delivered')}`,detail:`Pending: ${total('installationPending')} Sites`}]:total('reviewRequired')?[{label:'Accounts review required',count:total('reviewRequired'),detail:'Installation evidence needs reconciliation'}]:[])
 ];
 return <section className="pz-stack" aria-label="Active UPS sites">
  <section className={isBank?'workspace-buckets pz-panel pz-stack':'workspace-buckets pz-stack'} aria-label={isBank?'Project Summary':'UPS site summary'}>
  <h3>{isBank?'Project Summary':configuration==='6-5'?'6 kW + 5 kWh':'6 kW + 10 kWh'}</h3>
  {register.configurations.length>1&&<div className="pz-action-row">{register.configurations.map((c:any)=><Button key={c.configuration} variant={configuration===c.configuration?'secondary':'neutral'} aria-pressed={configuration===c.configuration} onClick={()=>setConfiguration(c.configuration)}>{c.configuration==='6-5'?'6 kW + 5 kWh':'6 kW + 10 kWh'}</Button>)}</div>}
  <div className="stage-grid">{cards.map(c=><article className="stage-card" key={c.label}><span style={['Active Sites','Completed','Delivered'].includes(c.label)?{fontSize:'var(--pz-text-lg)'}:undefined}>{c.label}</span><strong>{c.count}</strong>{c.detail&&<small>{c.detail}</small>}</article>)}</div>
  </section>
  {isBank&&<section className="pz-panel pz-stack" aria-label="Delivery ageing charts"><div className="pz-ups-ageing-grid">
  <UpsDeliveryAgeing key={configuration} rows={programs.flatMap((p:any)=>(p.progressSummary?.deliveryAgeing??[]).map((r:any)=>({...r,id:`${p.programKey}:${r.orderNumber}`})))} asOf={programs[0]?.progressSummary?.deliveryAgeingAsOf}/>
  <UpsDeliveryAgeing key={`${configuration}-awaiting-delivery`} awaitingDelivery rows={programs.flatMap((p:any)=>(p.progressSummary?.awaitingDeliveryAgeing??[]).map((r:any)=>({...r,id:`${p.programKey}:${r.orderNumber}`})))} asOf={programs[0]?.progressSummary?.deliveryAgeingAsOf}/>
   <UpsReceivablesAgeing key={`${configuration}-receivables`} programs={programs}/>
  </div></section>}
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
