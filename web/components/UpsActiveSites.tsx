import {useState,type ReactNode} from 'react';
import {Decimal} from 'decimal.js';
import {wholeMoney} from '../numbers.js';
import {Button} from '../ui/Button.js';

export function UpsActiveSites({register,prices,children}:{register:any,onPreview:(id:string)=>void,children?:ReactNode,prices?:any[]}){
 const [configuration,setConfiguration]=useState(register.configurations.find((c:any)=>c.activeSites>0)?.configuration??register.configurations[0]?.configuration??'');
 const programs=register.programs.filter((p:any)=>p.configuration===configuration),scoped=register.configurations.find((c:any)=>c.configuration===configuration),price=prices?.find(p=>p.configuration===configuration)?.unitPayable;
 const total=(key:string)=>programs.reduce((n:number,p:any)=>n+(p.progressSummary?.[key]??0),0);
 const payable=(count:number)=>price==null?'Not available':`PKR ${wholeMoney(new Decimal(price).mul(count).toString())}`;
 const amount=(key:string)=>programs.reduce((n:Decimal,p:any)=>n.add(p.progressSummary?.[key]??0),new Decimal(0));
 const advanceConfirmed=programs.length>0&&programs.every((p:any)=>p.progressSummary?.advancePercent===50);
 const completedValue=price==null?null:new Decimal(price).mul(total('completed'));
 const completedReceived=advanceConfirmed&&completedValue?completedValue.mul('0.5').add(amount('completedSystemReceivedAfterAdvance')):null;
 const completedBalance=completedValue&&completedReceived?completedValue.sub(completedReceived):null;
 const money=(n:Decimal|null)=>n===null?'Needs reconciliation':`PKR ${wholeMoney(n.toString())}`;
 const cards=[
  {label:'Total agreed order',count:programs.reduce((n:number,p:any)=>n+p.totalSites,0),detail:'Sites in the agreed batch orders'},
  {label:'Active POs',count:scoped?.activeSites??0,detail:`${payable(scoped?.activeSites??0)} payable incl. GST`},
  {label:'Completed sites',count:total('completed'),detail:`${payable(total('completed'))} payable incl. GST`,notes:[`Received${total('completedPaymentUnknown')?' (at least)':''}: ${money(completedReceived)}`,`Balance${total('completedPaymentUnknown')?' to reconcile':''}: ${money(completedBalance)}`,...(total('completedPaymentUnknown')?[`${total('completedPaymentUnknown')} main-order receipts unverified`]:[])]},
  {label:'Delivered, not completed',count:total('installationPending'),detail:`${total('deliveredReceived')} with payment receipt recorded`},
  {label:'Payment awaiting completion',count:total('deliveredPending'),detail:'Delivered · remaining payment pending under revised terms'},
  {label:'Delivery / completion unverified',count:total('unverified'),detail:'Among registered sites; delivery is not assumed pending'},
  ...(total('reviewRequired')?[{label:'Accounts review required',count:total('reviewRequired'),detail:'Installation evidence needs reconciliation'}]:[]),
  {label:'Extra cable invoices',count:total('extraCableInvoices'),detail:`Payable: ${money(amount('extraCablePayable'))}`,notes:[`Paid: ${money(amount('extraCablePaid'))}`,`Balance: ${money(amount('extraCableBalance'))}`]}
 ];
 return <section className="workspace-buckets pz-stack" aria-label="Active UPS sites">
  <h3>{configuration==='6-5'?'6 kW + 5 kWh':'6 kW + 10 kWh'}</h3>
  {register.configurations.length>1&&<div className="pz-action-row">{register.configurations.map((c:any)=><Button key={c.configuration} variant={configuration===c.configuration?'secondary':'neutral'} aria-pressed={configuration===c.configuration} onClick={()=>setConfiguration(c.configuration)}>{c.configuration==='6-5'?'6 kW + 5 kWh':'6 kW + 10 kWh'}</Button>)}</div>}
  <div className="stage-grid">{cards.map(c=><article className="stage-card" key={c.label}><span>{c.label}</span><strong>{c.count}</strong><small>{c.detail}</small>{c.notes?.map(note=><small key={note}>{note}</small>)}</article>)}</div>
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
  ];return <section className="pz-panel pz-stack" key={p.programKey} aria-label={`Batch status ${p.projectReference}`}><h3>Batch status · {p.projectReference}</h3><p>{s.completed} completed · {s.installationPending} installation pending · {s.reviewRequired} under review · {s.unverified} unverified</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Status</th><th className="numeric">Sites</th></tr></thead><tbody>{entries.map(([label,count])=><tr key={label}><td>{label}</td><td className="numeric">{count}</td></tr>)}<tr><th>Total registered</th><th className="numeric">{s.listedSites}</th></tr></tbody></table></div><p>{s.remainingToComplete} registered sites not yet approved closed · {s.notListed} of {p.totalSites} batch positions not yet listed</p><p className="pz-caption">System receipts include the confirmed 50% advance where recorded and only system-invoice payments; extra cable invoices are separate at their recorded amounts. Unverified main-order receipts are not assumed unpaid: the displayed balance needs reconciliation. Unverified sites are not assumed undelivered. Historical receipts remain valid under the earlier delivery-based terms.</p></section>;})}
  {register.importedSites>0&&<p className="pz-caption">Historical costing is retained with its source. Only costs recorded for approved closed sites enter Actual.</p>}
 </section>;
}
