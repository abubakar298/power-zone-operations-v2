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
  pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor('#555361');pdf.text(`As of ${report.asOf}  |  ${report.items.length} invoice / milestone records`,45,20);

 };
 autoTable(pdf,{startY:27,margin:{top:27,bottom:18,left:12,right:12},theme:'grid',showHead:'everyPage',rowPageBreak:'avoid',
  head:[['SR#','Site / customer','PO #','Invoice stage','Invoice number','Amount pending\nPKR','Submitted on','Days since\nsubmission']],
  body:report.items.map((r,index)=>[String(index+1),text([r.site,r.customer].filter(Boolean).join('\n')),text(r.po),text(r.stage),text(r.invoice),r.pending==null?'Amount to confirm':money(r.pending)+(r.review?'\nReview required':''),text(r.submittedOn)||'Not recorded',r.days==null?'Not recorded':String(r.days)]),
  styles:{font:'helvetica',fontSize:7,cellPadding:{top:.25,bottom:.25,left:1.6,right:1.6},valign:'top',overflow:'linebreak',lineColor:[223,222,232],lineWidth:.15,textColor:[38,38,49]},headStyles:{fontSize:7.5,fillColor:[237,235,247],textColor:[54,46,85],fontStyle:'bold'},alternateRowStyles:{fillColor:[251,250,254]},
  columnStyles:{0:{cellWidth:9,halign:'center'},1:{cellWidth:64},2:{cellWidth:33},3:{cellWidth:36},4:{cellWidth:48},5:{cellWidth:33,halign:'right'},6:{cellWidth:29,halign:'center'},7:{cellWidth:21,halign:'center'}},
  didParseCell:cell=>{if(cell.section==='body'&&cell.column.index===7){cell.cell.styles.textColor=report.items[cell.row.index].color;cell.cell.styles.fontStyle='bold';}},didDrawPage:header,
 });
 const finalY=(pdf as any).lastAutoTable.finalY;
 if(finalY+12>pdf.internal.pageSize.getHeight()-12){pdf.addPage();header();}
 const y=finalY+12>pdf.internal.pageSize.getHeight()-12?32:finalY+5;
 pdf.setFont('helvetica','bold');pdf.setFontSize(9);pdf.setTextColor('#252335');pdf.text(`Known outstanding total: PKR ${money(report.total)}`,12,y);
 pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.text(report.unknownAmounts?`${report.unknownAmounts} invoice amount(s) to confirm; excluded from the total.`:'All listed outstanding amounts are included in the total.',12,y+5);
 const pages=pdf.getNumberOfPages();for(let page=1;page<=pages;page++){pdf.setPage(page);pdf.setFontSize(7);pdf.setFont('helvetica','normal');pdf.setTextColor('#666475');pdf.text('Power Zone | Recovery follow-up | Submitted invoices only',12,202);pdf.text(`Page ${page} of ${pages}`,285,202,{align:'right'});}
 return pdf;
}
