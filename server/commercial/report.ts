import { drawReportLogo, drawReportFooter, reportBottomMargin } from "../reports/branding.js";
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
export function buildQuotationPdf(s: QuotationSnapshot, number?: string) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true }),
    margin = 14;
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

  pdf.setTextColor(40, 40, 45);
  pdf.setFontSize(12);
  pdf.text("DRAFT QUOTATION - NOT SAVED", margin, 37);
  pdf.setFontSize(9);
  pdf.text("POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED", margin, 42);
  autoTable(pdf, {
    startY: 46,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 0.6, textColor: [40, 40, 45] },
    columnStyles: { 0: { cellWidth: 102 }, 1: { cellWidth: 80 } },
    body: [
      [text(`Customer: ${s.customer.name}`), text(`Quoted date: ${s.input.quotedDate}`)],
      [text(`Contact person: ${s.customer.contactPerson ?? ""}`), text(`Proposed by: ${s.input.proposedBy}`)],
      [text(`Contact number: ${s.customer.phone ?? ""}`), text(`Validity: ${s.input.validity}`)],
      [text(`Site: ${s.siteName} (${s.siteCode})`), text(`Solution ID: ${s.solutionId}`)],
      [text(`BOQ: ${s.boqNumber}`), text(`Quotation No.: ${number ?? "DRAFT"}`)],
    ],
  });
  let y = (pdf as any).lastAutoTable.finalY + 4;
  pdf.text(text(s.subject), margin, y);
  y += 5;
  const amounts = s.presentation === "Basic Breakup";
  const body = s.lines.map((r, i) => {
    const cells: any[] = [
      String(i + 1),
      text(r.description),
      r.unit,
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
      fontSize: 7.5,
      cellPadding: 1,
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
      ...(amounts ? { 4: { cellWidth: 22, halign: "right", valign: "middle" } } : {}),
    },
    rowPageBreak: "avoid",
  });
  y = (pdf as any).lastAutoTable.finalY + 3;
  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin, bottom: reportBottomMargin },
    theme: "plain",
    pageBreak: "avoid",
    body: s.footer.map((r) => [r.label, money(r.amount)]),
    styles: { fontSize: 8, cellPadding: 1 },
    columnStyles: { 0: { cellWidth: 135 }, 1: { halign: "right" } },
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
    styles: { fontSize: 7.5, cellPadding: 0.7, overflow: "linebreak" },
    rowPageBreak: "avoid",
  });
  drawReportFooter(pdf, text(number ?? "Draft quotation"));
  return Buffer.from(pdf.output("arraybuffer"));
}
