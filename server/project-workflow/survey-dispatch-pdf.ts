import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {drawReportLogo,drawReportFooter,reportBottomMargin} from '../reports/branding.js';
export function surveyDispatchPdf(plan:any,kind:'dispatch'|'forms'){
 const pdf=new jsPDF({format:'a4'});
 const title=kind==='dispatch'?'Survey Dispatch Order':'Site Survey Form';
 const header=(site?:any)=>{
  drawReportLogo(pdf);pdf.setFontSize(15);pdf.text(title,14,39);pdf.setFontSize(9);
  pdf.text(`${plan.number} | ${plan.approved?'Dispatch approved':'Preview - verify before approval'}`,14,46);
  pdf.text(`Scheduled date: ${plan.date}`,14,52);
  if(site)pdf.text(pdf.splitTextToSize(`${site.customerCode} | ${site.site} (${site.code})`,180),14,59);
 };
 if(kind==='dispatch'){
  header();
  autoTable(pdf,{startY:60,margin:{top:60,bottom:reportBottomMargin+20},head:[['Customer','Site / code','Address','Site contact','Surveyors']],body:plan.sites.map((site:any)=>[site.customerCode+'\n'+site.customer,site.site+'\n'+site.code,site.address||'Not entered',(site.contact||'Not entered')+'\n'+(site.phone||''),plan.surveyors.map((person:any)=>person.display_name).join('\n')]),styles:{fontSize:9,cellPadding:3},headStyles:{fillColor:[40,43,78]},didDrawPage:()=>header()});
  let y=(pdf as any).lastAutoTable.finalY+10;if(y>250){pdf.addPage();header();y=68;}
  pdf.text(`Sites in this dispatch: ${plan.sites.length}`,14,y);pdf.text('Team acknowledgement: ____________________    Date: _______________',14,y+12);
 }else{
  plan.sites.forEach((site:any,index:number)=>{
   if(index)pdf.addPage();header(site);
   autoTable(pdf,{startY:70,margin:{bottom:reportBottomMargin},body:[['Site address',site.address||'Not entered'],['Site contact',(site.contact||'Not entered')+' | '+(site.phone||'Not entered')],['Surveyors',plan.surveyors.map((person:any)=>person.display_name).join(', ')],['Request / scope',site.notes]],styles:{fontSize:9,cellPadding:3},columnStyles:{0:{cellWidth:36,fontStyle:'bold'}},theme:'grid'});
   const y=(pdf as any).lastAutoTable.finalY+6;
   autoTable(pdf,{startY:y,margin:{top:60,bottom:reportBottomMargin+18},head:[['Survey details','Observations / measurements']],body:[['Load and supply / phase',''],['Backup requirements',''],['Roof / installation space',''],['Cable routing and lengths',''],['Existing earthing / protections',''],['Equipment location / access',''],['Photos / attachments',''],['Recommendation / remarks','']],styles:{fontSize:9,minCellHeight:13,cellPadding:3},columnStyles:{0:{cellWidth:55}},headStyles:{fillColor:[40,43,78]},didDrawPage:()=>{if(pdf.getCurrentPageInfo().pageNumber>index+1)header(site);}});
   let end=(pdf as any).lastAutoTable.finalY+9;if(end>265){pdf.addPage();header(site);end=74;}
   pdf.text('Surveyor signature: __________________    Site POC: __________________',14,end);
  });
 }
 drawReportFooter(pdf,plan.number);
 return Buffer.from(pdf.output('arraybuffer'));
}
