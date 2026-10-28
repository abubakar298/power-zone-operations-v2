import {Decimal} from 'decimal.js';
import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {drawReportLogo,drawReportFooter} from '../reports/branding.js';
import type {MaterialPrintModel} from './material-document-model.js';

const printable=(value:unknown)=>String(value??'').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const quantity=(value:string|null)=>value===null?'':new Decimal(value).toDecimalPlaces(2).toFixed();
/** Render-only: whitelisted document fields, never prices or arbitrary source
 * snapshots. Long rows paginate with repeated headers and top-aligned cells. */
export function materialDocumentPdf(model:MaterialPrintModel){
 const pdf=new jsPDF({format:'a4'}),status=model.status==='received'?'RECEIVED - WAREHOUSE IN':model.status==='site-record'?'SITE USAGE - NOT A WAREHOUSE RECEIPT':model.status==='issued'?'ISSUED - WAREHOUSE DISPATCH':model.status==='simulation'?'SIMULATION - NOT AN ISSUED DOCUMENT':'DRAFT - NOT ISSUED';
 const top=70,headed=new Set<number>();
 const header=()=>{
  const page=pdf.getCurrentPageInfo().pageNumber;if(headed.has(page))return;headed.add(page);
  drawReportLogo(pdf);pdf.setTextColor(30,32,45);pdf.setFont('helvetica','bold');pdf.setFontSize(15);pdf.text(model.title,14,39);
  pdf.setTextColor(88,67,176);pdf.setFontSize(9);pdf.text(status,14,46);
  pdf.setFont('helvetica','normal');pdf.setTextColor(65,65,75);pdf.setFontSize(8);
  pdf.text(printable(model.reference),14,53);pdf.text(pdf.splitTextToSize(printable(`Warehouse: ${model.warehouse}`),150),14,59);
  if(model.sites.length)pdf.text(model.sites.length===1?'1 site':`${model.sites.length} sites`,196,59,{align:'right'});
 };
 const table=(options:any)=>autoTable(pdf,{margin:{left:14,right:14,top,bottom:65},styles:{font:'helvetica',fontSize:7.5,cellPadding:2.5,valign:'top',overflow:'linebreak',lineWidth:.15,lineColor:[224,224,234]},headStyles:{fillColor:[240,239,248],textColor:[40,40,60],fontStyle:'bold'},alternateRowStyles:{fillColor:[250,250,253]},theme:'grid',rowPageBreak:'avoid',didDrawPage:header,...options});
 table({startY:top,head:[model.context?.columns??['Site / customer','Customer PO','IPO / order']],body:model.context?.rows??model.sites.map(s=>[printable(s.name+(s.customer?'\n'+s.customer:'')),printable(s.customerPo||'Not recorded'),printable(s.ipo+(s.orderNumber?' / Order '+s.orderNumber:''))]),columnStyles:{0:{cellWidth:80},1:{cellWidth:42},2:{cellWidth:60}}});
 let y=(pdf as any).lastAutoTable.finalY+8;
 const usage=model.kind==='customer-signoff',internal=model.kind==='irr';
 const worksheet=model.returnWorksheet;
 const columns=worksheet?['Item ID / material','Unit','DO OUT','Used at sites','Expected return','Verified IN','Still due','Actual return']:internal?['Group','Item ID','Material / variant','Unit',model.issuedLabel,'Used','Returned']:usage?['Item ID','Material / variant','Unit',...(!model.omitIssued?[model.issuedLabel]:[]),'Used',...(model.customerReturnColumn?['Returned']:[])]:['Item ID','Material / variant','Unit',model.issuedLabel];
 const body=model.rows.map(r=>{
  const id=printable(r.itemId||'ID pending'),description=printable((r.description||'Description pending')+(r.remark?'\n'+r.remark:'')),unit=printable(r.unit||'Unit pending'),issued=quantity(r.issued),used=quantity(r.used),returned=quantity(r.returned);
  return worksheet?[id+'\n'+description,unit,issued,used,quantity(r.expectedReturn??null),quantity(r.verifiedReturn??null),quantity(r.remainingReturn??null),'']:internal?[printable(r.group||'Miscellaneous'),id,description,unit,issued,used,returned]:usage?[id,description,unit,...(!model.omitIssued?[issued]:[]),used,...(model.customerReturnColumn?[returned]:[])]:[id,description,unit,issued];
 });
 const widths=worksheet?[57,13,18,18,20,18,18,20]:internal?[20,40,50,15,19,18,20]:usage?(model.omitIssued?[47,95,18,22]:model.customerReturnColumn?[40,66,16,20,20,20]:[47,75,18,22,20]):[50,85,20,27];
 if(y>225){pdf.addPage();y=top;}
 table({startY:y,head:[columns],body:body.length?body:[[...columns.map((_,i)=>i===0?'No materials recorded':'')]],columnStyles:Object.fromEntries(widths.map((cellWidth,i)=>[i,{cellWidth}]))});
 y=(pdf as any).lastAutoTable.finalY+6;
 const note=pdf.splitTextToSize(printable(model.note),182);
 if(y+note.length*4>237){pdf.addPage();header();y=top;}
 pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(75,75,85);pdf.text(note,14,y);
 // Reserve a signature area on every sheet, including partial return forms.
 for(let page=1;page<=pdf.getNumberOfPages();page++){
  pdf.setPage(page);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(75,75,85);
  model.signatures.forEach((label,i)=>{
   const x=14+i*94,signatureY=247;pdf.setDrawColor(140,140,155);pdf.line(x,signatureY,x+85,signatureY);pdf.text(printable(label),x,signatureY+5);pdf.text('Name: ____________________    Date: ______________',x,signatureY+11);
  });
 }
 drawReportFooter(pdf,printable(model.reference));
 return Buffer.from(pdf.output('arraybuffer'));
}
