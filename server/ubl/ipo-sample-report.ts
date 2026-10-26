import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {drawReportLogo,drawReportFooter,reportBottomMargin} from '../reports/branding.js';

import type {ublIpoSample} from './ipo-sample.js';
import {Decimal} from 'decimal.js';
const money=(v:string)=>new Decimal(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const right=(v:string)=>({content:money(v),styles:{halign:'right' as const}});
export function ublIpoSamplePdf(s:ReturnType<typeof ublIpoSample>, kind:'ipo'|'pt'|'pack'='pack'){
 const pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
 const workflow=s.documentStatus==='Submitted to Accounts';
 const reference=`IPO ${s.legacyIpoNumber} / IPO & Peachtree Division / ${s.documentStatus==='Historical registered'?'HISTORICAL REGISTERED':workflow?'SUBMITTED TO ACCOUNTS':'REVIEW SAMPLE'}`;
 const stage=s.pricingStage==='Revised'?'Final / Revised':s.pricingStage;
 drawReportLogo(pdf);pdf.setFontSize(12);pdf.text('INTERNAL PURCHASE ORDER',14,37);pdf.setFontSize(8);pdf.text('POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED',14,42);
 autoTable(pdf,{startY:46,theme:'grid',margin:{left:14,right:14,bottom:reportBottomMargin},styles:{fontSize:7,cellPadding:1.4},columnStyles:{0:{cellWidth:27},1:{cellWidth:64},2:{cellWidth:27},3:{cellWidth:64}},body:[
  ['Job / IPO reference',`CHP-${s.legacyIpoNumber}`,'Customer PO',s.poNumber],
  ['Company to invoice','PZES (PVT Ltd)','Tax deal','Yes'],
  ['Prepared by','Atif','Checked by','Atif'],
  ['Customer',s.customer,'Quotation reference','Approved UBL configuration'],
  ['Customer contact',s.customerMaster?.contact_person||'Not entered','Contact number',s.customerMaster?.phone||'Not entered'],
  ['Billing address',s.customerMaster?.address||'Not entered','Customer NTN / STRN','See customer PO / verify before invoice'],
  ['Site',s.siteName,'Branch code',s.branchCode],
  ['Configuration',s.configuration,'Pricing stage',stage],
  ['Region',s.region,'Main city',s.mainCity||'Not entered'],
  ['PO issue date',s.poIssuedDate,'Document status',s.documentStatus==='Historical registered'?'Historical registered':workflow?'Submitted to Accounts - awaiting acceptance':'Review sample - not issued'],
  ['Quotation type','UBL Solar - Show Sales Tax Separately','','']
 ]});
 autoTable(pdf,{startY:(pdf as any).lastAutoTable.finalY+4,theme:'grid',margin:{left:14,right:14,bottom:reportBottomMargin},styles:{fontSize:8,cellPadding:2},headStyles:{fillColor:[61,63,146]},head:[['Description','Qty','Unit','Rate excl. GST','Amount excl. GST']],columnStyles:{0:{cellWidth:80},1:{halign:'right',cellWidth:25},2:{cellWidth:13},3:{halign:'right'},4:{halign:'right'}},body:s.billing.map(r=>[r.name,r.name==='Solar Panels'?new Decimal(s.agreedWatts??Number(s.configuration.split('-')[0])*1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,','):'1',r.name==='Solar Panels'?'W':'JOB',r.name==='Solar Panels'?money(String(s.panelSellingRate??44)):money(r.sellingExcludingGst),money(r.sellingExcludingGst)])});
 autoTable(pdf,{startY:(pdf as any).lastAutoTable.finalY+3,theme:'plain',margin:{left:14,right:14,bottom:reportBottomMargin},styles:{fontSize:8,cellPadding:1.8},columnStyles:{0:{cellWidth:60},1:{cellWidth:122,halign:'right'}},body:[
  ['Subtotal excluding GST',right(s.totalSellingExcludingGst)],
  ['Solar panel sales tax @10%',right(s.billing[0].gst)],
  ['Installations sales tax @18%',right(s.billing[1].gst)],
  ['GRAND TOTAL (PKR)',{content:money(s.totalPayable),styles:{halign:'right',fontStyle:'bold'}}],
  ['Remarks',{content:'Panel wattage is subject to availability. Confirm actual installed wattage against the verified IRR before invoicing. Panel invoicing uses actual watts at the agreed rate; installations balance the approved total. Cable adjustments require separate authorization. '+(s.documentStatus==='Historical registered'?'Historical registration; no invoice or Accounts handoff.':workflow?'IPO submitted to Accounts; invoice and confirmed BOQ issuance remain separate.':'Review sample - not issued.'),styles:{halign:'left'}}]
 ]});
 pdf.addPage();drawReportLogo(pdf);pdf.setFontSize(12);pdf.text('PEACHTREE DIVISION',14,38);pdf.setFontSize(9);pdf.text('POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED',14,44);
 autoTable(pdf,{startY:50,theme:'plain',styles:{fontSize:9,cellPadding:2},body:[['Job / IPO',`CHP-${s.legacyIpoNumber}`],['Customer PO',s.poNumber],['Customer',s.customer],['Site / branch',`${s.siteName} / ${s.branchCode}`],['Configuration / pricing stage',`${s.configuration} / ${stage}`],['Entry basis','Selling values excluding tax'],['Quotation type','UBL Solar - Show Sales Tax Separately']]});
 const body:any[]=[];
 const dual=['30-30-40','35-30-40'].includes(s.configuration),batteryQty=dual?8:6;
 const descriptions:Record<string,string>={'Solar Panels':`${s.agreedWatts ?? Number(s.configuration.split('-')[0])*1000} W agreed capacity - confirm available panel brand and wattage before invoicing`,'Structure':'CH-Structure - Customized elevated structure','Inverter':`${dual?2:1} x ${dual?'CH-PCS-HYB-3P-015':'CH-PCS-HYB-3P-020'}`,'Batteries':`${batteryQty} x CH-BAT-HV-05 KW`,'BMS':'2 x CH-BMS-HV - IP65 battery control and safety unit','EPC':'CH-EPC - Installation and balance of system'};

 for(const p of s.phases){body.push([p.name,descriptions[p.name]||'Not recorded',right(p.sellingExcludingGst)]);if(p.name==='BMS')body.push([{content:'BESS Total (subtotal)',styles:{fontStyle:'bold',fillColor:[246,246,252]}},'Subtotal',{content:money(s.phases.filter(v=>['Inverter','Batteries','BMS'].includes(v.name)).reduce((v,p)=>v.add(p.sellingExcludingGst),new Decimal(0)).toFixed(2)),styles:{halign:'right',fontStyle:'bold',fillColor:[246,246,252]}}]);}
 autoTable(pdf,{startY:(pdf as any).lastAutoTable.finalY+7,theme:'grid',headStyles:{fillColor:[61,63,146]},footStyles:{fillColor:[61,63,146]},styles:{fontSize:8,cellPadding:2},columnStyles:{0:{cellWidth:32},1:{cellWidth:108},2:{halign:'right'}},head:[['PT phase','Item / quantity description','Selling excl. GST']],body,foot:[['PHASE TOTAL','',right(s.totalSellingExcludingGst)]]});
 autoTable(pdf,{startY:(pdf as any).lastAutoTable.finalY+6,theme:'plain',styles:{fontSize:9,cellPadding:2},columnStyles:{1:{halign:'right'}},body:[['IPO total before tax',right(s.totalSellingExcludingGst)],['IPO tax (separate reconciliation)',right(s.totalGst)],['IPO payable',right(s.totalPayable)]]});
 pdf.setFontSize(8);pdf.text(pdf.splitTextToSize('PT selling values are locked to agreed capacity and the saved proportional allocation. Actual usage affects actual costs and markup. Final invoice panel allocation may differ after verified IRR review, while the agreed total stays unchanged before authorized cable adjustments. BESS Total is a subtotal, not an additional phase. EPC absorbs rounding only. Historical registration does not record an invoice, dispatch or job closure.',180),14,(pdf as any).lastAutoTable.finalY+8);
 if(kind==='ipo')pdf.deletePage(2);else if(kind==='pt')pdf.deletePage(1);
 drawReportFooter(pdf,reference);pdf.setProperties({title:reference,author:'Power Zone Engineering & Services'});return Buffer.from(pdf.output('arraybuffer'));
}
