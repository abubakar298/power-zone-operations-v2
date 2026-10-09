import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { Decimal } from "decimal.js";
import { logo } from "../reports/brand-assets.js";
import { cniWhiteLogo, cniReferenceTerms } from "./cni-assets.js";
import { displayDate } from "../display/dates.js";
import type { CniSnapshot } from "./cni-report.js";

// Coordinates and typography reproduce the owner-approved Photon design preview.
// The selected template is stored on each immutable quotation snapshot.
export function buildApprovedCniPdf(s:CniSnapshot,reference:string,draft:boolean) {
 const p=new jsPDF({unit:"pt",format:"a4"});const W=595.28,H=841.89;
 const blue="#343C91",red="#E52D3B",ink="#252332",muted="#6F6A7B",light="#F0F2F9";
 const qty=s.pricing.quantity,kw=qty*125,kwh=qty*261;
 const money=(v:string)=>new Decimal(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",");
 const text=(x:number,y:number,value:string,size=10,color=ink,bold=false,align:"left"|"right"="left")=>{
  p.setFont("helvetica",bold?"bold":"normal");p.setFontSize(size);p.setTextColor(color);p.text(value,x,H-y,{align});
 };
 const rect=(x:number,y:number,w:number,h:number,color:string,r=0)=>{p.setFillColor(color);if(r)p.roundedRect(x,H-y-h,w,h,r,r,"F");else p.rect(x,H-y-h,w,h,"F");};
 const para=(value:string,x:number,y:number,width:number,size=10,leading=16,color=ink)=>{
  p.setFont("helvetica","normal");p.setFontSize(size);p.setTextColor(color);
  const lines=p.splitTextToSize(value,width) as string[];
  p.text(lines,x,H-y+size,{lineHeightFactor:leading/size});return y-lines.length*leading-10;
 };
 const footer=(n:number)=>{p.setDrawColor("#DCE0EB");p.line(42,H-48,W-42,H-48);
  text(42,31,draft?"CONFIDENTIAL  |  DRAFT - AWAITING MANAGEMENT APPROVAL":"CONFIDENTIAL  |  POWER ZONE ENGINEERING & SERVICES",7,muted);
  text(W-42,31,`POWER ZONE  /  ${String(n).padStart(2,"0")}`,7,muted,false,"right");
 };
 const header=(n:number,label:string,title:string,subtitle="")=>{
  p.addPage();p.addImage(logo,"PNG",53.77,38,71.46,45);
  text(W-179,H-54,"C&I ENERGY STORAGE",8,muted);
  text(42,H-126,label.toUpperCase(),9,red,true);text(42,H-164,title,27,blue,true);
  if(subtitle)text(42,H-187,subtitle,10,muted);footer(n);
 };
 const fit=(value:string,width:number,size=9)=>{p.setFont("helvetica","normal");p.setFontSize(size);return p.splitTextToSize(value,width) as string[];};
 p.setProperties({title:reference,author:"Power Zone"});
 rect(0,0,W,H,blue);p.setFillColor("#414AA1");
 // The original background slant, with the logo's aspect ratio preserved.
 p.lines([[W-365,0],[0,-H],[490-W,0],[365-490,H]],365,H,[1,1],"F",true);
 p.addImage(cniWhiteLogo,"PNG",42,30,105.2,66);
 rect(42,H-115,62,4,red);text(42,H-151,"COMMERCIAL & INDUSTRIAL",9,"#FFFFFF",true);
 ["Energy storage.","Engineered for","your business."].forEach((v,i)=>text(42,H-199-i*44,v,37,"#FFFFFF",true));
 text(42,H-326,"C&I BESS PROPOSAL",12,"#DFE3FF");
 text(42,398,`${kw} kW`,32,"#FFFFFF",true);text(42,378,"TOTAL PCS POWER",8,"#DFE3FF");
 text(42,329,`${kwh} kWh`,32,"#FFFFFF",true);text(42,309,"TOTAL ENERGY STORAGE",8,"#DFE3FF");
 text(42,259,`${qty} ${qty===1?"CABINET":"CABINETS"}`,11,"#FFFFFF",true);
 p.setDrawColor("#8991CF");p.line(42,H-194,W-42,H-194);text(42,166,"PREPARED FOR",8,"#DFE3FF");
 const customerLines=fit(s.customer.name,511,21);customerLines.slice(0,2).forEach((v,i)=>text(42,140-i*23,v,21,"#FFFFFF",true));
 if(s.customer.city)text(42,customerLines.length>1?90:116,`${s.customer.city}, Pakistan`,10,"#DFE3FF");
 text(42,66,`${reference}  |  ${displayDate(s.issuedDate)}`,8,"#FFFFFF");
 if(draft)text(42,44,"CONFIDENTIAL  /  DRAFT - AWAITING MANAGEMENT APPROVAL",7,"#DFE3FF");

 header(2,"01 / Introduction","A solution for your energy needs.",[s.customer.name,s.customer.city].filter(Boolean).join("  |  "));
 const details:[[string,string],...Array<[string,string]>]=[["Customer",s.customer.name],["Contact person",s.customer.contact_person],["Contact number",s.customer.phone],["Address",[s.customer.address,s.customer.city,s.customer.province].filter(Boolean).join(", ")]];
 let detailY=H-250;const measured=details.map(([label,value])=>({label,lines:fit(value||"-",385)}));
 const cardHeight=Math.max(123,42+measured.reduce((sum,v)=>sum+Math.max(19,v.lines.length*12+5),0));
 rect(42,H-208-cardHeight,511,cardHeight,light,6);text(56,H-230,"CUSTOMER & DOCUMENT DETAILS",9,red,true);
 for(const row of measured){text(56,detailY,row.label,9,muted);row.lines.forEach((v,i)=>text(150,detailY-i*12,v,9));detailY-=Math.max(19,row.lines.length*12+5);}
 let metadataY=H-208-cardHeight-22;
 for(const [label,value] of [["Proposal no.",reference],["Proposal date",displayDate(s.issuedDate)],["Validity",`${s.validityDays} days from issue`]]){
  text(56,metadataY,label,9,muted);const lines=fit(value,385);lines.forEach((v,i)=>text(150,metadataY-i*12,v,9));metadataY-=Math.max(19,lines.length*12+5);
 }
 let y=metadataY-15;
 for(const value of [`Dear ${s.customer.contact_person||"Customer"},`,"Thank you for considering Power Zone for your requirements. Enclosed is our proposal based on your specifications. We look forward to providing exceptional service and fulfilling your energy needs with reliability and efficiency.","Thank you for the opportunity to work with you. We are confident that our solutions will meet your expectations and bring value to your operations."])y=para(value,42,y,510);
 y-=5;text(42,y,"Best Regards,");y-=25;
 for(const value of ["Abu Bakar Siddique","Director Business Development","Power Zone Engineering & Services","Cell: +92 323 7500128","Email: abubakar@powerzone.com.pk"]){text(42,y,value,10,ink,value==="Abu Bakar Siddique");y-=15;}
 rect(42,74,511,69,light,8);text(60,125,"YOUR PROPOSED SYSTEM",9,red,true);text(60,102,`${qty} x CPS ES-125kW/261kWh`,16,blue,true);text(60,84,`${kw} kW PCS  /  ${kwh} kWh storage`,11,muted);

 header(3,"02 / Technical solution","An integrated cabinet system.","Detailed technical scope. One consolidated commercial offer.");
 const technical=[["PCS unit","Rated power: 125 kW; output AC 400 V / 50 Hz."],["Battery system","832 V / 314 Ah / 261 kWh; 0.5C at 25 degrees C battery rack."],["Battery management","BMU, control box and communication cables."],["Fire suppression","Aerosol chamber, detectors and alarms, explosion-proof vent."],["Liquid cooling","3 kW liquid cooling machine with pipes and cables."],["Auxiliary system","Auxiliary system, breakers, UPS and dehumidifier."],["Cabinet enclosure","1000 x 1400 x 2400 mm; IP55 with all necessary accessories."],["Control unit","BAU - CPS ES-125kW/261kWh. EMS: Local operation monitoring system for Microgrid."]];
 y=H-226;technical.forEach(([a,b],i)=>{if(i%2===0)rect(42,y-54,511,62,light);text(54,y-10,a,10,blue,true);para(b,225,y,310,9,14);y-=68;});

 header(4,"03 / Commercial offer","A clear, consolidated offer.","One consolidated commercial offer. No component pricing.");
 y=H-230;rect(42,y-45,511,45,blue,5);text(56,y-28,"CPS ES-125kW/261kWh",12,"#FFFFFF",true);text(540,y-28,`${qty} ${qty===1?"CABINET":"CABINETS"}`,11,"#FFFFFF",true,"right");
 const offer=s.pricing.displayedOffer??s.pricing.standardPayable;
 const rows:Array<[string,string]>=[["Standard unit offer price",`PKR ${money(new Decimal(offer).div(qty).toFixed(2))}`],["Quantity",`${qty} ${qty===1?"cabinet":"cabinets"}`],["Offer before standard discount",`PKR ${money(offer)}`]];
 if(s.pricing.standardDiscount)rows.push(["Standard discount",`PKR ${money(s.pricing.standardDiscount)}`]);
 if(new Decimal(s.pricing.discount).gt(0))rows.push([draft?"Proposed Management discount":"Management-approved discount",`PKR ${money(s.pricing.discount)}`]);
 if(s.pricing.presentation==="Separate")rows.push(["Price before GST",`PKR ${money(s.pricing.beforeTax)}`],[`GST ${s.pricing.taxRate}%`,`PKR ${money(s.pricing.tax)}`]);
 rows.push(["Total payable",`PKR ${money(s.pricing.payable)}`]);
 y-=81;const spacing=Math.min(58,340/rows.length);
 rows.forEach(([a,b],i)=>{const last=i===rows.length-1;if(last)rect(42,y-14,511,Math.min(48,spacing+12),light,5);text(55,y,a,11,blue,last);text(540,y,b,12,blue,last,"right");y-=spacing;});
 para("Installation, commissioning, and delivery are excluded and will be charged as per actual.",42,180,510,9,14);

 const raw=cniReferenceTerms.replace(/Security Level: Confidential/g,"").replace(/±/g,"+/-").replace(/℃/g," degrees C");
 const blocks=raw.split(/\n(?=(?:Notes:|[1-9]\. |[A-H]\. |[1-9]-))/).map(v=>v.replace(/\n/g," ").replace(/[^\x20-\x7e]/g,""));
 const joined:string[]=[];for(const block of blocks){const last=joined.at(-1);if(last&&/^(?:Notes:|[1-9]\. )/.test(last)&&last.length<100&&!/^[1-9]\. /.test(block))joined[joined.length-1]+="\n\n"+block;else joined.push(block);}
 let n=5;header(n,"04 / Commercial terms","Terms, warranty & services.");y=H-223;
 for(const block of joined){const lines=fit(block,511);const height=lines.length*14;
  if(block.startsWith("5. Warranty and Services")){
   // Restore the reference's structured services table instead of extracted prose.
   if(y-220<72){header(++n,"04 / Commercial terms continued","Terms, warranty & services.");y=H-223;}
   text(42,y-9,"5. Warranty and Services in Main Offer:",9);
   autoTable(p,{startY:H-y+24,head:[["No.","Service item","Description","Price (PKR)"]],body:[
    [{content:"1",rowSpan:2},{content:"Warranty",rowSpan:2},"PCS - 3 Years","Included"],
    ["Battery - 3 Years","Included"],
    [{content:"2",rowSpan:2},{content:"Training",rowSpan:2},"Remote Training: Product introduction, installation, commissioning, maintenance and troubleshooting","Free"],
    ["On Site","Included"],
    ["3","On-Site","Supervision on commissioning","Included"],
    ["4","Remote","Power Zone Service Hotline","Included"]
   ],theme:"grid",margin:{left:42,right:42,bottom:72},styles:{font:"helvetica",fontSize:9,cellPadding:5,textColor:ink,lineColor:"#DCE0EB",lineWidth:0.4},headStyles:{fillColor:blue,textColor:"#FFFFFF"},columnStyles:{0:{cellWidth:30},1:{cellWidth:85},2:{cellWidth:301},3:{cellWidth:95.28}},rowPageBreak:"avoid"});
   y=H-(p as any).lastAutoTable.finalY-13;continue;
  }
  if(height>H-223-72)throw new Error("A complete terms item exceeds one page.");
  if(y-height<72){header(++n,"04 / Commercial terms continued","Terms, warranty & services.");y=H-223;}
  para(block,42,y,511,9,14);y-=height+13;
 }
 return Buffer.from(p.output("arraybuffer"));
}
