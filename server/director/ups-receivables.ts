import {Decimal} from 'decimal.js';

/** Read-only system-invoice ageing. Unknown payment evidence is never assumed unpaid. */
export function upsReceivablesAgeing(register:any,now=new Date()){
 const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}),today=calendar.format(now);
 const rows:any[]=[];
 let unverifiedPaymentSites=0,amountRequiredSites=0;
 const dateOnly=(value:unknown)=>{
  if(typeof value!=='string')return null;
  const date=value.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const parsed=new Date(date+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:null;
 };
 const uniqueDate=(evidence:any[],field:string)=>{const dates=[...new Set(evidence.map(e=>dateOnly(e[field])).filter(Boolean))];return dates.length===1?dates[0]:null;};
 for(const site of register.sites){
  const status=site.recoveryStatus,order=site.orderNumber,payment=status?.systemPaymentStatus??status?.paymentStatus;
  if(payment==='Received')continue;
  if(payment!=='Pending'){unverifiedPaymentSites++;continue;}
  const completion=register.completionApprovals?.[order]??register.completionConfirmations?.[order],alert=register.installationAlerts?.[order];
  const reviewed=(!alert?.resolvedAt&&alert?.status==='Review needed by Accounts')||status?.installationStatus==='Review needed';
  const stage=reviewed?'review':completion?status.invoiceStatus==='Submitted'?'submitted':['Not submitted','Unsubmitted','Not invoiced'].includes(status.invoiceStatus)?'unsubmitted':'review':status.deliveryStatus==='Delivered'&&status.installationStatus==='Pending'?'awaiting-completion':'review';
  const invoices=new Map<string,any>();
  for(const invoice of status.systemInvoices??[]){
   if(!invoice.invoice||typeof invoice.paymentReceived!=='boolean')continue;
   const previous=invoices.get(invoice.invoice);
   if(previous&&previous.amount!==invoice.amount){invoices.set(invoice.invoice,{...invoice,conflicting:true});continue;}
   if(invoice.paymentReceived){invoices.set(invoice.invoice,{...invoice,conflicting:previous?.conflicting});continue;}
   if(!previous)invoices.set(invoice.invoice,invoice);
  }
  let usable=false;
  for(const invoice of invoices.values()){
   if(invoice.conflicting||invoice.paymentReceived)continue;
   let amount:Decimal;try{amount=new Decimal(invoice.amount);}catch{continue;}
   if(!amount.isFinite()||!amount.gt(0))continue;
   usable=true;
   const evidence=(status.recoveryEvidence??[]).filter((e:any)=>e.invoice===invoice.invoice);
   const allEvidence=status.recoveryEvidence??[];
   const reviewedValues=status.dataReview?.values;
   const startDate=reviewedValues?(stage==='submitted'?reviewedValues.invoiceSubmittedDate:stage==='unsubmitted'?reviewedValues.installationDate:stage==='awaiting-completion'?reviewedValues.deliveryDate:null):stage==='submitted'?dateOnly(status.invoiceSubmittedDate)??uniqueDate(evidence,'submit'):stage==='unsubmitted'?dateOnly(completion?.completionDate)??uniqueDate(allEvidence,'install'):stage==='awaiting-completion'?dateOnly(alert?.deliveryDate??status.deliveryDate)??uniqueDate(allEvidence,'delivery'):null;
   const elapsed=startDate?(Date.parse(today+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/86400000:null;
   const days=elapsed!==null&&elapsed>=0?Math.floor(elapsed):null;
   rows.push({orderNumber:order,site:site.siteName||alert?.evidenceSiteName||allEvidence.find((e:any)=>e.name)?.name||'',invoice:invoice.invoice,amount:amount.toFixed(2),stage,startDate,days,band:days===null?'unknown':days<=7?'0-7':days<=14?'8-14':days<=30?'15-30':'31+'});
  }
  if(!usable)amountRequiredSites++;
 }
 return {rows,unverifiedPaymentSites,amountRequiredSites};
}
