import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import {
  drawReportLogo,
  drawReportFooter,
  reportBottomMargin,
} from "../reports/branding.js";
const clean = (v: unknown) =>
  String(v ?? "")
    .replaceAll("²", "2")
    .replaceAll("×", "x")
    .replace(/[–—]/g, "-")
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, "");
export function buildOperationsPdf(row: any) {
  const s = row.snapshot,
    pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  drawReportLogo(pdf);
  pdf.setFontSize(12);
  pdf.text(
    s.destination === "Store"
      ? "BOQ ISSUANCE TO STORE"
      : "BOQ ISSUANCE TO OPERATIONS",
    14,
    38,
  );
  pdf.setFontSize(8);
  pdf.text("POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED", 14, 44);
  autoTable(pdf, {
    startY: 50,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2 },
    body: [
      ["Issuance", row.number, "IPO", s.ipoNumber],
      ["Customer", clean(s.customer.name), "Quotation", s.quotationNumber],
      [
        "Site",
        clean(`${s.siteName} / ${s.siteCode}`),
        "Approved BOQ",
        s.boqNumber,
      ],
      [
        "Customer contact",
        clean(`${s.contactPerson} / ${s.phone}`),
        "Site contact",
        clean(`${s.siteContact} / ${s.sitePhone}`),
      ],
      [
        "Delivery address",
        clean(s.deliveryAddress),
        "Customer PO",
        clean(s.customerPo),
      ],
      ...(s.destination === "Store"
        ? [
            [
              "Delivery date / time",
              clean(
                `${s.deliveryDate} / ${s.deliveryTime || "To be arranged"}`,
              ),
              "Operations reference",
              s.operationsIssuanceNumber,
            ],
          ]
        : []),
      [
        "Issued by",
        clean(s.issuedBy),
        "Issued on",
        new Date(row.created_at).toLocaleDateString("en-GB", {
          timeZone: "Asia/Karachi",
        }),
      ],
    ],
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 6,
    theme: "grid",
    margin: { bottom: reportBottomMargin },
    headStyles: { fillColor: [61, 63, 146] },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" },
      2: { cellWidth: 15, halign: "center" },
      3: { cellWidth: 15, halign: "center" },
    },
    head: [["No.", "Required item / specification / brand", "Qty", "Unit"]],
    body: s.items.map((l: any, i: number) => [
      String(i + 1),
      clean(
        [
          l.description,
          l.specification || "Specification: Need to enter",
          l.brand === "Any of the Above"
            ? l.brandAlternatives?.join(" / ")
            : l.brand,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      l.qty,
      l.unit,
    ]),
  });
  let y = (pdf as any).lastAutoTable.finalY + 7;
  const note = pdf.splitTextToSize(clean(s.notes), 180);
  if (y + note.length * 4 > 265) {
    pdf.addPage();
    y = 20;
  }
  pdf.setFontSize(8);
  if (s.notes) pdf.text(note, 14, y);
  drawReportFooter(pdf, row.number);
  return Buffer.from(pdf.output("arraybuffer"));
}
