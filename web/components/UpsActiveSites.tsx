import {useState,type ReactNode} from 'react';

export function UpsActiveSites({register,onPreview,children}:{register:any,onPreview:(id:string)=>void,children?:ReactNode}){
 const [configuration,setConfiguration]=useState(register.configurations.find((c:any)=>c.activeSites>0)?.configuration??register.configurations[0]?.configuration??'');
 return <section className="workspace-buckets pz-stack" aria-label="Active UPS sites">
  <h3>Active Sites</h3><div className="stage-grid">{register.configurations.map((c:any)=><button key={c.configuration} type="button" className={`stage-card${configuration===c.configuration?' selected':''}`} aria-pressed={configuration===c.configuration} onClick={()=>{setConfiguration(c.configuration);}}><span>{c.configuration==='6-5'?'6 kW + 5 kWh':'6 kW + 10 kWh'}</span><strong>{c.activeSites}</strong><small>Registered sites</small></button>)}</div>
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
  ];return <section className="pz-panel pz-stack" key={p.programKey} aria-label={`Batch status ${p.projectReference}`}><h3>Batch status · {p.projectReference}</h3><p>{s.completed} completed · {s.installationPending} installation pending · {s.reviewRequired} under review · {s.unverified} unverified</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Status</th><th className="numeric">Sites</th></tr></thead><tbody>{entries.map(([label,count])=><tr key={label}><td>{label}</td><td className="numeric">{count}</td></tr>)}<tr><th>Total registered</th><th className="numeric">{s.listedSites}</th></tr></tbody></table></div><p>{s.remainingToComplete} registered sites not yet approved closed · {s.notListed} of {p.totalSites} batch positions not yet listed</p><p className="pz-caption">Payment receipts follow the recovery records and Management confirmations; additional cable invoices may remain outstanding. Payment pending refers to the remaining balance after the advance. Unverified sites are not assumed undelivered. Historical receipts remain valid under the earlier delivery-based terms.</p></section>;})}
  {register.importedSites>0&&<p className="pz-caption">Historical costing is retained with its source. Only costs recorded for approved closed sites enter Actual.</p>}
 </section>;
}
