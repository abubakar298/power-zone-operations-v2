/** Reporting only: absence of recovery evidence never means not delivered or unpaid. */
export function upsBatchProgress(register:any){
 const result={listedSites:register.sites.length,completedReceived:0,completedPending:0,completedPaymentUnknown:0,deliveredReceived:0,deliveredPending:0,deliveredPaymentUnknown:0,reviewRequired:0,notDelivered:0,unverified:0,completed:0,installationPending:0,remainingToComplete:0,notListed:Math.max(0,register.totalSites-register.sites.length)};
 for(const site of register.sites){
  const order=site.orderNumber,status=site.recoveryStatus,completion=register.completionApprovals?.[order],alert=register.installationAlerts?.[order];
  const payment=status?.paymentStatus==='Received'?'Received':status?.paymentStatus==='Pending'?'Pending':'PaymentUnknown';
  if(completion){result.completed++;result[`completed${payment}`]++;}
  else if(alert?.status==='Review needed by Accounts'||status?.installationStatus==='Review needed')result.reviewRequired++;
  else if(status?.deliveryStatus==='Delivered'&&status?.installationStatus==='Pending'){result.installationPending++;result[`delivered${payment}`]++;}
  else if(status?.deliveryStatus==='Not delivered')result.notDelivered++;
  else result.unverified++;
 }
 result.remainingToComplete=result.listedSites-result.completed;
 return result;
}
