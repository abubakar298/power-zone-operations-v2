import {CASH_PROFIT_NOTE, retainedGst} from "../commercial/deal.js";
import {Decimal} from "decimal.js";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { drawReportLogo, drawReportFooter, reportBottomMargin } from "../reports/branding.js";
import { quotationTypeLabel } from "./sale-type.js";
import type { peachtreeDivision } from "./peachtree.js";
import {ptDisplayRows} from './pt-detail.js';
const money = (s: string) =>
  Number(s).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const text = (v: unknown) =>
  String(v ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, "");
export function appendPeachtreePage(
  pdf: jsPDF,
  s: any,
  d: ReturnType<typeof peachtreeDivision>,
  number: string,
) {
  pdf.addPage();
  drawReportLogo(pdf);
  pdf.setFontSize(12);
  pdf.text("PEACHTREE DIVISION", 14, 38);
  pdf.setFontSize(9);
  pdf.text("POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED", 14, 44);
  autoTable(pdf, {
    startY: 50,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    body: [
      ["IPO", number],
      ["Quotation", text(s.quotationNumber)],
      ["BOQ", text(s.boqNumber)],
      ["Customer", text(s.customer.name)],
      ["Entry basis", d.basis],
      ["Quotation type", text(quotationTypeLabel(d))],
    ],
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 7,
    theme: "grid",
    headStyles: { fillColor: [61, 63, 146] },
    footStyles: { fillColor: [61, 63, 146] },
    margin:{left:14,right:14,bottom:reportBottomMargin},
    styles: { fontSize: 8, cellPadding: 2.3 },
    columnStyles: {0:{cellWidth:26},1:{cellWidth:37},2:{cellWidth:81},3:{halign:"right",cellWidth:38}},
    head: [["PT phase", "Item ID", "Description / quantity", d.saleType === "Cash Deal" ? "Selling value (PKR)" : "Selling excl. GST (PKR)"]],
    body: ptDisplayRows(d).map((p:any)=>[p.name,text(p.itemId||'Not allocated'),text(p.description || "Description not recorded"),money(p.amount)]),
    foot: [["PHASE TOTAL","","", {content:money(d.phaseTotal),styles:{halign:"right"}}]],
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 6,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 1: { halign: "right" } },
    body:
      d.version >= 2 && d.taxMode === "Tax Included"
        ? [["IPO payable", money(d.ipoPayable)]]
        : [
            ["IPO total before tax", money(d.ipoBeforeTax)],
            ["IPO tax (separate reconciliation)", money(d.ipoTax)],
            ["IPO payable", money(d.ipoPayable)],
          ],
  });
  const policy = d.policy === "fixed-bank-ups-proportional-cost" ? "Approved UPS selling value excluding GST is allocated proportionally to the frozen component and installation costs. Accepted payable and GST remain unchanged." : "EPC excludes the separately shown Earthing, Electrical Labour and Deliveries. Allocation uses saved BOQ category costs; accepted totals and GST remain unchanged.";
  pdf.setFontSize(8);
  pdf.setFont('helvetica','normal');
  pdf.text(
    pdf.splitTextToSize(
      text(
        `${policy} ${retainedGst(d)?CASH_PROFIT_NOTE:"GST is excluded from profit."}`,
      ),
      180,
    ),
    14,
    (pdf as any).lastAutoTable.finalY + 5,
  );
}
export function buildPeachtreePdf(
  s: any,
  d: ReturnType<typeof peachtreeDivision>,
  number: string,
) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.setProperties({
    title: `${number} - Peachtree Division`,
    author: "Power Zone Engineering & Services",
  });
  appendPeachtreePage(pdf, s, d, number);
  pdf.deletePage(1);
  drawReportFooter(pdf, `${number} / Peachtree Division`);
  return Buffer.from(pdf.output("arraybuffer"));
}
