import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { drawReportLogo, drawReportFooter } from "../reports/branding.js";
import { quotationTypeLabel } from "./sale-type.js";
import type { peachtreeDivision } from "./peachtree.js";
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
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 1: { halign: "right" } },
    head: [["Peachtree job-ledger phase", "Selling value (PKR)"]],
    body: d.phases.map((p) => [p.name, money(p.amount)]),
    foot: [["PHASE TOTAL", money(d.phaseTotal)]],
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 6,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    body:
      d.version >= 2 && d.taxMode === "Tax Included"
        ? [["IPO payable", money(d.ipoPayable)]]
        : [
            ["IPO total before tax", money(d.ipoBeforeTax)],
            ["IPO tax (separate reconciliation)", money(d.ipoTax)],
            ["IPO payable", money(d.ipoPayable)],
          ],
  });
  const policy =
    d.version >= 2
      ? "Phase entries retain the original accepted quotation selling values and margins after allocating the approved discount to eligible 18% items. Solar remains unchanged; no margin redistribution is applied."
      : d.presentation === "No Breakup"
        ? "Solar is allocated at cost x 1.10, or cost x 1.21 for the tax-inclusive phase division. The remaining value is allocated across other phases in proportion to approved phase costs."
        : d.presentation === "Basic Breakup"
          ? `BESS and Balance/EPC selling values are pooled and redistributed using their combined effective before-tax markup (${d.effectivePooledMarkup}%). Separately priced Solar, Structure and Earthing retain their net accepted values.`
          : "Phase entries retain the accepted item selling values after discount allocation.";
  pdf.setFontSize(8);
  pdf.text(
    pdf.splitTextToSize(
      text(
        `${policy} EPC contains all items outside Solar, Structure, Inverter, Batteries and BMS. This internal phase division does not alter the accepted quotation, IPO payable or tax treatment. Taxes are not classified as accounting profit.`,
      ),
      180,
    ),
    14,
    (pdf as any).lastAutoTable.finalY + 8,
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
