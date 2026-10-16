import {Decimal} from 'decimal.js';
/** Reporting only: absence of recovery evidence never means not delivered or unpaid. */
export function upsBatchProgress(register:any,now=new Date()){
 const deliveryAgeing:any[]=[],deliveryAgeingAsOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const result={listedSites:register.sites.length,completedReceived:0,completedPending:0,completedPaymentUnknown:0,deliveredReceived:0,deliveredPending:0,deliveredPaymentUnknown:0,reviewRequired:0,notDelivered:0,unverified:0,completed:0,delivered:0,dataRequired:0,installationPending:0,remainingToComplete:0,notListed:Math.max(0,register.totalSites-register.sites.length),advancePercent:register.progressEvidenceSource?.advancePercent??null,systemReceivedAfterAdvance:'0.00',completedSystemReceivedAfterAdvance:'0.00',extraCableInvoices:0,extraCablePayable:'0.00',extraCablePaid:'0.00',extraCableBalance:'0.00'};
 for(const site of register.sites){
  const order=site.orderNumber,status=site.recoveryStatus,completion=register.completionApprovals?.[order]??register.completionConfirmations?.[order],alert=register.installationAlerts?.[order];
  if(status?.dataRequired)result.dataRequired++;
  const recordedPayment=status?.systemPaymentStatus??status?.paymentStatus;
  const payment=recordedPayment==='Received'?'Received':recordedPayment==='Pending'?'Pending':'PaymentUnknown';
  for(const invoice of status?.systemInvoices??[])if(invoice.paymentReceived){result.systemReceivedAfterAdvance=new Decimal(result.systemReceivedAfterAdvance).add(invoice.amount).toFixed(2);if(completion)result.completedSystemReceivedAfterAdvance=new Decimal(result.completedSystemReceivedAfterAdvance).add(invoice.amount).toFixed(2);}
  for(const invoice of status?.extraCableInvoices??[]){result.extraCableInvoices++;result.extraCablePayable=new Decimal(result.extraCablePayable).add(invoice.amount).toFixed(2);if(invoice.paymentReceived)result.extraCablePaid=new Decimal(result.extraCablePaid).add(invoice.amount).toFixed(2);}
  if(completion){result.completed++;result[`completed${payment}`]++;}
  else if(alert?.status==='Review needed by Accounts'||status?.installationStatus==='Review needed')result.reviewRequired++;
  else if(status?.deliveryStatus==='Delivered'&&status?.installationStatus==='Pending'){
   result.delivered++;result.installationPending++;result[`delivered${payment}`]++;
   const dates=[...new Set<string>((status.recoveryEvidence??[]).map((e:any)=>e.delivery?.slice(0,10)).filter(Boolean))];
   const deliveryDate=alert?.deliveryDate??status.deliveryDate??(dates.length===1?dates[0]:null);
   const date=typeof deliveryDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)?new Date(deliveryDate+'T00:00:00Z'):null;
   const valid=date&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===deliveryDate;
   const difference=valid?(Date.parse(deliveryAgeingAsOf+'T00:00:00Z')-date.getTime())/86400000:null;
   const days=difference!==null&&difference>=0?Math.floor(difference):null;
   const band=days===null?'unknown':days<=7?'0-7':days<=14?'8-14':days<=30?'15-30':'31+';
   deliveryAgeing.push({orderNumber:order,site:site.siteName||alert?.evidenceSiteName||status.recoveryEvidence?.find((e:any)=>e.name)?.name||'',deliveryDate:valid?deliveryDate:null,days,band});
  }
  else if(status?.deliveryStatus==='Not delivered')result.notDelivered++;
  else result.unverified++;
 }
 result.remainingToComplete=result.listedSites-result.completed;
 result.extraCableBalance=new Decimal(result.extraCablePayable).sub(result.extraCablePaid).toFixed(2);
 return {...result,deliveryAgeing,deliveryAgeingAsOf};
}
