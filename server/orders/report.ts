import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import {
  drawReportLogo,
  drawReportFooter,
  reportBottomMargin,
} from "../reports/branding.js";
const clean = (s: unknown) =>
  String(s ?? "")
    .replaceAll("×", "x")
    .replace(/[–—]/g, "-")
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, "");
const money = (s: string) =>
  Number(s).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function buildIpoPdf(s: any, number?: string) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.setProperties({
    title: number ?? "Draft IPO",
    author: "Power Zone Engineering & Services",
  });
  drawReportLogo(pdf);
  pdf.setFontSize(12);
  pdf.text(
    number ? "INTERNAL PURCHASE ORDER" : "DRAFT INTERNAL PURCHASE ORDER",
    14,
    37,
  );
  pdf.setFontSize(8);
  pdf.text("POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED", 14, 42);
  const i = s.input;
  const entries = [
    [
      "IPO reference",
      number ?? "DRAFT",
      "Quotation reference",
      s.quotationNumber,
    ],
    ["Company to invoice", i.invoiceCompany, "Customer PO", i.poNumber],
    ["Sale confirmation", i.evidenceType, "Evidence details", i.evidenceNotes],
    ["Customer", s.customer.name, "BOQ", s.boqNumber],
    [
      "Sales person",
      i.salesPerson,
      "Checked by",
      s.checkedBy ?? "Pending review",
    ],
    ["NTN", i.customerNtn, "STRN", i.customerStrn],
    [
      "Contact / designation",
      `${i.contactPerson} / ${i.designation}`,
      "Phone / email",
      `${i.phone} / ${i.email}`,
    ],
    [
      "Billing address",
      i.billingAddress,
      "Delivery address",
      i.deliveryAddress,
    ],
    [
      "Site contact",
      `${i.siteContact} / ${i.sitePhone}`,
      "Payment contact",
      `${i.paymentContact} / ${i.paymentPhone}`,
    ],
    [
      "Order date",
      i.orderDate,
      "Delivery date / time",
      `${i.deliveryDate} / ${i.deliveryTime}`,
    ],
  ];
  autoTable(pdf, {
    startY: 46,
    theme: "grid",
    margin: { left: 14, right: 14, bottom: reportBottomMargin },
    styles: { fontSize: 7, cellPadding: 1.4 },
    columnStyles: {
      0: { cellWidth: 27 },
      1: { cellWidth: 64 },
      2: { cellWidth: 27 },
      3: { cellWidth: 64 },
    },
    body: entries.map((row) => row.map(clean)),
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 4,
    theme: "grid",
    margin: { left: 14, right: 14, bottom: reportBottomMargin },
    styles: { fontSize: 7, cellPadding: 1.3 },
    headStyles: { fillColor: [61, 63, 146], fontSize: 7 },
    head: [
      [
        "Description",
        "Qty",
        "Unit",
        "Net rate",
        "Amount",
        "Tax %",
        "Tax",
        "Total",
      ],
    ],
    columnStyles: {
      0: { cellWidth: 66 },
      1: { halign: "center", cellWidth: 10 },
      2: { halign: "center", cellWidth: 10 },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "center", cellWidth: 9 },
      6: { halign: "right" },
      7: { halign: "right" },
    },
    body: s.allocation.lines
      .filter((l: any) => Number(l.qty) > 0 || Number(l.total) > 0)
      .map((l: any) => [
        clean(l.description),
        l.qty,
        l.unit,
        Number(l.rate).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
        money(l.beforeTax),
        l.taxRate,
        money(l.tax),
        money(l.total),
      ]),
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 3,
    theme: "plain",
    margin: { left: 14, right: 14, bottom: reportBottomMargin },
    styles: { fontSize: 8, cellPadding: 1.2 },
    body: [
      ["Grand total before tax", money(s.allocation.subtotal)],
      ["Total tax", money(s.allocation.tax)],
      ["GRAND TOTAL (PKR)", money(s.allocation.total)],
      ...(i.paymentMode ? [["Payment mode", clean(i.paymentMode)]] : []),
      ...(i.salesSource ? [["Sales source", clean(i.salesSource)]] : []),
      ...(i.remarks ? [["Remarks", clean(i.remarks)]] : []),
    ],
  });
  drawReportFooter(pdf, number ?? "DRAFT IPO");
  return Buffer.from(pdf.output("arraybuffer"));
}
