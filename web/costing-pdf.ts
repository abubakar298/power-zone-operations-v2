import type { BoqSnapshot } from "../server/boq/engine.js";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

const money = (v: string | number, d = 0) =>
  new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(Number(v));
// Standard PDF fonts cover Latin-1; normalise engineering glyphs explicitly.
const label = (v: string) =>
  v
    .replaceAll("×", "x")
    .replace(/[–—]/g, "-")
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, "");

export function buildCostingPdf(
  s: BoqSnapshot,
  number?: string,
  createdAt?: string,
) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const width = pdf.internal.pageSize.getWidth(),
    margin = 14;
  const title = number || "Costing preview";
  pdf.setProperties({
    title: `${title} - ${s.survey.siteName}`,
    author: "Power Zone Engineering & Services",
    subject: "Internal project costing",
  });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  pdf.setTextColor(57, 50, 83);
  pdf.text("POWER ZONE", margin, 21);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.text("ENGINEERING & SERVICES | INTERNAL PROJECT COSTING", margin, 28);
  pdf.setTextColor(35, 35, 40);
  pdf.setFontSize(13);
  pdf.setFont("helvetica", "bold");
  pdf.text(label(title), margin, 40);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  const metadata = [
    `Customer: ${s.customer.name}`,
    `Site: ${s.survey.siteName} | Code: ${s.survey.siteCode} | Location: ${s.survey.location}`,
    `PV: ${money(s.engineering.pvKwp, 3)} kWp | Inverter: ${s.survey.inverter} | Battery: ${s.survey.batteryKwh} kWh`,
    `Prepared by: ${s.survey.preparedBy}${createdAt ? " | Saved: " + new Date(createdAt).toISOString().slice(0, 10) : ""}`,
    number
      ? "Saved R0 costing. This report uses the preserved snapshot."
      : "DRAFT PREVIEW - No BOQ number has been issued.",
  ];
  let y = 47;
  for (const line of metadata) {
    const lines = pdf.splitTextToSize(label(line), width - margin * 2);
    pdf.text(lines, margin, y);
    y += lines.length * 4.5 + 1;
  }
  const section = (
    heading: string,
    head: string[],
    body: string[][],
    detail = false,
  ) => {
    if (y > 245) {
      pdf.addPage();
      y = 20;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text(heading, margin, y);
    y += 5;
    autoTable(pdf, {
      startY: y,
      margin: { left: margin, right: margin, top: 18, bottom: 18 },
      head: [head],
      body,
      theme: "striped",
      styles: {
        font: "helvetica",
        fontSize: detail ? 8 : 9,
        cellPadding: 2.5,
        overflow: "linebreak",
        lineColor: [231, 231, 239],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [57, 50, 83],
        textColor: 255,
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [247, 246, 251] },
      columnStyles: detail
        ? {
            0: { cellWidth: 32 },
            1: { cellWidth: 21 },
            2: { cellWidth: 52 },
            3: { cellWidth: 16, halign: "right" },
            4: { cellWidth: 13 },
            5: { cellWidth: 22, halign: "right" },
            6: { cellWidth: 26, halign: "right" },
          }
        : { 1: { halign: "right" }, 2: { halign: "right" } },
      rowPageBreak: "avoid",
      showHead: "everyPage",
      didParseCell: (data) => {
        if (
          !detail &&
          data.section === "body" &&
          Array.isArray(data.row.raw) &&
          data.row.raw[0] === "TOTAL PROJECT COST"
        ) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [237, 234, 250];
        }
      },
    });
    y =
      (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 12;
  };
  section(
    "Project Costing Summary",
    ["Item", "Budgeted Cost (PKR)", "Cost/W"],
    [
      ...s.summary.map((x) => [x.name, money(x.cost), money(x.perWatt, 2)]),
      ["TOTAL PROJECT COST", money(s.total), money(s.perWatt, 2)],
    ],
  );
  section(
    "EPC Costing Breakup",
    ["Item", "Budgeted Cost (PKR)", "Cost/W"],
    s.epc.map((x) => [x.name, money(x.cost), money(x.perWatt, 2)]),
  );
  if (s.warnings.length)
    section(
      "Rate review notices",
      ["Review note"],
      s.warnings.map((w) => [label(w)]),
    );
  // Details start on a fresh page so executives see the two summaries first.
  pdf.addPage();
  y = 20;
  section(
    "Project Costing Detailed Breakup",
    [
      "Item / Description",
      "Brand",
      "Detailed Specification",
      "Qty",
      "UOM",
      "Unit Rate (PKR)",
      "Total Cost (PKR)",
    ],
    s.lines.map((l) => [
      label(l.description),
      label([l.brand || "-", ...l.brandAlternatives].join("\n")),
      label(l.specification || "-"),
      money(l.qty, Number(l.qty) % 1 ? 2 : 0),
      label(l.unit),
      money(l.rate, Number(l.rate) % 1 ? 4 : 0),
      money(l.total),
    ]),
    true,
  );
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(110, 110, 120);
    pdf.text(
      label(`${title} | ${s.survey.siteCode} | Internal costing`),
      margin,
      287,
    );
    pdf.text(`Page ${page} of ${pages}`, width - margin, 287, {
      align: "right",
    });
  }
  return pdf;
}
export async function downloadCostingPdf(
  s: BoqSnapshot,
  number?: string,
  createdAt?: string,
) {
  const filename =
    `${number || "PREVIEW-" + s.survey.siteCode}-costing.pdf`.replace(
      /[^a-zA-Z0-9._-]/g,
      "-",
    );
  buildCostingPdf(s, number, createdAt).save(filename);
}
