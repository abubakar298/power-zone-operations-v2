import {Decimal} from 'decimal.js';
/** Frozen departmental read-model port: source rows are imported records, not journal postings. */
type SourceRow = Record<string, any>;
export const ageingBands=[{id:'0-7',label:'0–7 days',color:'#514394'},{id:'8-15',label:'8–15 days',color:'#c79739'},{id:'15+',label:'Over 15 days',color:'#a33f30'},{id:'unknown',label:'Date not recorded',color:'#a5a3ae'}];
export function submissionDate(value:unknown){
 const s=String(value??'');
 const iso=s.match(/\b(20\d{2}-\d{2}-\d{2})(?=T|\b)/);if(iso)return iso[1];
 const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const match=s.match(/\b(\d{1,2})[- ](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[- ](20\d{2})\b/i);
 if(match)return `${match[3]}-${String(monthNames.findIndex((m:any)=>m.toLowerCase()===match[2].toLowerCase())+1).padStart(2,'0')}-${match[1].padStart(2,'0')}`;
 return null;
}
export function ageBand(date:string|null|undefined,asOf:string){if(!date)return 'unknown';const days=Math.floor((Date.parse(asOf+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000);return !Number.isFinite(days)||days<0?'unknown':days<=7?'0-7':days<=15?'8-15':'15+';}
export const invoiceIdentity=(value:unknown)=>String(value??'').trim().match(/^(\d{2}-\d{4,})(?!\d)/)?.[1]??null;
export function isSubmittedReceivable(row:SourceRow){return row.submission==='Submitted';}
export function billingRows(registers:SourceRow[],cables:SourceRow,internet:SourceRow,evidence:SourceRow={rows:[],cableStageAdjustments:[]}){
 const result:SourceRow[]=[];
 const cableIds=new Set(cables.rows.map((r:any)=>invoiceIdentity(r.invoice)));
 const internetIds=new Set(internet.rows.map((r:any)=>invoiceIdentity(r.invoice)));
 const lookup=(customer:string,invoice:string)=>(evidence.rows??[]).filter((r:any)=>r.customer===customer&&r.invoice===invoiceIdentity(invoice));
 const sourceDate=(customer:string,invoice:string)=>lookup(customer,invoice).filter((r:any)=>r.status==='submitted').map((r:any)=>submissionDate(r.date)).filter(Boolean).sort().at(-1)??null;
 const systemIds=new Map<string,SourceRow>();
 for(const row of registers.flatMap((r:any)=>r.rows).filter((r:any)=>!r.cancelled&&!r.transferred)){
  const customer=row.customer==='MBL'?'Meezan Bank Limited':'United Bank Limited';
  if(row.program==='Solar 70')for(const stage of ['advance','completion']){
   const value=row[stage];if(!value||value.invoiceAmount==null||!row.invoiceReferences.some((ref:any)=>!/^27-50/.test(ref)))continue;
   const adjustment=(evidence.cableStageAdjustments??[]).filter((a:any)=>a.stage===stage&&row.invoiceReferences.includes(a.invoice)).reduce((n:any,a:any)=>n.plus(a.amount),new Decimal(0));
   const amount=new Decimal(value.invoiceAmount).minus(adjustment).toFixed(2);
   const outstanding=value.received?'0':Decimal.max(0,new Decimal(value.outstandingAmount??value.invoiceAmount).minus(adjustment)).toFixed(2);
   const systemRefs=row.invoiceReferences.filter((ref:any)=>!cableIds.has(invoiceIdentity(ref))&&!internetIds.has(invoiceIdentity(ref)));
   result.push({id:`${row.key}:${stage}`,customer,category:stage==='advance'?'System · advance':'System · completion',ipo:row.ipo,po:row.po??row.customerPo??'',site:row.site,invoice:systemRefs.join(' / '),amount,pending:outstanding,receiptConfirmed:value.received===true,date:value.submitted?submissionDate(value.submissionEvidence):null,dateBasis:'Days since verified submission',submission:value.submitted?'Submitted':'Submission not confirmed',notes:[value.receiptEvidence,adjustment.gt(0)?`Separate cable invoice value ${adjustment.toFixed(2)} excluded from system total to prevent double counting.`:''].filter(Boolean).join(' '),minimum:false});
  }else if(row.kind==='UPS'){
   for(const invoice of row.invoiceReferences??[]){
    const identity=invoiceIdentity(invoice);if(!identity||cableIds.has(identity)||internetIds.has(identity))continue;
    const key=customer+':'+identity,observations=lookup(customer,invoice),balances=observations.filter((r:any)=>r.balance!=null),latest=balances.at(-1),paid=observations.some((r:any)=>r.status==='paid');
    // Recovery balance is not an original invoice total. Keep invoice coverage explicit.
    const amount=row.actualInvoiceAmount??row.invoiceAmount??null;
    const pending=latest?String(latest.balance):row.singlePaymentReceived||paid?'0':null;
    const submitted=latest?latest.status==='submitted':paid||row.singleInvoiceSubmitted;
    const entry={id:'system:'+key,sourceKey:row.key,sourceKeys:[row.key],customer,category:'System',ipo:row.ipo,po:row.po??row.customerPo??'',site:row.site,invoice:identity,amount:amount==null?null:String(amount),pending,receiptConfirmed:(paid||row.singlePaymentReceived===true)&&new Decimal(pending??1).isZero(),date:sourceDate(customer,invoice)??(submitted?submissionDate(row.invoiceStatus):null),dateBasis:'Days since verified submission',submission:submitted?'Submitted':'Submission not confirmed',notes:[amount==null?'Original invoice total not loaded; recovery balance is kept separate from invoiced value.':'',latest?.source,latest?.notes,latest&&row.singlePaymentReceived?'Recovery still lists a balance against this invoice despite the site-level receipt status.':''].filter(Boolean).join(' '),minimum:false};
    if(systemIds.has(key)){const previous=systemIds.get(key)!;previous.sourceKeys=[...new Set([...(previous.sourceKeys??[]),row.key])];previous.po=[...new Set([previous.po,entry.po].filter(Boolean))].join(' / ');if(!previous.site.includes(row.site))previous.site+=' / '+row.site;continue;}
    systemIds.set(key,entry);result.push(entry);
   }
  }
 }
 for(const row of cables.rows){result.push({id:'cable:'+row.key,customer:row.program.startsWith('MBL')?'Meezan Bank Limited':'United Bank Limited',category:'Extra cable',receiptConfirmed:lookup(row.program.startsWith('MBL')?'Meezan Bank Limited':'United Bank Limited',row.invoice).some((e:any)=>e.status==='paid')||row.paymentReceived===true,ipo:row.sites.map((s:any)=>s.ipo).filter(Boolean).join(' / '),site:row.sites.map((s:any)=>s.site).join(' / '),invoice:row.invoice,amount:row.invoicedAmount==null?null:String(row.invoicedAmount),pending:row.pendingAmount==null?null:String(row.pendingAmount),date:sourceDate(row.program.startsWith('MBL')?'Meezan Bank Limited':'United Bank Limited',row.invoice)??submissionDate(row.observations?.find((o:any)=>o.submitted)?.submissionEvidence),dateBasis:'Days since verified submission',submission:sourceDate(row.program.startsWith('MBL')?'Meezan Bank Limited':'United Bank Limited',row.invoice)?'Submitted':row.submission,notes:row.notes.join(' '),minimum:row.minimumOnly});}
 for(const row of internet.rows)result.push({id:'internet:'+row.key,customer:'United Bank Limited',category:'Internet',receiptConfirmed:lookup('United Bank Limited',row.invoice).some((e:any)=>e.status==='paid')||row.paymentReceived===true,ipo:row.ipo,po:row.po??row.customerPo??'',site:row.site,invoice:row.invoice,amount:String(row.amount),pending:String(row.pendingAmount),date:row.submission==='Submitted'?submissionDate(row.submissionDate):null,dateBasis:'Days since verified submission',submission:row.submission,notes:row.notes,minimum:false});
 // PO metadata follows exact customer + invoice references, never a similar site name.
 const owners=registers.flatMap((r:any)=>r.rows??[]).filter((r:any)=>!r.cancelled&&!r.transferred);
 for(const item of result){if(item.po)continue;const refs=new Set(String(item.invoice).match(/\b\d{2}-\d{4,}\b/g)??[]);
  item.po=[...new Set(owners.filter((r:any)=>(r.customer==='MBL'?'Meezan Bank Limited':'United Bank Limited')===item.customer&&(r.invoiceReferences??[]).some((ref:any)=>refs.has(invoiceIdentity(ref)??''))).map((r:any)=>r.po??r.customerPo).filter(Boolean))].join(' / ');
 }
 return result;
}
export function customerTotals(rows:SourceRow[],asOf:string){
 return [...new Set(rows.map((r:any)=>r.customer))].map(customer=>{
  const selected=rows.filter((r:any)=>r.customer===customer),sum=(key:string)=>selected.reduce((n:any,r:any)=>n.plus(r[key]??0),new Decimal(0)).toFixed(2);
  return{customer,invoiced:sum('amount'),pending:sum('pending'),submittedPending:selected.filter(isSubmittedReceivable).reduce((n:any,r:any)=>n.plus(r.pending??0),new Decimal(0)).toFixed(2),awaitingSubmission:selected.filter((r:any)=>!isSubmittedReceivable(r)).reduce((n:any,r:any)=>n.plus(r.pending??0),new Decimal(0)).toFixed(2),missingInvoiceAmounts:selected.filter((r:any)=>r.amount==null).length,missingPendingAmounts:selected.filter((r:any)=>r.pending==null).length,minimum:selected.some((r:any)=>r.minimum),count:selected.length,bands:ageingBands.map((b:any)=>({...b,amount:selected.filter((r:any)=>isSubmittedReceivable(r)&&ageBand(r.date,asOf)===b.id).reduce((n:any,r:any)=>n.plus(r.pending??0),new Decimal(0)).toFixed(2)}))};
 });
}
export function invoicingQueues(registers:SourceRow[]){
 const delivery:SourceRow[]=[],completion:SourceRow[]=[],alreadyIssued:SourceRow[]=[];
 for(const row of registers.flatMap((r:any)=>r.rows).filter((r:any)=>!r.cancelled&&!r.transferred)){
  if(row.deliveryOnly===true||row.installation===false||row.projectType==='delivery-only'){
   if(row.delivered&&!row.singleInvoiceSubmitted&&!row.singlePaymentReceived){
    if((row.invoiceReferences??[]).length)alreadyIssued.push({...row,milestone:'delivery',deliveryOnly:true});else delivery.push({...row,milestone:'delivery',deliveryOnly:true});
   }
  }else if(row.kind==='UPS'){
   if(row.installed&&!row.singlePaymentReceived&&!row.singleInvoiceSubmitted&&!row.invoiceReferences.length)completion.push(row);
   else if(row.installed&&!row.singlePaymentReceived&&!row.singleInvoiceSubmitted)alreadyIssued.push({...row,milestone:'completion'});
  }else if(row.program==='Solar 70'){
   for(const [stage,ready,list]of [['advance',row.delivered,delivery],['completion',row.installed,completion]]){
    if(!ready||row[stage]?.submitted||row[stage]?.received)continue;
    const hasInvoice=row[stage]?.invoiceAmount!=null&&row.invoiceReferences.some((ref:any)=>!/^27-50/.test(ref));
    if(hasInvoice)alreadyIssued.push({...row,milestone:stage});else list.push({...row,milestone:stage});
   }
  }
 }
 return{delivery,completion,alreadyIssued};
}
