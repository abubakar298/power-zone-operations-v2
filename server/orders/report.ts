import { appendPeachtreePage } from "./peachtree-report.js";
import { quotationTypeLabel } from "./sale-type.js";
import { ipoPresentation } from "./presentation.js";
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
export function buildIpoPdf(s: any, number?: string, division = s.peachtree) {
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
  const view = ipoPresentation({
    ...s,
    quotationType: division ?? s.quotationType,
  });
  const entries =
    i.entryVersion === 2
      ? [
          [
            "IPO reference",
            number ?? "DRAFT",
            "Quotation reference",
            s.quotationNumber,
          ],
          [
            "Company to invoice",
            i.invoiceCompany,
            "Customer / BOQ",
            `${s.customer.name} / ${s.boqNumber}`,
          ],
          [
            "Sale confirmation",
            i.evidenceType,
            "Customer PO",
            i.poNumber || "N/A",
          ],
          ["Order date", i.orderDate, "Sales person", i.salesPerson],
          [
            "Customer contact",
            `${i.contactPerson || s.customer.name} / ${i.phone || "N/A"}`,
            "Email",
            i.email || "N/A",
          ],
          [
            "Billing address",
            i.billingAddress || "N/A",
            "Payment contact",
            `${i.paymentContact || s.customer.name} / ${i.paymentPhone || "N/A"}`,
          ],
          ...(i.evidenceType === "Customer PO" && s.document
            ? [["NTN", i.customerNtn || "N/A", "STRN", i.customerStrn || "N/A"]]
            : []),
          [
            "Evidence details",
            i.evidenceNotes,
            "Checked by",
            s.checkedBy ?? "Pending review",
          ],
        ]
      : [
          [
            "IPO reference",
            number ?? "DRAFT",
            "Quotation reference",
            s.quotationNumber,
          ],
          ["Company to invoice", i.invoiceCompany, "Customer PO", i.poNumber],
          [
            "Sale confirmation",
            i.evidenceType,
            "Evidence details",
            i.evidenceNotes,
          ],
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
    body: [
      ...entries,
      ["Quotation type", quotationTypeLabel(division ?? s), "", ""],
    ].map((row) => row.map(clean)),
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 4,
    theme: "grid",
    margin: { left: 14, right: 14, bottom: reportBottomMargin },
    styles: { fontSize: 7, cellPadding: 1.3 },
    headStyles: { fillColor: [61, 63, 146], fontSize: 7 },
    head: [
      view.included
        ? ["Description", "Qty", "Unit", "Rate", "Amount"]
        : [
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
    columnStyles: view.included
      ? {
          0: { cellWidth: 100 },
          1: { halign: "center", cellWidth: 10 },
          2: { halign: "center", cellWidth: 10 },
          3: { halign: "right" },
          4: { halign: "right" },
        }
      : {
          0: { cellWidth: 66 },
          1: { halign: "center", cellWidth: 10 },
          2: { halign: "center", cellWidth: 10 },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "center", cellWidth: 9 },
          6: { halign: "right" },
          7: { halign: "right" },
        },
    body: view.rows.map((l) =>
      view.included
        ? [clean(l.description), l.qty, l.unit, money(l.rate), money(l.amount)]
        : [
            clean(l.description),
            l.qty,
            l.unit,
            money(l.rate),
            money(l.amount),
            l.taxRate,
            money(l.tax),
            money(l.total),
          ],
    ),
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 3,
    theme: "plain",
    margin: { left: 14, right: 14, bottom: reportBottomMargin },
    styles: { fontSize: 8, cellPadding: 1.2 },
    body: [
      ...(!view.included
        ? [
            ["Grand total before tax", money(view.amount)],
            ["Total tax", money(view.tax)],
          ]
        : []),
      ["GRAND TOTAL (PKR)", money(s.allocation.total)],
      ...(i.paymentMode ? [["Payment mode", clean(i.paymentMode)]] : []),
      ...(i.salesSource ? [["Sales source", clean(i.salesSource)]] : []),
      ...(i.remarks ? [["Remarks", clean(i.remarks)]] : []),
    ],
  });
  if (division) appendPeachtreePage(pdf, s, division, number ?? "DRAFT IPO");
  drawReportFooter(
    pdf,
    number
      ? `${number} / IPO & Peachtree Division`
      : "DRAFT IPO & Peachtree Division",
  );
  return Buffer.from(pdf.output("arraybuffer"));
}
