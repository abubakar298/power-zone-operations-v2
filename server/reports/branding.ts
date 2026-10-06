import type { jsPDF } from "jspdf";
import { logo, footer } from "./brand-assets.js";

export const reportBottomMargin = 32;
export function drawReportLogo(pdf: jsPDF) {
  pdf.addImage(logo, "PNG", 14, 9, 38, 38 * 2384 / 3786, "power-zone-logo");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(90, 90, 100);
  pdf.text("Security Level: Confidential", 196, 12, { align: "right" });
}
export function drawReportFooter(pdf: jsPDF, reference: string) {
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(110, 110, 120);
    pdf.text(reference, 14, 269);
    pdf.text(`Page ${page} of ${pages}`, 196, 269, { align: "right" });
    pdf.addImage(footer, "PNG", 10, 275, 190, 190 * 218 / 2054, "power-zone-footer");
  }
}
