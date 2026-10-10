import {orderCustomerScopeLines} from './customer-scope.js';
import { quotationDisplayRows } from "./quotation-rows.js";
import { displayUnit } from "../boq/unit.js";
import {
  drawReportLogo,
  drawReportFooter,
  reportBottomMargin,
} from "../reports/branding.js";
import { Decimal } from "decimal.js";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { QuotationSnapshot } from "./engine.js";
const text = (v: string) =>
  v
    .replaceAll("×", "x")
    .replace(/[–—]/g, "-")
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, "");
const money = (v: string) =>
  new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
function appendQuotation(
  pdf: jsPDF,
  s: QuotationSnapshot,
  number?: string,
  label?: string,
) {
  // Promotional presentation only. The immutable net/tax basis remains unchanged for review and IPO/PT.
  if(s.standardDiscountStrategy){
    const D=Decimal;
    const included=s.footer.some(r=>r.label==="Total");
    const groups=s.standardDiscountStrategy.groups.map(g=>({...g,amount:new D(g.beforeTax).mul(included?new D(g.taxRate).div(100).add(1):1).toDecimalPlaces(2,Decimal.ROUND_HALF_UP)}));
    const allowance=groups.reduce((sum,g)=>sum.add(g.amount),new D(0));
    const lines=s.lines.map(l=>({...l}));
    for(const group of groups){
      const members=lines.filter(l=>l.group===group.group&&l.amount!==undefined);
      if(members.some(l=>l.standardAllowanceBeforeTax!==undefined)){
        let assigned=new D(0);
        members.forEach((row,index)=>{const extra=index===members.length-1?group.amount.sub(assigned):new D(row.standardAllowanceBeforeTax??"0").mul(included?new D(group.taxRate).div(100).add(1):1).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);assigned=assigned.add(extra);row.amount=new D(row.amount!).add(extra).toFixed(2);});
      }else if(members[0])members[0].amount=new D(members[0].amount!).add(group.amount).toFixed(2);
    }
    const footer=s.footer.map(r=>({...r}));
    const total=footer.find(r=>r.label===(included?"Total":"Subtotal Before Tax"));
    if(total)total.amount=new D(total.amount).add(allowance).toFixed(2);
    const index=footer.findIndex(r=>r.label==="Special Discount");
    footer.splice(included?index:1,0,{label:"Management-approved discount",amount:allowance.toFixed(2)});
    s={...s,lines,footer};
  }
  const margin = 14;
  pdf.setProperties({
    title: number ?? "Quotation preview",
    author: "Power Zone Engineering & Services (Pvt) Limited",
    subject: s.subject,
  });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(17);
  pdf.setTextColor(57, 50, 83);
  drawReportLogo(pdf);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  if (label) {
    pdf.setFontSize(7);
    pdf.text(text(label), 196, 20, { align: "right" });
  }

  pdf.setTextColor(40, 40, 45);
  pdf.setFontSize(12);
  pdf.text(number ? "QUOTATION" : "DRAFT QUOTATION - NOT SAVED", margin, 37);
  pdf.setFontSize(9);
  pdf.text("POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED", margin, 42);
  autoTable(pdf, {
    startY: 46,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 0.6, textColor: [40, 40, 45] },
    columnStyles: { 0: { cellWidth: 102 }, 1: { cellWidth: 80 } },
    body: [
      [
        text(`Customer: ${s.customer.name}`),
        text(`Quoted date: ${s.input.quotedDate}`),
      ],
      [
        text(`Contact person: ${s.customer.contactPerson ?? ""}`),
        text(`Proposed by: ${s.input.proposedBy}`),
      ],
      [
        text(`Contact number: ${s.customer.phone ?? ""}`),
        text(`Validity: ${s.input.validity}`),
      ],
      [
        text(`Site: ${s.siteName} (${s.siteCode})`),
        text(`Solution ID: ${s.solutionId}`),
      ],
      [
        text(`BOQ: ${s.boqNumber}`),
        text(`Quotation No.: ${number ?? "DRAFT"}`),
      ],
    ],
  });
  let y = (pdf as any).lastAutoTable.finalY + 4;
  pdf.text(text(s.subject), margin, y);
  y += 5;
  const amounts = s.presentation !== "No Breakup";
  const body = quotationDisplayRows("customerScopeVersion" in s && s.customerScopeVersion === 1 ? orderCustomerScopeLines(s.lines, s.presentation) : s.lines).map((r, i) => {
    const cells: any[] = [
      String(i + 1),
      text(r.description),
      displayUnit(r.unit,r.qty),
      new Intl.NumberFormat("en-PK", { maximumFractionDigits: 4 }).format(
        Number(r.qty),
      ),
    ];
    if (amounts && r.amount)
      cells.push({ content: money(r.amount), rowSpan: r.span });
    return cells;
  });
  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin, bottom: reportBottomMargin },
    head: [
      [
        "No.",
        "Product / Service Description",
        "UOM",
        "Qty",
        ...(amounts ? ["Amount (PKR)"] : []),
      ],
    ],
    body,
    theme: "grid",
    styles: {
      fontSize: 7,
      cellPadding: 0.5,
      overflow: "linebreak",
      lineColor: [230, 230, 238],
      lineWidth: 0.2,
    },
    headStyles: { fillColor: [65, 54, 104] },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: amounts ? 129 : 151 },
      2: { cellWidth: 14 },
      3: { cellWidth: 10, halign: "center" },
      ...(amounts
        ? { 4: { cellWidth: 22, halign: "right", valign: "middle" } }
        : {}),
    },
    rowPageBreak: "avoid",
  });
  y = (pdf as any).lastAutoTable.finalY + 3;
  autoTable(pdf, {
    startY: y,
    margin: { left: 96, right: margin, bottom: reportBottomMargin },
    theme: "plain",
    pageBreak: "avoid",
    tableWidth: 100,
    body: s.footer.map((r) => [r.label, money(r.amount)]),
    styles: { fontSize: 8, cellPadding: 1 },
    columnStyles: {
      0: { cellWidth: 78, halign: "right" },
      1: { cellWidth: 22, halign: "right" },
    },
    didParseCell(data) {
      if (data.row.index === s.footer.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [239, 236, 249];
      }
    },
  });
  y = (pdf as any).lastAutoTable.finalY + 3;
  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin, bottom: reportBottomMargin },
    theme: "plain",
    body: [
      [{ content: "NOTES", styles: { fontStyle: "bold" } }],
      ...s.notes.map((r, i) => [text(`${i + 1}. ${r}`)]),
      [{ content: "TERMS AND CONDITIONS", styles: { fontStyle: "bold" } }],
      ...s.terms.map((r, i) => [text(`${i + 1}. ${r}`)]),
    ],
    styles: { fontSize: 7, cellPadding: 0.3, overflow: "linebreak" },
    rowPageBreak: "avoid",
  });
}
export function buildQuotationPdf(s: QuotationSnapshot, number?: string) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  appendQuotation(pdf, s, number);
  drawReportFooter(pdf, text(number ?? "Draft quotation"));
  return Buffer.from(pdf.output("arraybuffer"));
}
export function buildQuotationComparisonPdf(
  variants: { snapshot: QuotationSnapshot; label: string }[],
  sourceNumber: string,
) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  variants.forEach((v, i) => {
    if (i) pdf.addPage();
    appendQuotation(
      pdf,
      v.snapshot,
      sourceNumber,
      `REVIEW PREVIEW ${i + 1}/6 - ${v.label}`,
    );
  });
  pdf.setProperties({
    title: `${sourceNumber} - six quotation formats`,
    subject: "Comparison previews only; saved quotation unchanged.",
  });
  drawReportFooter(pdf, text(`${sourceNumber} - format review only`));
  return Buffer.from(pdf.output("arraybuffer"));
}
