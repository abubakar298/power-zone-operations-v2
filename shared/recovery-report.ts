import {paymentReviewNote} from './accounts-payment-review.js';
import {Decimal} from 'decimal.js';
import {invoiceType,invoiceCategory,isSubmittedInvoicePending} from './accounts-invoice-display.js';
import {groupBySite,isSiteType,matchesSiteType,siteIndex} from './accounts-site-groups.js';
export function recoveryAge(date:unknown,asOf:string){
 const valid=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 if(!valid(date)||!valid(asOf))return {days:null,color:'#6b7280'};
 const days=Math.floor((Date.parse(asOf+'T00:00:00Z')-Date.parse(String(date)+'T00:00:00Z'))/86400000);
 return days<0?{days:null,color:'#6b7280'}:{days,color:days>14?'#b42318':days>7?'#b45309':'#4f46a5'};
}
/** keepOrder: rows are already grouped by site (site type filter), so they are not re-sorted by age. */
export function recoveryReport(rows:Record<string,any>[],asOf:string,keepOrder=false){
 const items=rows.filter(isSubmittedInvoicePending).map(r=>({
  site:String(r.site??''),customer:String(r.customer??''),po:String(r.po??r.customerPo??''),
  stage:invoiceType(r),invoice:String(r.invoice??''),pending:r.pending==null?null:new Decimal(r.pending).toFixed(2),
  submittedOn:String(r.date??''),...recoveryAge(r.date,asOf),review:!!r.receiptHold||!!r.invoiceCorrectionHold,
 }));
 if(!keepOrder)items.sort((a,b)=>(b.days??-1)-(a.days??-1));
 return {asOf,items,total:items.reduce((sum,r)=>sum.plus(r.pending??0),new Decimal(0)).toFixed(2),unknownAmounts:items.filter(r=>r.pending==null).length};
}

/** "Not recorded" means the outstanding amount is unknown, as counted in the filtered total. */
export function matchesAmountFilter(row:Record<string,any>,amount?:string){return !amount||(amount==='missing'?row.pending==null:row.pending!=null);}
export function recoveryFilteredRows(rows:Record<string,any>[],filters:{search?:string;customer?:string;category?:string;stage?:string;amount?:string;siteType?:string},sourceVersion:number,allRows:Record<string,any>[]=rows){
 const search=(filters.search??'').trim().toLowerCase(),sites=siteIndex([...allRows,...rows]);
 const filtered=rows.filter(r=>(!search||[r.site,r.ipo,r.invoice,r.customer,invoiceType(r),paymentReviewNote(r.id,sourceVersion)].join(' ').toLowerCase().includes(search))&&(!filters.customer||r.customer===filters.customer)&&(!filters.category||invoiceCategory(r)===filters.category)&&(!filters.stage||invoiceType(r)===filters.stage)&&matchesAmountFilter(r,filters.amount)&&matchesSiteType(r,filters.siteType,sites));
 // UPS/Solar + Extra Cable: each site's invoices together, as on screen.
 return filters.siteType&&isSiteType(filters.siteType)&&filters.siteType.endsWith('-cable')?groupBySite(filtered,filters.siteType,sites).flatMap(g=>g.rows):filtered;
}
