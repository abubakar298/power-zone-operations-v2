import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { drawReportLogo } from "../reports/branding.js";
import { cniWhiteLogo, cniReferenceTerms } from "./cni-assets.js";
import { displayDate } from "../display/dates.js";
import type { priceCni } from "./cni-policy.js";
export interface CniSnapshot {
 customer:{name:string;contact_person:string;phone:string;address:string;city:string;province:string;email:string};
 siteName:string;pricing:ReturnType<typeof priceCni>;validityDays:number;preparedBy:string;issuedDate:string;
}
const blue=[52,60,145] as const,red=[229,45,59] as const;
const money=(v:string)=>new Intl.NumberFormat("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v));
export function buildCniPdf(s:CniSnapshot,number:string,draft:boolean) {
 const p=new jsPDF();const totalKw=s.pricing.quantity*125,totalKwh=s.pricing.quantity*261;
 p.setProperties({title:number,author:"Power Zone"});
 p.setFillColor(...blue);p.rect(0,0,210,297,"F");
 p.setFillColor(65,74,161);p.triangle(172,0,210,0,210,297,"F");
 p.addImage(cniWhiteLogo,"PNG",15,10.6,37.2,23.3);
 p.setFillColor(...red);p.rect(15,39.2,22,1.5,"F");
 p.setTextColor(255,255,255);p.setFont("helvetica","bold");p.setFontSize(9);p.text("COMMERCIAL & INDUSTRIAL",15,53.3);
 p.setFontSize(37);p.text(["Energy storage.","Engineered for","your business."],15,70.2,{lineHeightFactor:1.19});
 p.setFont("helvetica","normal");p.setFontSize(12);p.text("C&I BESS PROPOSAL",15,115);
 p.setFont("helvetica","bold");p.setFontSize(30);p.text(`${totalKw} kW`,15,156.6);
 p.setFontSize(8);p.text("TOTAL PCS POWER",15,163.6);p.setFontSize(30);p.text(`${totalKwh} kWh`,15,180.9);
 p.setFontSize(8);p.text("TOTAL ENERGY STORAGE",15,188);p.setFontSize(10);p.text(`${s.pricing.quantity} CABINETS`,15,205.6);
 p.setDrawColor(137,145,207);p.line(15,228.6,195,228.6);p.setFontSize(8);p.text("PREPARED FOR",15,238.4);
 p.setFontSize(17);p.text(p.splitTextToSize(s.customer.name,180).slice(0,2),15,270);
 p.setFont("helvetica","normal");p.setFontSize(7);p.text(`${number}  |  ${displayDate(s.issuedDate)}`,15,273.7);
 const page=(label:string,title:string)=>{p.addPage();drawReportLogo(p);p.setTextColor(...red);p.setFontSize(9);p.setFont("helvetica","bold");p.text(label,15,48);p.setTextColor(...blue);p.setFontSize(24);p.text(title,15,62);};
 const table=(body:any[],startY:number,head?:string[])=>autoTable(p,{startY,head:head?[head]:undefined,body,margin:{left:15,right:15,bottom:20},rowPageBreak:"avoid",styles:{font:"helvetica",fontSize:10,cellPadding:4},headStyles:{fillColor:[...blue]},alternateRowStyles:{fillColor:[240,242,249]}});
 page("01 / INTRODUCTION","A solution for your energy needs.");
 table([["Customer",s.customer.name],["Contact person",s.customer.contact_person],["Phone",s.customer.phone],["Address",[s.customer.address,s.customer.city,s.customer.province].filter(Boolean).join(", ")],["Site / Project",s.siteName],["Proposal no.",number],["Proposal date",displayDate(s.issuedDate)],["Validity",`${s.validityDays} days from issue`]],76);
 let y=(p as any).lastAutoTable.finalY+14;p.setTextColor(37,35,50);p.setFont("helvetica","normal");p.setFontSize(10);
 const intro=`Dear ${s.customer.contact_person||"Customer"},\n\nThank you for considering Power Zone for your energy requirements. We are pleased to present our integrated commercial and industrial energy storage proposal.\n\nPrepared by: ${s.preparedBy}\nPower Zone Engineering & Services`;
 p.text(p.splitTextToSize(intro,175),15,y);
 page("02 / TECHNICAL SOLUTION","An integrated cabinet system.");
 table([["System",`${s.pricing.quantity} x CPS ES-125kW/261kWh`],["PCS",`125 kW per cabinet; AC 400 V / 50 Hz. Total: ${totalKw} kW`],["Battery",`261 kWh per cabinet; 832 V / 314 Ah; 0.5C at 25 C. Total: ${totalKwh} kWh`],["Battery management","BMU, control box and communication cables"],["Fire suppression","Aerosol chamber, detectors, alarms and explosion-proof vent"],["Liquid cooling","3 kW liquid cooling machine, pipes and cables per cabinet"],["Auxiliary system","Breakers, UPS and dehumidifier"],["Enclosure","IP55 enclosure and accessories"],["Control unit","BAU and operation monitoring system for Microgrid"]],78);
 page("03 / COMMERCIAL OFFER","A clear, consolidated offer.");
 const rows:any[]=[["Description","CPS ES-125kW/261kWh"],["Cabinet quantity",String(s.pricing.quantity)],["Standard final unit price",`PKR ${money(s.pricing.unitPayable)}`],["Standard offer value",`PKR ${money(s.pricing.standardPayable)}`]];
 if(s.pricing.standardDiscount)rows.push(["Offer before standard discount",`PKR ${money(s.pricing.displayedOffer)}`],["Standard discount",`PKR ${money(s.pricing.standardDiscount)}`]);
 if(s.pricing.discount!=="0.00")rows.push([draft?"Proposed discount - awaiting approval":"Management-approved discount",`PKR ${money(s.pricing.discount)}`]);
 if(s.pricing.presentation==="Separate")rows.push(["Price before GST",`PKR ${money(s.pricing.beforeTax)}`],[`GST ${s.pricing.taxRate}%`,`PKR ${money(s.pricing.tax)}`]);
 rows.push(["Total payable",`PKR ${money(s.pricing.payable)}`]);table(rows,80);
 y=(p as any).lastAutoTable.finalY+15;p.setFontSize(10);p.setFont("helvetica","normal");p.setTextColor(37,35,50);p.text(p.splitTextToSize("Installation, commissioning and delivery are excluded and will be charged as per actual.",175),15,y);
 page("04 / COMMERCIAL TERMS","Terms, warranty & services.");
 const paragraphs=cniReferenceTerms.replace(/Security Level: Confidential/g,"").split(/\n(?=(?:[1-9]\. |[A-H]\. |[1-9]-))/).map(t=>[t.replace(/\n/g," ").replace(/[^\x20-\x7e]/g,"")]);
 table(paragraphs,78);
 for(let i=1;i<=p.getNumberOfPages();i++){p.setPage(i);if(i>1){p.setFontSize(7);p.setFont("helvetica","normal");p.setTextColor(110,110,120);p.text(`${number} | Page ${i} of ${p.getNumberOfPages()}`,15,289);}if(draft){p.setTextColor(229,45,59);p.setFontSize(10);p.text("DRAFT - AWAITING MANAGEMENT APPROVAL",105,i===1?282:280,{align:"center"});}}
 return Buffer.from(p.output("arraybuffer"));
}
