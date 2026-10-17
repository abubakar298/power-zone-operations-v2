import {useState,type ReactNode} from 'react';
import {Button} from '../ui/Button.js';
import {Decimal} from 'decimal.js';
import {wholeMoney as money} from '../numbers.js';
import {UpsDeliveryAgeing} from './UpsDeliveryAgeing.js';
import {UpsReceivablesAgeing} from './UpsReceivablesAgeing.js';

export function UpsActiveSites({register,children,customer='UBL'}:{customer?:'UBL'|'MBL',register:any,onPreview:(id:string)=>void,children?:ReactNode,prices?:any[]}){
 const programs=register.programs,isBank=programs.length>0;
 const [configuration,setConfiguration]=useState<string|null>(null);
 const chartPrograms=configuration?programs.filter((p:any)=>p.configuration===configuration):programs;
 const activeSites=register.activeSites??register.configurations.reduce((n:number,c:any)=>n+c.activeSites,0);
 const total=(key:string)=>programs.reduce((n:number,p:any)=>n+(p.progressSummary?.[key]??0),0);
 // Management confirmed Meezan orders: 80 + 60 sites for 6–5, and 20 sites for 6–10.
 const agreedByConfiguration:Record<string,number>=customer==='MBL'?{'6-5':140,'6-10':20}:Object.fromEntries(register.configurations.map((c:any)=>[c.configuration,programs.filter((p:any)=>p.configuration===c.configuration).reduce((n:number,p:any)=>n+p.totalSites,0)]));
 const agreedSites=Object.values(agreedByConfiguration).reduce((n,v)=>n+v,0);
 const cards=[
  {label:customer==='MBL'?'Total Active Sites':'Active Sites',count:`${activeSites}/${agreedSites}`,detail:isBank?`Pending: ${Math.max(0,agreedSites-activeSites)} POs`:''},
  ...(customer==='MBL'?['6-5','6-10'].map(option=>{const active=register.configurations.find((c:any)=>c.configuration===option)?.activeSites??0,agreed=agreedByConfiguration[option];return{label:`${option} Active Sites`,count:`${active}/${agreed}`,detail:`Pending: ${Math.max(0,agreed-active)} POs`};}):[]),
  {label:'Completed',count:`${total('completed')}/${activeSites}`,detail:isBank?`Pending: ${Math.max(0,(activeSites)-total('completed'))} Sites`:`Incomplete Sites: ${total('remainingToComplete')}`},
  ...(isBank?[{label:'Invoices Submitted',count:`${total('completedInvoicesSubmitted')}/${total('completed')}`,detail:`Pending: ${Math.max(0,total('completed')-total('completedInvoicesSubmitted'))} Sites`}]:[]),
  {label:'Delivered',count:`${total('delivered')}/${total('remainingToComplete')}`,detail:isBank?`Pending: ${Math.max(0,total('remainingToComplete')-total('delivered'))} Sites`:'Installation pending'},
  ...(isBank?[{label:'Installed',count:`${total('completed')}/${total('completed')+total('delivered')}`,detail:`Pending: ${total('installationPending')} Sites`}]:total('reviewRequired')?[{label:'Accounts review required',count:total('reviewRequired'),detail:'Installation evidence needs reconciliation'}]:[])
 ];
 return <section className="pz-stack" aria-label="Active UPS sites">
  <section className={isBank?'workspace-buckets pz-panel pz-stack':'workspace-buckets pz-stack'} aria-label={isBank?'Project Summary':'UPS site summary'}>
  <h3>{isBank?'Project Summary':'UPS sites'}</h3>
  <div className="stage-grid">{cards.map(c=><article className="stage-card" key={c.label}><span style={['Active Sites','Completed','Delivered'].includes(c.label)?{fontSize:'var(--pz-text-lg)'}:undefined}>{c.label}</span><strong>{c.count}</strong>{c.detail&&<small>{c.detail}</small>}</article>)}</div>
  </section>
  {isBank&&<section className="pz-panel pz-stack" aria-label="Delivery ageing charts">{register.configurations.length>1&&<div className="pz-action-row" aria-label="Configuration filter"><Button variant={!configuration?'secondary':'neutral'} aria-pressed={!configuration} onClick={()=>setConfiguration(null)}>All sites</Button>{register.configurations.map((c:any)=><Button key={c.configuration} variant={configuration===c.configuration?'secondary':'neutral'} aria-pressed={configuration===c.configuration} onClick={()=>setConfiguration(configuration===c.configuration?null:c.configuration)}>{c.configuration==='6-5'?'6 kW + 5 kWh':'6 kW + 10 kWh'}</Button>)}</div>}<div className="pz-ups-ageing-grid">
  <UpsDeliveryAgeing customer={customer} key={configuration} rows={chartPrograms.flatMap((p:any)=>(p.progressSummary?.deliveryAgeing??[]).map((r:any)=>({...r,id:`${p.programKey}:${r.orderNumber}`})))} asOf={programs[0]?.progressSummary?.deliveryAgeingAsOf}/>
  <UpsDeliveryAgeing customer={customer} key={`${configuration}-awaiting-delivery`} awaitingDelivery rows={chartPrograms.flatMap((p:any)=>(p.progressSummary?.awaitingDeliveryAgeing??[]).map((r:any)=>({...r,id:`${p.programKey}:${r.orderNumber}`})))} asOf={programs[0]?.progressSummary?.deliveryAgeingAsOf}/>
   <UpsReceivablesAgeing key={`${configuration}-receivables`} programs={chartPrograms}/>
  </div></section>}
  {children}
  {programs.length>0&&<div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Batch order</th><th className="numeric">Sites ordered</th><th className="numeric">Active sites</th><th className="numeric">Remaining</th></tr></thead><tbody>{programs.map((p:any)=><tr key={p.programKey}><th>{p.projectReference}</th><td className="numeric">{p.totalSites}</td><td className="numeric">{p.activeSites}</td><td className="numeric">{p.remainingSites}</td></tr>)}</tbody></table></div>}
  {programs.map((p:any)=>{const s=p.progressSummary;if(!s)return null;const entries=[
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
  <section className="pz-panel pz-stack" aria-label="Extra cables summary"><h3>Extra Cables</h3><dl className="pz-ups-extra-cables">{[['Invoiced total','extraCablePayable'],['Paid total','extraCablePaid'],['Pending total','extraCableBalance']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>PKR {money(register.bankReconciliation?.extraCableSummary?.[key==='extraCablePayable'?'invoiced':key==='extraCablePaid'?'paid':'pending']??programs.reduce((sum:Decimal,p:any)=>sum.add(p.progressSummary?.[key]??0),new Decimal(0)).toString())}</dd></div>)}</dl></section>
  {register.bankReconciliation?.alerts?.map((a:any)=><p key={a.title} className="pz-caption" style={{color:'var(--pz-warning)'}}><strong>{a.title}</strong> · {a.note}</p>)}
  {register.bankReconciliation?.extraBatterySales?.length>0&&<section className="pz-panel pz-stack" aria-label="Separate extra battery sales"><h3>Extra Battery Sales</h3><p className="pz-caption">Separate sales · excluded from the received PO and system totals.</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Site</th><th>Invoice</th><th className="numeric">Amount · PKR</th><th>Status</th></tr></thead><tbody>{register.bankReconciliation.extraBatterySales.map((r:any)=><tr key={r.invoice}><td>{r.name}</td><td>{r.invoice}</td><td className="numeric">{money(r.amount)}</td><td>{r.section==='Received'?'Paid':'Pending'}</td></tr>)}</tbody></table></div></section>}
  {(programs.some((p:any)=>p.reconciliationReview?.length)||register.bankReconciliation?.unmatchedRecovery?.length)&&<section className="pz-panel pz-stack" aria-label="Reconciliation review"><h3>Held for Your Review</h3><p className="pz-caption">These records are preserved for review. Confirmed statuses remain in their buckets while unresolved details stay flagged.</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Sr. No.</th><th>Site / order</th><th>Review needed</th></tr></thead><tbody>{[...programs.flatMap((p:any)=>p.reconciliationReview??[]),...(register.bankReconciliation?.unmatchedRecovery??[])].map((r:any,i:number)=><tr key={i}><td>{i+1}</td><td>{r.siteName||r.evidence?.[0]?.name||'Name required'}<br/>{r.orderNumber||r.legacyJobId||r.evidence?.[0]?.invoice}</td><td>{r.reason}</td></tr>)}</tbody></table></div></section>}
  {register.importedSites>0&&<p className="pz-caption">Historical costing is retained with its source. Only costs recorded for approved closed sites enter Actual.</p>}
 </section>;
}
