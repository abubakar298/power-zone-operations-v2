import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {drawReportLogo,drawReportFooter,reportBottomMargin} from '../reports/branding.js';

import type {ublIpoSample} from './ipo-sample.js';
import {Decimal} from 'decimal.js';
const money=(v:string)=>new Decimal(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const right=(v:string)=>({content:money(v),styles:{halign:'right' as const}});
export function ublIpoSamplePdf(s:ReturnType<typeof ublIpoSample>, kind:'ipo'|'pt'|'pack'='pack'){
 const pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
 const reference=`IPO ${s.legacyIpoNumber} / IPO & Peachtree Division / ${s.documentStatus==='Historical registered'?'HISTORICAL REGISTERED':'REVIEW SAMPLE'}`;
 const stage=s.pricingStage==='Revised'?'Final / Revised':s.pricingStage;
 drawReportLogo(pdf);pdf.setFontSize(12);pdf.text('INTERNAL PURCHASE ORDER',14,37);pdf.setFontSize(8);pdf.text('POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED',14,42);
 autoTable(pdf,{startY:46,theme:'grid',margin:{left:14,right:14,bottom:reportBottomMargin},styles:{fontSize:7,cellPadding:1.4},columnStyles:{0:{cellWidth:27},1:{cellWidth:64},2:{cellWidth:27},3:{cellWidth:64}},body:[
  ['Job / IPO reference',`CHP-${s.legacyIpoNumber}`,'Customer PO',s.poNumber],
  ['Company to invoice',s.customer,'Customer',s.customer],
  ['Site',s.siteName,'Branch code',s.branchCode],
  ['Configuration',s.configuration,'Pricing stage',stage],
  ['Region',s.region,'Main city',s.mainCity||'Not entered'],
  ['PO issue date',s.poIssuedDate,'Document status',s.documentStatus==='Historical registered'?'Historical registered - not invoiced':'Review sample - not issued'],
  ['Quotation type','UBL Solar - Show Sales Tax Separately','','']
 ]});
 autoTable(pdf,{startY:(pdf as any).lastAutoTable.finalY+4,theme:'grid',margin:{left:14,right:14,bottom:reportBottomMargin},styles:{fontSize:7,cellPadding:1.3},headStyles:{fillColor:[61,63,146],fontSize:7},head:[['Description','Qty','Unit','Net rate','Amount','Tax %','Tax','Total']],columnStyles:{0:{cellWidth:66},1:{halign:'center',cellWidth:10},2:{halign:'center',cellWidth:10},3:{halign:'right'},4:{halign:'right'},5:{halign:'center',cellWidth:9},6:{halign:'right'},7:{halign:'right'}},body:s.billing.map(r=>[r.name,r.name==='Solar Panels'?new Decimal(s.agreedWatts??35000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,','):'1',r.name==='Solar Panels'?'W':'LS',r.name==='Solar Panels'?money(String(s.panelSellingRate??44)):money(r.sellingExcludingGst),money(r.sellingExcludingGst),r.gstRate.replace('%',''),money(r.gst),money(r.payable)])});
 autoTable(pdf,{startY:(pdf as any).lastAutoTable.finalY+3,theme:'plain',margin:{left:14,right:14,bottom:reportBottomMargin},styles:{fontSize:8,cellPadding:1.8},columnStyles:{0:{cellWidth:60},1:{cellWidth:122,halign:'right'}},body:[
  ['Grand total before tax',right(s.totalSellingExcludingGst)],
  ['Solar panel sales tax @10%',right(s.billing[0].gst)],
  ['Installations sales tax @18%',right(s.billing[1].gst)],
  ['GRAND TOTAL (PKR)',{content:money(s.totalPayable),styles:{halign:'right',fontStyle:'bold'}}],
  ['Remarks',{content:'Panel wattage is subject to availability. Confirm actual installed wattage against the verified IRR before invoicing. Panel invoicing uses actual watts at the agreed rate; installations balance the approved total. Cable adjustments require separate authorization. '+(s.documentStatus==='Historical registered'?'Historical registration; no invoice or Accounts handoff.':'Review sample - not issued.'),styles:{halign:'left'}}]
 ]});
 pdf.addPage();drawReportLogo(pdf);pdf.setFontSize(12);pdf.text('PEACHTREE DIVISION',14,38);pdf.setFontSize(9);pdf.text('POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED',14,44);
 autoTable(pdf,{startY:50,theme:'plain',styles:{fontSize:9,cellPadding:2},body:[['Job / IPO',`CHP-${s.legacyIpoNumber}`],['Customer PO',s.poNumber],['Customer',s.customer],['Site / branch',`${s.siteName} / ${s.branchCode}`],['Configuration / pricing stage',`${s.configuration} / ${stage}`],['Entry basis','Selling values excluding tax'],['Quotation type','UBL Solar - Show Sales Tax Separately']]});
 const body:any[]=[];
 for(const p of s.phases){body.push([p.name,right(p.sellingExcludingGst)]);if(p.name==='BMS')body.push([{content:'BESS Total (subtotal)',styles:{fontStyle:'bold',fillColor:[246,246,252]}},{content:money(s.phases.filter(v=>['Inverter','Batteries','BMS'].includes(v.name)).reduce((v,p)=>v.add(p.sellingExcludingGst),new Decimal(0)).toFixed(2)),styles:{halign:'right',fontStyle:'bold',fillColor:[246,246,252]}}]);}
 autoTable(pdf,{startY:(pdf as any).lastAutoTable.finalY+7,theme:'grid',headStyles:{fillColor:[61,63,146]},footStyles:{fillColor:[61,63,146]},styles:{fontSize:10,cellPadding:3},columnStyles:{1:{halign:'right'}},head:[['Peachtree job-ledger phase','Selling value (PKR)']],body,foot:[['PHASE TOTAL',right(s.totalSellingExcludingGst)]]});
 autoTable(pdf,{startY:(pdf as any).lastAutoTable.finalY+6,theme:'plain',styles:{fontSize:9,cellPadding:2},columnStyles:{1:{halign:'right'}},body:[['IPO total before tax',right(s.totalSellingExcludingGst)],['IPO tax (separate reconciliation)',right(s.totalGst)],['IPO payable',right(s.totalPayable)]]});
 pdf.setFontSize(8);pdf.text(pdf.splitTextToSize('PT selling values are locked to agreed capacity and the saved proportional allocation. Actual usage affects actual costs and markup. Final invoice panel allocation may differ after verified IRR review, while the agreed total stays unchanged before authorized cable adjustments. BESS Total is a subtotal, not an additional phase. EPC absorbs rounding only. Historical registration does not record an invoice, dispatch or job closure.',180),14,(pdf as any).lastAutoTable.finalY+8);
 if(kind==='ipo')pdf.deletePage(2);else if(kind==='pt')pdf.deletePage(1);
 drawReportFooter(pdf,reference);pdf.setProperties({title:reference,author:'Power Zone Engineering & Services'});return Buffer.from(pdf.output('arraybuffer'));
}
