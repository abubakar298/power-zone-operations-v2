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
  const pdf = new jsPDF({ unit: "mm", format: "a4" }),
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
  pdf.text("ENGINEERING & SERVICES (PVT) LIMITED", 60, 22);
  pdf.setTextColor(40, 40, 45);
  pdf.setFontSize(12);
  pdf.text(number ?? "DRAFT QUOTATION - NOT SAVED", margin, 39);
  pdf.setFontSize(9);
  autoTable(pdf, {
    startY: 45,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1, textColor: [40, 40, 45] },
    body: [
      [text(`Customer: ${s.customer.name}`)],
      [text(`Contact person: ${s.customer.contactPerson ?? ""}`)],
      [text(`Contact number: ${s.customer.phone ?? ""}`)],
      [text(`Site: ${s.siteName} (${s.siteCode})`)],
      [text(`BOQ: ${s.boqNumber} | Solution ID: ${s.solutionId}`)],
      [text(`Quoted date: ${s.input.quotedDate}`)],
      [text(`Proposed by: ${s.input.proposedBy}`)],
      [text(`Validity: ${s.input.validity}`)],
    ],
  });
  let y = (pdf as any).lastAutoTable.finalY + 6;
  pdf.text(text(s.subject), margin, y);
  y += 8;
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
      fontSize: 8,
      cellPadding: 3,
      overflow: "linebreak",
      lineColor: [230, 230, 238],
      lineWidth: 0.2,
    },
    headStyles: { fillColor: [65, 54, 104] },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: amounts ? 109 : 131 },
      2: { cellWidth: 14 },
      3: { cellWidth: 25, halign: "right" },
      ...(amounts ? { 4: { cellWidth: 22, halign: "right", valign: "middle" } } : {}),
    },
    rowPageBreak: "avoid",
  });
  y = (pdf as any).lastAutoTable.finalY + 7;
  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin, bottom: reportBottomMargin },
    theme: "plain",
    pageBreak: "avoid",
    body: s.footer.map((r) => [r.label, money(r.amount)]),
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 135 }, 1: { halign: "right" } },
    didParseCell(data) {
      if (data.row.index === s.footer.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [239, 236, 249];
      }
    },
  });
  y = (pdf as any).lastAutoTable.finalY + 7;
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
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    rowPageBreak: "avoid",
  });
  drawReportFooter(pdf, text(number ?? "Draft quotation"));
  return Buffer.from(pdf.output("arraybuffer"));
}
