import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {drawReportLogo,drawReportFooter} from '../reports/branding.js';

type TemporaryLine={itemId:string;description:string;quantity:string;unit:string;remarks:string};
export type TemporaryDocumentSnapshot={number:string;type:'IGP'|'OGP'|'TRF'|'IRR'|'OTHER';date:string;warehouse:string;party:string;sourceReference:string;actualReference:string;notes:string;detailsConfirmed:boolean;lines:TemporaryLine[]};
const titles={IGP:'Inwards Gate Pass',OGP:'Outwards Gate Pass',TRF:'Stock Transfer',IRR:'Inventory Return Record',OTHER:'Inventory Document'};
const parties={IGP:'Supplier / source',OGP:'Site / destination',TRF:'Destination',IRR:'Returned from site',OTHER:'Supplier / site / destination'};
const signatures={IGP:['Received by storekeeper','Verified by Inventory'],OGP:['Warehouse issued by','Received by'],TRF:['Dispatched by','Received by'],IRR:['Returned by','Warehouse received by'],OTHER:['Prepared by','Verified by']};
const printable=(value:unknown)=>String(value??'').replace(/[‐-―−]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const pending='To be entered';

/** A4 temporary document in the same layout as issued inventory documents. It is a
 * tracking copy only: it carries no stock posting and says so on every page. */
export function temporaryDocumentPdf(doc:TemporaryDocumentSnapshot){
 const pdf=new jsPDF({format:'a4',compress:true}),top=70,headed=new Set<number>();
 const status=doc.detailsConfirmed?'TEMPORARY - ACTUAL DETAILS CONFIRMED':'TEMPORARY - CONFIRM DETAILS AGAINST THE ACTUAL TRANSACTION';
 const header=()=>{
  const page=pdf.getCurrentPageInfo().pageNumber;if(headed.has(page))return;headed.add(page);
  drawReportLogo(pdf);pdf.setTextColor(30,32,45);pdf.setFont('helvetica','bold');pdf.setFontSize(15);pdf.text(titles[doc.type]??titles.OTHER,14,39);
  pdf.setTextColor(166,96,20);pdf.setFontSize(9);pdf.text(status,14,46);
  pdf.setFont('helvetica','normal');pdf.setTextColor(65,65,75);pdf.setFontSize(8);
  pdf.text(printable(doc.number),14,53);pdf.text(pdf.splitTextToSize(printable(`Warehouse: ${doc.warehouse||pending}`),150),14,59);
  pdf.text(printable(`Date: ${doc.date||pending}`),196,59,{align:'right'});
 };
 const table=(options:any)=>autoTable(pdf,{margin:{left:14,right:14,top,bottom:65},styles:{font:'helvetica',fontSize:7.5,cellPadding:2.5,valign:'top',overflow:'linebreak',lineWidth:.15,lineColor:[224,224,234]},headStyles:{fillColor:[240,239,248],textColor:[40,40,60],fontStyle:'bold'},alternateRowStyles:{fillColor:[250,250,253]},theme:'grid',rowPageBreak:'avoid',didDrawPage:header,...options});
 const type=doc.type in titles?doc.type:'OTHER';
 table({startY:top,head:[[parties[type],'Related PO / IPO / reference','Actual document reference']],body:[[printable(doc.party||pending),printable(doc.sourceReference||pending),printable(doc.actualReference||'Not yet issued')]],columnStyles:{0:{cellWidth:72},1:{cellWidth:55},2:{cellWidth:55}}});
 let y=(pdf as any).lastAutoTable.finalY+8;
 const lines=doc.lines.filter(l=>l.itemId||l.description||l.quantity||l.remarks);
 const body=lines.map((l,i)=>[String(i+1),printable(l.itemId||'ID pending'),printable(l.description||'Description pending'),printable(l.quantity||''),printable(l.unit||''),printable(l.remarks||'')]);
 table({startY:y,head:[['SR#','Item ID','Item / description','Qty','Unit','Remarks']],body:body.length?body:[['1','No items entered','','','','']],columnStyles:{0:{cellWidth:10},1:{cellWidth:36},2:{cellWidth:66},3:{cellWidth:16,halign:'right'},4:{cellWidth:18},5:{cellWidth:36}}});
 y=(pdf as any).lastAutoTable.finalY+6;
 pdf.setFont('helvetica','normal');pdf.setFontSize(8);
 const note=pdf.splitTextToSize(printable((doc.notes?`Notes: ${doc.notes}\n`:'')+`Temporary reference ${doc.number} is for tracking only and does not replace the final approved document reference. No stock movement is posted by this document.`),182);
 if(y+note.length*4>237){pdf.addPage();header();y=top;}
 pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(75,75,85);pdf.text(note,14,y);
 for(let page=1;page<=pdf.getNumberOfPages();page++){
  pdf.setPage(page);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(75,75,85);
  signatures[type].forEach((label,i)=>{const x=14+i*94,signatureY=247;pdf.setDrawColor(140,140,155);pdf.line(x,signatureY,x+85,signatureY);pdf.text(label,x,signatureY+5);pdf.text('Name: ____________________    Date: ______________',x,signatureY+11);});
 }
 drawReportFooter(pdf,printable(doc.number));
 return Buffer.from(pdf.output('arraybuffer'));
}
