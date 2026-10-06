import { Decimal } from "decimal.js";
import type { BoqSnapshot } from "../boq/engine.js";
import { HttpError } from "../http/errors.js";
import type { PricingInput, QuotationInput } from "./schema.js";
export const NOTES = [
  "Certified that goods supplied under this quotation were imported by us and income tax under section 148 has already been paid on these goods at import stage. Accordingly, the provisions of Section 153(1) of the Income Tax Ordinance, 2001 are not applicable at the time of payment against this invoice.",
  "All Internal Wiring of existing panel will be done by Customer's Authorized Technician.",
];
export const TERMS = [
  "100% payment at the time of order.",
  "Warranty for Solar Inverter and Battery will be 5-Years Replacement Warranty.",
  "Burnout equipment or products are not covered in warranty.",
  "This is only technical proposed document and is not a legal document.",
  "The payment is not refundable.",
];
const D = (v: string) => new Decimal(v),
  money = (v: Decimal) =>
    v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export function price(
  boq: BoqSnapshot,
  boqNumber: string,
  input: PricingInput,
) {
  const summary = (name: string) =>
    D(boq.summary.find((x) => x.name === name)?.cost ?? "0");
  const solar = summary("Solar Panels"),
    structure = summary("Structure"),
    bess = summary("BESS"),
    earthing = D(boq.epc.find((x) => x.name === "Earthing Cost")?.cost ?? "0"),
    cost = D(boq.total),
    balance = cost.minus(solar).minus(structure).minus(bess).minus(earthing);
  if (balance.isNegative())
    throw new HttpError(
      422,
      "The approved costing categories do not reconcile.",
    );
  const rows = (
    [
      ["solar", "Solar Panels", solar],
      ["structure", "Structure", structure],
      ["bess", "BESS", bess],
      ["earthing", "Earthing Bores", earthing],
      ["balance", "Balance / Everything Else", balance],
    ] as const
  ).map(([key, name, base]) => {
    const markup =
      input.presentation === "No Breakup" && key !== "bess"
        ? input.markups.rest
        : input.markups[key];
    const selling = base.mul(D(markup).div(100).add(1)),
      rate = key === "solar" ? "10" : "18";
    return {
      key,
      name,
      cost: base.toString(),
      markup,
      profit: selling.minus(base).toString(),
      beforeTax: selling.toString(),
      taxRate: rate,
      tax: selling.mul(D(rate).div(100)).toString(),
      afterTax: selling.mul(D(rate).div(100).add(1)).toString(),
    };
  });
  const sum = (field: "beforeTax" | "tax" | "profit") =>
    rows.reduce((a, r) => a.add(r[field]), D("0"));
  // Keep exact component math, round the two presented tax buckets once.
  const subtotal = money(sum("beforeTax")),
    solarTax = money(D(rows[0].tax)),
    otherTax = money(rows.slice(1).reduce((a, r) => a.add(r.tax), D("0"))),
    tax = money(D(solarTax).add(otherTax)),
    total = money(D(subtotal).add(tax)),
    discount = money(D(input.discount));
  if (D(discount).gt(total))
    throw new HttpError(
      400,
      "Special discount cannot exceed the quoted total.",
    );
  return {
    engineVersion: 1,
    input,
    boqNumber,
    customer: boq.customer,
    siteName: boq.survey.siteName,
    siteCode: boq.survey.siteCode,
    solutionId: boq.engineering.solutionId,
    cost: cost.toString(),
    rows,
    profit: money(sum("profit")),
    subtotal,
    solarTax,
    otherTax,
    tax,
    total,
    discount,
    netTotal: money(D(total).minus(discount)),
  };
}
export type PricingSnapshot = ReturnType<typeof price>;
export interface QuoteLine {
  description: string;
  unit: string;
  qty: string;
  group: "solar" | "structure" | "bess" | "earthing" | "balance";
  amount?: string;
  span?: number;
}
export function quotationLines(s: BoqSnapshot): QuoteLine[] {
  const brand = (field: string) => {
    const b = s.selectedBrands[field];
    return b.name === "Any of the Above" ? b.alternatives.join(" / ") : b.name;
  };
  const line = (key: string) => s.lines.find((x) => x.key === key),
    qty = (key: string) => line(key)?.qty ?? "0",
    rows: QuoteLine[] = [];
  const add = (
    description: string,
    unit: string,
    quantity: string,
    group: QuoteLine["group"],
  ) => rows.push({ description, unit, qty: quantity, group });
  add(
    `${brand("solar")} ${s.survey.panelWattage} W Solar PV Modules`,
    "No.",
    String(s.survey.panelQty),
    "solar",
  );
  add(
    `${s.survey.structure} Solar Mounting Structure for PV Array`,
    "LS",
    "1",
    "structure",
  );
  add(
    `${brand("inverter")} ${s.inverterConfig.sku.replace("HYB-3P-", "").replace(/^0+/, "")} kW IP66 Three Phase High Voltage Hybrid Inverter with 5-Years Replacement Warranty`,
    "No.",
    String(s.inverterConfig.quantity),
    "bess",
  );
  if (D(s.engineering.batteryModules).gt(0))
    add(
      `${brand("battery")} 5 kWh IP65 High Voltage Lithium Ion ESS Battery Module with 5-Years Replacement Warranty`,
      "No.",
      s.engineering.batteryModules,
      "bess",
    );
  if (D(s.engineering.bms).gt(0))
    add(
      `${brand("battery")} Battery Control Unit for High Voltage Batteries`,
      "No.",
      s.engineering.bms,
      "bess",
    );
  add("Earthing Bore", "No.", qty("Earthing Bore"), "earthing");
  add(
    `6mm² DC Cable Red and Black — ${brand("cable")}`,
    "m",
    s.survey.dcMetres,
    "balance",
  );
  for (const [key, quantity] of [
    ["2.5mm² Earthing Cable", s.survey.earth25],
    ["6mm² Earthing Cable", s.survey.earth6],
    ["10mm² Earthing Cable", s.survey.earth10],
  ])
    if (D(quantity).gt(0))
      add(`${key} — ${brand("cable")}`, "m", quantity, "balance");
  const ac = ["16mm² 4C AC Cable", "25mm² 4C AC Cable"]
    .filter((k) => line(k))
    .map((k) => `${k} (${qty(k)}m)`)
    .join(" & ");
  add(`${ac} — ${brand("cable")}`, "LS", "1", "balance");
  add(
    `DC Protection: DC Breakers, DC SPD and DC Fuse with Holders — ${brand("switchgear")}`,
    "LS",
    "1",
    "balance",
  );
  add(
    `AC Protection & Distribution: MCB/MCCB, Rotary Changeover, AC SPD and AC/DC Protection Boxes — ${brand("switchgear")}`,
    "LS",
    "1",
    "balance",
  );
  add(
    [
      "Miscellaneous Accessories",
      ...(s.survey.smartMeter ? ["Smart Meter"] : []),
      ...(s.survey.genset ? ["Genset Synchronisation with Battery SOC"] : []),
    ].join(", "),
    "LS",
    "1",
    "balance",
  );
  add("Installation, Testing & Commissioning Labour", "LS", "1", "balance");
  add("Project Delivery / Logistics", "LS", "1", "balance");
  return rows;
}
export function quote(
  p: PricingSnapshot,
  boq: BoqSnapshot,
  input: QuotationInput,
) {
  const lines = quotationLines(boq);
  if (input.descriptions && input.descriptions.length !== lines.length)
    throw new HttpError(400, "Provide one description for each quotation row.");
  lines.forEach((l, i) => {
    if (input.descriptions) l.description = input.descriptions[i];
  });
  if (
    p.input.taxMode === "Tax Included" &&
    lines.some((l) => /\bGST\b|sales tax|tax included/i.test(l.description))
  )
    throw new HttpError(
      400,
      "Remove tax wording from customer descriptions for this presentation.",
    );
  const footer =
    p.input.taxMode === "Tax Included"
      ? [{ label: "Total", amount: p.total }]
      : [
          { label: "Subtotal Before Tax", amount: p.subtotal },
          { label: "SOLAR PANEL SALES TAX @10%", amount: p.solarTax },
          { label: "SALES TAX ON OTHER ITEMS @18%", amount: p.otherTax },
        ];
  footer.push(
    { label: "Special Discount", amount: p.discount },
    { label: "Net Total", amount: p.netTotal },
  );
  if (p.input.presentation === "Basic Breakup")
    for (const category of p.rows) {
      const group = lines.filter((l) => l.group === category.key);
      if (group.length) {
        group[0].span = group.length;
        group[0].amount = money(
          D(
            p.input.taxMode === "Tax Included"
              ? category.afterTax
              : category.beforeTax,
          ),
        );
      }
    }
  if (p.input.presentation === "Basic Breakup") {
    const amountLines = lines.filter((l) => l.amount),
      balanceLine = amountLines.find((l) => l.group === "balance");
    if (balanceLine)
      balanceLine.amount = money(
        D(p.input.taxMode === "Tax Included" ? p.total : p.subtotal).minus(
          amountLines
            .filter((l) => l !== balanceLine)
            .reduce((a, l) => a.add(l.amount!), D("0")),
        ),
      );
  }
  // Customer snapshot contains selling amounts only; never serialize internal pricing or BOQ specifications.
  return {
    engineVersion: 1,
    input: {
      quotedDate: input.quotedDate,
      validity: input.validity,
      proposedBy: input.proposedBy,
    },
    customer: p.customer,
    siteName: p.siteName,
    siteCode: p.siteCode,
    boqNumber: p.boqNumber,
    solutionId: p.solutionId,
    presentation: p.input.presentation,
    subject:
      "Quotation for Solar Hybrid / Battery Energy Storage System (BESS).",
    lines,
    footer,
    notes: NOTES,
    terms: TERMS,
  };
}
export type QuotationSnapshot = ReturnType<typeof quote>;
