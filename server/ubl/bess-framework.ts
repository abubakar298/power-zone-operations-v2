import { Decimal } from "decimal.js";
import { HttpError } from "../http/errors.js";
const money = (v: Decimal.Value) =>
  new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const UBL_BESS_POLICY = "ubl-bess-approved-proportional-v1";
const names = [
  "Inverter",
  "Batteries",
  "BMS",
  "Installation Cost",
  "Earthing Cost",
  "Electrical Labour",
  "Deliveries",
];
/** Build only from the immutable agreement payload. Live rate/discount masters never reprice it. */
export function approvedBessBasis(r: any, p: any, m: any) {
  const a = p.approved,
    customer = m.customers.find((c: any) => c.id === r.customer_id);
  if (
    customer?.short_code?.toUpperCase() !== "UBL" ||
    p.type !== "ubl-bess-installation"
  )
    throw new HttpError(
      422,
      "This agreement belongs to UBL BESS installations.",
    );
  const required = p.materials.map((line: any) => {
    const item = m.catalogue.find((i: any) => i.item_id === line.itemId);
    if (!item)
      throw new HttpError(
        422,
        `Existing agreed Item ID is unavailable: ${line.itemId}`,
      );
    return { ...line, item };
  });
  const lines: any[] = required.map((l: any) => ({
    key: l.itemId,
    rateKey: l.item.rate_key,
    itemId: l.itemId,
    itemVersion: l.item.version,
    stockBrand: l.item.payload.brandCategory,
    brand: l.item.payload.brandCategory,
    brandAlternatives: [],
    specification: l.item.payload.technicalDescription,
    description: l.description ?? l.item.payload.technicalDescription,
    qty: l.qty,
    unit: l.item.payload.unit ?? "NOS",
    rate: l.cost ? new Decimal(l.cost).div(l.qty).toString() : "0",
    total: l.cost ?? "0.00",
    rateVersion: 0,
    rateStatus: "Approved UBL configuration budget",
    phase: l.phase ?? "EPC",
    epc: l.epc ?? "Installation Cost",
    ...(l.cost ? {} : { budgetIncludedIn: "Installation Cost" }),
    ...(l.contractItemId
      ? {
          contractItemId: l.contractItemId,
          contractSpecification:
            "25 mm² 4-core inverter termination cable; actual requirement 16 mm²",
        }
      : {}),
  }));
  // Installation is a commercial allowance, not a second warehouse item. Physical
  // switchgear/cables above are included in it; issuing them cannot add budget cost.
  for (const [index, key] of [
    [3, "Installation Cost"],
    [4, "Earthing Bore"],
    [5, "Labour"],
    [6, "Delivery"],
  ] as const)
    lines.push({
      key,
      description: names[index],
      qty: "1",
      unit: "JOB",
      brand: "General",
      brandAlternatives: [],
      specification: names[index],
      rate: a.costs[index],
      total: a.costs[index],
      rateVersion: 0,
      rateStatus: "Approved UBL configuration budget",
      phase: "EPC",
      epc: names[index],
      nonStockBudget: true,
    });
  const total = money(
    lines.reduce((s: Decimal, l: any) => s.add(l.total), new Decimal(0)),
  );
  if (total !== money(a.costTotal))
    throw new HttpError(
      422,
      "The approved BESS cost budget does not reconcile.",
    );
  const contractualBoq = lines
    .filter((l) => !l.nonStockBudget)
    .map((l) => ({
      ...l,
      itemId: l.contractItemId ?? l.itemId,
      description: l.contractItemId
        ? "25mm² 4C inverter cable (contractual)"
        : l.description,
      specification: l.contractSpecification ?? l.specification,
    }));
  const boq: any = {
    customer: {
      id: customer.id,
      name: customer.name,
      shortCode: customer.short_code,
    },
    survey: {
      customerId: r.customer_id,
      siteName: r.site_name,
      siteCode: r.site_code,
      location: "",
      family: "bess-only",
      panelQty: 0,
      panelWattage: "0",
      structure: "L1",
      dcMetres: "0",
      acInverter16: "10",
      acInverter25: "0",
      acPanel16: "0",
      acPanel25: "20",
      earth25: "0",
      earth6: "0",
      earth10: "60",
      bessId: `BESS-${p.inverterKw}-${p.essKwh}`,
      inverter: p.inverterKw === "20" ? "20 kW" : "2×15 kW",
      batteryKwh: Number(p.essKwh),
      smartMeter: false,
      genset: true,
      preparedBy: "Atif",
      brands: {},
      uploadIds: [],
    },
    engineering: {
      pvWatts: "0",
      pvKwp: "0",
      solutionId: `BESS-${p.inverterKw}-${p.essKwh}`,
      inverterKw: p.inverterKw,
      batteryKwh: p.essKwh,
      batteryModules: required.find((l: any) => l.itemId === "CH-BAT-HV-05 KW")
        .qty,
      bms: required.find((l: any) => l.itemId === "CH-BMS-HV").qty,
    },
    lines,
    total,
    summary: ["BESS", "EPC"].map((name) => ({
      name,
      cost: money(
        lines
          .filter((l) => l.phase === name)
          .reduce((s: Decimal, l: any) => s.add(l.total), new Decimal(0)),
      ),
    })),
    epc: names
      .slice(3)
      .map((name, i) => ({ name, cost: a.costs[i + 3], perWatt: "0.00" })),
    rules: [],
    warnings: [],
    engineVersion: 1,
    contractualBoq,
    approvedAgreement: p.configuration,
    installationAllowance: p.installationAllowance,
    cableAdjustment: {
      status: "Later usage-based invoicing review",
      contractItemId: "CH-CBL-AC-25MM/4C-PK",
      actualItemId: "CH-CBL-AC-16MM/4C-PK",
      quantity: "10",
      initialDeduction: "0.00",
      estimatedDifferenceExGst: "23240.00",
      invoiceCreditCreated: false,
    },
  };
  const selling = a.selling.map((amount: string, i: number) => ({
    name: names[i],
    amount,
    cost: a.costs[i],
    standardSelling: money(
      new Decimal(a.costs[i]).mul(i < 3 ? "1.30" : i === 4 ? "1.10" : "1.25"),
    ),
  }));
  const net = money(
      selling.reduce((s: Decimal, l: any) => s.add(l.amount), new Decimal(0)),
    ),
    tax = money(new Decimal(a.total).sub(net));
  if (
    net !== money(a.net) ||
    !new Decimal(net).mul("1.18").toDecimalPlaces(2).eq(a.total)
  )
    throw new HttpError(
      422,
      "The approved BESS PT/GST allocation does not reconcile.",
    );
  const billing = selling.map((l: any, i: number) => ({
    description: i < 3 ? required[i].item.payload.technicalDescription : l.name,
    qty:
      i === 0
        ? required[0].qty
        : i === 1
          ? required[1].qty
          : i === 2
            ? required[2].qty
            : "1",
    unit: i < 3 ? "NOS" : "JOB",
    group: i < 3 ? "bess" : i === 4 ? "earthing" : "other",
    beforeTax: l.amount,
    rate: new Decimal(l.amount)
      .div(i < 3 ? required[i].qty : "1")
      .toDecimalPlaces(8)
      .toString(),
    taxRate: "18",
    tax: money(new Decimal(l.amount).mul(".18")),
    originalBeforeTax: l.standardSelling,
    allocatedDiscount: money(new Decimal(l.standardSelling).sub(l.amount)),
    total: money(new Decimal(l.amount).mul("1.18")),
  }));
  // Preserve each approved net entry; tax cents reconcile at the final entry only.
  const taxSum = billing.reduce(
      (s: Decimal, l: any) => s.add(l.tax),
      new Decimal(0),
    ),
    last = billing.at(-1)!;
  last.tax = money(new Decimal(last.tax).add(new Decimal(tax).sub(taxSum)));
  last.total = money(new Decimal(last.beforeTax).add(last.tax));
  const epcAmount = money(
    selling
      .slice(3)
      .reduce((s: Decimal, l: any) => s.add(l.amount), new Decimal(0)),
  );
  const phases = [
    ...selling
      .slice(0, 3)
      .map((l: any) => ({ name: l.name, amount: l.amount })),
    { name: "EPC", amount: epcAmount },
  ];
  const order: any = {
    customer: boq.customer,
    siteName: r.site_name,
    siteCode: r.site_code,
    solutionId: boq.engineering.solutionId,
    configurationContract: contractualBoq,
    cableAdjustment: boq.cableAdjustment,
    allocation: {
      policy: UBL_BESS_POLICY,
      originalDiscount: a.discount,
      standardSubtotal: a.standardSubtotal,
      negotiatedDiscount: a.discount,
      discountAlreadyApplied: true,
      lines: billing,
      subtotal: net,
      tax,
      total: money(a.total),
    },
    peachtree: {
      version: 2,
      presentation: "Basic Breakup",
      taxMode: "Show Sales Tax Separately",
      saleType: "Tax Deal",
      basis: "Selling values excluding tax",
      policy: UBL_BESS_POLICY,
      phases,
      epcBreakup: selling.slice(3).map((l: any, i: number) => ({
        name: l.name,
        amount: l.amount,
        itemId: [
          "CH-EPC",
          "CH-Earthing",
          "CH-Electrical Labor",
          "CH-Deliveries",
        ][i],
        description: l.name,
      })),
      epcBreakupBasis:
        "Approved configuration-specific proportional discount across all PT entries, including earthing and deliveries.",
      phaseTotal: net,
      ipoBeforeTax: net,
      ipoTax: tax,
      ipoPayable: money(a.total),
    },
    quotationType: {
      presentation: "Basic Breakup",
      taxMode: "Show Sales Tax Separately",
      saleType: "Tax Deal",
    },
    approvedCostSnapshot: {
      costTotal: total,
      entries: selling,
      installationAllowance: p.installationAllowance,
    },
    approvedPriceAudit: {
      standardSubtotal: a.standardSubtotal,
      negotiatedDiscount: a.discount,
      net,
      total: money(a.total),
      discountAlreadyApplied: true,
    },
  };
  return { boq, order };
}
