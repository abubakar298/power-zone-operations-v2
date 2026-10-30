import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {logo} from '../../server/reports/brand-assets.js';
import type {recoveryReport} from '../../shared/recovery-report.js';
type Report=ReturnType<typeof recoveryReport>;
const text=(v:unknown)=>String(v??'').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e\n]/g,' ');
const money=(v:string)=>Number(v).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
export function recoveryPdf(report:Report){
 const pdf=new jsPDF({orientation:'landscape',format:'a4',compress:true});
 pdf.setProperties({title:'Submitted invoices - recovery follow-up',subject:'Outstanding submitted invoices',creator:'Power Zone'});
 const header=()=>{
  pdf.addImage(logo,'PNG',12,6,27,17,'pz-recovery-logo','FAST');
  pdf.setFont('helvetica','bold');pdf.setFontSize(14);pdf.setTextColor('#252335');pdf.text('Submitted invoices - recovery follow-up',45,13);
  pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor('#555361');pdf.text(`As of ${report.asOf}  |  ${report.items.length} invoice / milestone records  |  Currency: PKR`,45,20);
  pdf.setFontSize(7);pdf.setTextColor('#4f46a5');pdf.text('0-7 days',12,29);pdf.setTextColor('#b45309');pdf.text('8-14 days',38,29);pdf.setTextColor('#b42318');pdf.text('15+ days',66,29);
  pdf.setTextColor('#555361');pdf.text('Age is counted from the recorded submission date. Blank PO means not recorded.',96,29);
 };
 autoTable(pdf,{startY:35,margin:{top:35,bottom:18,left:12,right:12},theme:'grid',showHead:'everyPage',rowPageBreak:'avoid',
  head:[['Site / customer','PO #','Invoice stage','Invoice number','Amount pending\nPKR','Submitted on','Days since\nsubmission']],
  body:report.items.map(r=>[text([r.site,r.customer,r.ipo].filter(Boolean).join('\n')),text(r.po),text(r.stage),text(r.invoice),r.pending==null?'Amount to confirm':money(r.pending)+(r.review?'\nReview required':''),text(r.submittedOn)||'Not recorded',r.days==null?'Not recorded':String(r.days)]),
  styles:{font:'helvetica',fontSize:8,cellPadding:2.5,valign:'top',overflow:'linebreak',lineColor:[223,222,232],lineWidth:.15,textColor:[38,38,49]},headStyles:{fillColor:[237,235,247],textColor:[54,46,85],fontStyle:'bold'},alternateRowStyles:{fillColor:[251,250,254]},
  columnStyles:{0:{cellWidth:66},1:{cellWidth:35},2:{cellWidth:38},3:{cellWidth:51},4:{cellWidth:33,halign:'right'},5:{cellWidth:29},6:{cellWidth:21,halign:'center'}},
  didParseCell:cell=>{if(cell.section==='body'&&cell.column.index===6){cell.cell.styles.textColor=report.items[cell.row.index].color;cell.cell.styles.fontStyle='bold';}},didDrawPage:header,
 });
 const finalY=(pdf as any).lastAutoTable.finalY;
 if(finalY+19>pdf.internal.pageSize.getHeight()-16){pdf.addPage();header();}
 const y=finalY+19>pdf.internal.pageSize.getHeight()-16?40:finalY+7;
 pdf.setFont('helvetica','bold');pdf.setFontSize(9);pdf.setTextColor('#252335');pdf.text(`Known outstanding total: PKR ${money(report.total)}`,12,y);
 pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.text(report.unknownAmounts?`${report.unknownAmounts} invoice amount(s) to confirm; excluded from the total.`:'All listed outstanding amounts are included in the total.',12,y+5);
 const pages=pdf.getNumberOfPages();for(let page=1;page<=pages;page++){pdf.setPage(page);pdf.setFontSize(7);pdf.setFont('helvetica','normal');pdf.setTextColor('#666475');pdf.text('Power Zone | Recovery follow-up | Submitted invoices only',12,202);pdf.text(`Page ${page} of ${pages}`,285,202,{align:'right'});}
 return pdf;
}
