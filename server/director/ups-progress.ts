import {Decimal} from 'decimal.js';
/** Reporting only: absence of recovery evidence never means not delivered or unpaid. */
export function upsBatchProgress(register:any){
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
  else if(status?.deliveryStatus==='Delivered'&&status?.installationStatus==='Pending'){result.delivered++;result.installationPending++;result[`delivered${payment}`]++;}
  else if(status?.deliveryStatus==='Not delivered')result.notDelivered++;
  else result.unverified++;
 }
 result.remainingToComplete=result.listedSites-result.completed;
 result.extraCableBalance=new Decimal(result.extraCablePayable).sub(result.extraCablePaid).toFixed(2);
 return result;
}
