import { displayUnit } from "../boq/unit.js";
import { appendPeachtreePage } from "./peachtree-report-v4.js";
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
export function buildIpoPdf(s: any, number?: string, division = s.peachtree, options:{includePt?:boolean}={}) {
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
  const taxDeal=s.quotationType?.saleType !== "Cash Deal";
  const entries = [
    ["IPO / Job reference",number ?? "DRAFT","Quotation reference",s.quotationNumber || "Not available"],
    ["Company to invoice",i.invoiceCompany,"Tax deal",taxDeal?"Yes":"No"],
    ["Prepared by","Atif","Checked by","Atif"],
    ["Customer",s.customer.name,"Site / branch",`${s.siteName ?? "Not entered"} / ${s.siteCode ?? "Not entered"}`],
    ["Customer PO / approval",i.poNumber || i.evidenceNotes || "Not entered","PO / approval date",i.orderDate],
    ...(taxDeal?[["Customer NTN",i.customerNtn || "Not entered","Customer STRN",i.customerStrn || "Not entered"]]:[]),
    ["Billing address",i.billingAddress || "Not entered","Customer contact",`${i.contactPerson || s.customer.contactPerson || "Not entered"} / ${i.phone || s.customer.phone || "Not entered"}`],
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
    head: [["Description", "Qty", "Unit", view.included ? "Rate" : "Rate excl. GST", view.included ? "Amount" : "Amount excl. GST"]],
    columnStyles: {0:{cellWidth:100},1:{halign:"center",cellWidth:10},2:{halign:"center",cellWidth:12},3:{halign:"right"},4:{halign:"right"}},
    body:view.rows.map(l=>[clean(l.description)+(/solar|panel/i.test(l.description)?' - Revise at IRR stage.':''),l.qty,displayUnit(l.unit,l.qty),money(l.rate),money(l.amount)]),
  });
  autoTable(pdf, {
    startY: (pdf as any).lastAutoTable.finalY + 3,
    theme: "plain",
    margin: { left: 14, right: 14, bottom: reportBottomMargin },
    styles: { fontSize: 8, cellPadding: 1.2 },
    body: [
      ...(!view.included
        ? [
            ["Grand total before tax", {content:money(view.amount),styles:{halign:"right" as const}}],
            ...view.taxSummary.filter(tax=>s.allocation.policy!=="fixed-bank-ups"||Number(tax.amount)!==0).map((tax)=>[tax.label,{content:money(tax.amount),styles:{halign:"right" as const}}]),
          ]
        : []),
      ["GRAND TOTAL (PKR)", {content:money(s.allocation.total),styles:{halign:"right",fontStyle:"bold"}}],
      ...(i.paymentMode ? [["Payment mode", clean(i.paymentMode)]] : []),
      ...(i.salesSource ? [["Sales source", clean(i.salesSource)]] : []),
      ...(i.remarks ? [["Remarks", clean(i.remarks)]] : []),
      ...(view.rows.some(r=>/solar|panel/i.test(r.description)) ? [["Panel wattage", "To be confirmed from IRR."]] : []),
    ],
  });
  if (division && options.includePt!==false) appendPeachtreePage(pdf, s, division, number ?? "DRAFT IPO");
  drawReportFooter(
    pdf,
    number
      ? `${number} / IPO & Peachtree Division`
      : "DRAFT IPO & Peachtree Division",
  );
  return Buffer.from(pdf.output("arraybuffer"));
}
