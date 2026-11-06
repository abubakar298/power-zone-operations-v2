import {dispatchPosted} from './signed-dispatch.js';
import type {Pool} from 'pg';
import {warehouseDoCopies} from './material-document-pdf.js';
import {Decimal} from 'decimal.js';
import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {drawReportLogo,drawReportFooter,reportBottomMargin} from '../reports/branding.js';
import {HttpError} from '../http/errors.js';
import {requireWarehouseAccess} from './warehouse-access.js';
export type ReplacementDocumentKind='replacement-out'|'replacement-in';
export type ReplacementPrintRecord={id:string;number:string;warehouse:string;caseId:string;kind:ReplacementDocumentKind;originalNumber:string;site:{name:string;customer:string;ipo:string;orderNumber:string;customerPo:string}[];lines:{itemId:string;description:string;unit:string;quantity:string;originalSerial:string;receivedOrReplacementSerial:string;identityNote:string}[];reason:string;status:string;note:string;createdAt:string};
const value=(v:unknown,fallback='Not recorded')=>typeof v==='string'&&v.trim()?v:fallback;
/** Committed documents only. Never expose arbitrary BOQ, costs or source snapshots. */
export async function replacementPrintRecord(pool:Pool,actor:string,kind:ReplacementDocumentKind,id:string):Promise<ReplacementPrintRecord>{
 const table=kind==='replacement-out'?'inventory_material_replacement_dispatches':'inventory_material_replacement_returns';
 const row=(await pool.query(`SELECT id,number,warehouse,case_id,snapshot,created_at FROM ${table} WHERE id=$1`,[id])).rows[0];
 if(!row)throw new HttpError(404,'Committed replacement document not found.');await requireWarehouseAccess(actor,row.warehouse,pool,true);
 if(kind==='replacement-in'&&!row.snapshot.sites)row.snapshot={...row.snapshot,sites:(await pool.query('SELECT snapshot FROM inventory_material_replacement_cases WHERE id=$1',[row.case_id])).rows[0]?.snapshot.sites??[]};
 row.snapshot={...row.snapshot,stockPosting:await dispatchPosted(pool,kind,id)};return replacementCommittedPrintRecord(row,kind);
}
export function replacementCommittedPrintRecord(row:any,kind:ReplacementDocumentKind):ReplacementPrintRecord{
 const s=row.snapshot,original=s.original??{},out=kind==='replacement-out',sites=s.sites??[];
 const site=sites.map((r:any)=>({name:value(r.siteName),customer:value(r.customer),ipo:value(r.ipo),orderNumber:value(r.orderNumber),customerPo:value(r.customerPo)}));
 const lines=out?(s.lines??[]).map((r:any)=>({itemId:value(r.itemId),description:value(r.description),unit:value(r.unit),quantity:r.quantity,originalSerial:value(original.serial,'Unverified'),receivedOrReplacementSerial:value(r.serial,'Unverified'),identityNote:''})):[{itemId:value(s.receivedItemId,'Unverified returned ID'),description:value(original.description),unit:value(s.receivedUnit,'Unverified'),quantity:s.quantity,originalSerial:value(original.serial,'Unverified'),receivedOrReplacementSerial:value(s.receivedSerial,'Unverified'),identityNote:`Expected original: ${value(s.expectedItemId??s.itemId)} / ${value(s.expectedUnit??s.unit)}. Actual received identity stays separate.${(s.flags??[]).length?' '+s.flags.join(' '):''}`}];
 return{id:row.id,number:row.number,warehouse:row.warehouse,caseId:row.case_id,kind,originalNumber:value(original.number),site,lines,reason:value(s.reason),status:out?(s.requiresSignedGate&&s.stockPosting!==true?'AWAITING SIGNED GATE COPY — REPLACEMENT OUT':'ISSUED — REPLACEMENT OUT'):(s.requiresSignedIgp&&s.stockPosting!==true?'AWAITING SIGNED IGP — NO FAULTY STOCK IN':'PHYSICALLY RECEIVED — FAULTY / INSPECTION HOLD'),note:out?(s.requiresSignedGate&&s.stockPosting!==true?'Awaiting signed gate copy. Stock balances are unchanged.':'Replacement warehouse OUT only. Any original item returned is separately counted on a return IGP. This document creates no warehouse IN.'):(s.requiresSignedIgp&&s.stockPosting!==true?'Prepared return IGP awaiting the signed warehouse copy. No faulty custody or usable stock is credited until the signed IGP is uploaded.':'Not available for normal issue. This IGP records physical custody only; available warehouse stock is unchanged. Shaiggan must separately confirm usable condition and exact item identity before a counted quantity is released into usable stock. Unusable, warranty or disposal decisions remain held.'),createdAt:new Date(row.created_at).toISOString()};
}
const printable=(v:unknown)=>String(v??'').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const quantity=(v:string)=>new Decimal(v).toDecimalPlaces(2).toFixed();
export function replacementDocumentPdf(record:ReplacementPrintRecord){
 let copyLabel='';
 const pdf=new jsPDF({format:'a4',compress:true}),top=78,headed=new Set<number>();
 const header=()=>{const page=pdf.getCurrentPageInfo().pageNumber;if(headed.has(page))return;headed.add(page);drawReportLogo(pdf);pdf.setFont('helvetica','bold');pdf.setFontSize(15);pdf.setTextColor(30,32,45);pdf.text(record.kind==='replacement-out'?'Replacement Delivery Note':'Replacement Return IGP',14,39);pdf.setFontSize(9);pdf.text(printable(record.status+(copyLabel?' · '+copyLabel:'')),14,46);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text(printable(record.number+' · Original DO '+record.originalNumber),14,53);pdf.text(printable('Warehouse: '+record.warehouse),14,59);pdf.text('Date: '+record.createdAt.slice(0,10),14,65);if(record.kind==='replacement-in'){pdf.setFont('helvetica','bold');pdf.text('Not available for normal issue',14,71);}};
 const table=(options:any)=>autoTable(pdf,{margin:{left:14,right:14,top,bottom:65},styles:{font:'helvetica',fontSize:8,cellPadding:3,valign:'top',overflow:'linebreak',lineWidth:.15,lineColor:[224,224,234]},headStyles:{fillColor:[240,239,248],textColor:[40,40,60],fontStyle:'bold'},theme:'grid',rowPageBreak:'avoid',didDrawPage:header,...options});
 for(const [copyIndex,label]of (record.kind==='replacement-out'?warehouseDoCopies:['']).entries()){if(copyIndex)pdf.addPage();copyLabel=label;
 table({startY:top,head:[['Site / customer','Customer PO','IPO / order']],body:record.site.map(s=>[printable(s.name+'\n'+s.customer),printable(s.customerPo),printable(s.ipo+'\n'+s.orderNumber)]),columnStyles:{0:{cellWidth:80},1:{cellWidth:42},2:{cellWidth:60}}});
 let y=(pdf as any).lastAutoTable.finalY+8;if(y>220){pdf.addPage();y=top;}
 table({startY:y,head:[['Final item ID','Material / recorded identity','Unit','Quantity']],body:record.lines.map(r=>[printable(r.itemId),printable(r.description+(r.identityNote?'\n'+r.identityNote:'')),printable(r.unit),quantity(r.quantity)]),columnStyles:{0:{cellWidth:45},1:{cellWidth:92},2:{cellWidth:20},3:{cellWidth:25,halign:'right'}}});
 y=(pdf as any).lastAutoTable.finalY+8;if(y>220){pdf.addPage();y=top;}
 table({startY:y,head:[['Original serial','Replacement / received serial']],body:record.lines.map(r=>[printable(r.originalSerial),printable(r.receivedOrReplacementSerial)]),columnStyles:{0:{cellWidth:91},1:{cellWidth:91}}});
 y=(pdf as any).lastAutoTable.finalY+8;const note=pdf.splitTextToSize(printable(record.note+'\nReason: '+record.reason),182);if(y+note.length*4+32>263){pdf.addPage();header();y=top;}
 pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text(note,14,y);y+=note.length*4+12;
 }
 for(let page=1;page<=pdf.getNumberOfPages();page++){pdf.setPage(page);pdf.setFont('helvetica','normal');pdf.setFontSize(8);for(const [index,label]of(record.kind==='replacement-out'?['Issued by Store','Received by client / engineer']:['Counted by Warehouse','Returned by']).entries()){const x=14+index*94,y=247;pdf.line(x,y,x+85,y);pdf.text(label,x,y+5);pdf.text('Name: __________________    Date: ______________',x,y+11);}}

 drawReportFooter(pdf,record.number);return Buffer.from(pdf.output('arraybuffer'));
}
