import { Decimal } from "decimal.js";
import { HttpError } from "../http/errors.js";
import { isBessEquipment } from "../http/cost-visibility.js";
import { fingerprint } from "../boq/repository.js";
export {
  designBuckets,
  coordinationBuckets,
  routeNames,
} from "./routes-shared.js";
import {
  designBuckets,
  coordinationBuckets,
} from "./routes-shared.js";
export function bucketFor(r: any, department: string) {
  if (department === "design" && r.stage === "survey_scheduled" && !r.data?.surveyDispatchId) return designBuckets[0];
  if (department === "design")
    return ["survey_requested", "survey_scheduled", "report_received"].includes(
      r.stage,
    )
      ? designBuckets[
          ["survey_requested", "survey_scheduled", "report_received"].indexOf(
            r.stage,
          )
        ]
      : r.stage === "technical_review" || r.stage === "technical_revision"
        ? designBuckets[2]
        : designBuckets[3];
  return (
    r.coordinationBucket ??
    ([
      "request_review",
      "survey_requested",
      "survey_scheduled",
      "report_received",
      "technical_review",
      "technical_revision",
    ].includes(r.stage)
      ? coordinationBuckets[0]
      : r.stage === "management_review"
        ? coordinationBuckets[2]
        : r.stage === "commercial_revision"
          ? coordinationBuckets[3]
          : r.stage === "approved_dispatch"
            ? coordinationBuckets[4]
            : ["customer_tracking", "deferred", "declined"].includes(r.stage)
              ? coordinationBuckets[5]
              : r.stage === "order_exception"
                ? coordinationBuckets[7]
                : r.stage === "advance_pending"
                  ? coordinationBuckets[8]
                  : ["po_receipt", "issued"].includes(r.stage)
                    ? coordinationBuckets[6]
                    : coordinationBuckets[1])
  );
}
export function normalizeComparison(v: any) {
  const number = (x: any) => {
    const n = new Decimal(x);
    if (!n.isFinite() || n.lt(0))
      throw new HttpError(
        422,
        "PO quantities and amounts must be non-negative finite numbers.",
      );
    return n.toString();
  };
  const rows = (ls: any[], financial: boolean) =>
    ls
      .map((l) =>
        financial
          ? {
              lineId: l.lineId,
              description: l.description.trim(),
              qty: number(l.qty),
              unit: l.unit.trim(),
              rate: number(l.rate),
              amount: number(l.amount),
              taxRate: number(l.taxRate),
            }
          : {
              lineId: l.lineId,
              itemId: l.itemId.trim(),
              description: l.description.trim(),
              qty: number(l.qty),
              unit: l.unit.trim(),
              brand: l.brand.trim(),
              specification: l.specification.trim(),
            },
      )
      .sort((a, b) => a.lineId.localeCompare(b.lineId));
  for (const lines of [v.materials, v.billing])
    if (new Set(lines.map((l: any) => l.lineId)).size !== lines.length)
      throw new HttpError(422, "PO line references must be unique.");
  return {
    materials: rows(v.materials, false),
    billing: rows(v.billing, true),
    subtotal: number(v.subtotal),
    tax: number(v.tax),
    total: number(v.total),
    discount: number(v.discount),
    saleType: v.saleType,
    cashGstTreatment: v.cashGstTreatment.trim(),
    invoiceCompany: v.invoiceCompany.trim(),
    terms: Object.fromEntries(
      Object.entries(v.terms)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, String(x).trim()]),
    ),
  };
}
export function compareBasis(expected: any, actual: any) {
  const a = normalizeComparison(expected),
    b = normalizeComparison(actual),
    differences: { field: string; approved: any; received: any }[] = [];
  for (const key of Object.keys(a))
    if (fingerprint((a as any)[key]) !== fingerprint((b as any)[key]))
      differences.push({
        field: key,
        approved: (a as any)[key],
        received: (b as any)[key],
      });
  return differences;
}
export function commercialComparison(boq: any, snapshot: any, terms: any = {}) {
  return {
    materials: boq.lines
      .filter((l: any) => new Decimal(l.qty).gt(0))
      .map((l: any, index: number) => ({
        lineId: `material-${index}`,
        itemId: l.itemId ?? "",
        description: l.description ?? l.key,
        qty: String(l.qty),
        unit: l.unit,
        brand: l.stockBrand ?? l.brand ?? "",
        specification: l.specification ?? "",
      })),
    billing: snapshot.allocation.lines
      .filter(
        (l: any) => new Decimal(l.qty).gt(0) || new Decimal(l.total).gt(0),
      )
      .map((l: any, index: number) => ({
        lineId: `billing-${index}`,
        description: l.description,
        qty: String(l.qty),
        unit: l.unit,
        rate: String(l.rate),
        amount: String(l.beforeTax),
        taxRate: String(l.taxRate),
      })),
    subtotal: snapshot.allocation.subtotal,
    tax: snapshot.allocation.tax,
    total: snapshot.allocation.total,
    discount: snapshot.allocation.originalDiscount ?? "0",
    saleType: snapshot.quotationType?.saleType ?? "Tax Deal",
    cashGstTreatment: snapshot.quotationType?.cashGstTreatment ?? "",
    invoiceCompany: snapshot.input.invoiceCompany,
    terms,
  };
}
export function safeCosting(
  boq: any,
  role: string,
  markups: Record<string, string> = {},
) {
  const restricted = !["Admin", "Management"].includes(role);
  const lines = boq.lines.map((l: any) => {
    const hidden = restricted && isBessEquipment(l);
    const rate = new Decimal(l.rate ?? 0),
      cost = new Decimal(l.total ?? 0),
      markup = markups[l.key] ?? "0";
    return {
      key: l.key,
      itemId: l.itemId,
      itemVersion: l.itemVersion,
      description: l.description,
      brand: l.stockBrand ?? l.brand,
      specification: l.specification,
      qty: l.qty,
      unit: l.unit,
      phase: l.phase,
      epc: l.epc,
      rate: hidden ? null : rate.toString(),
      cost: hidden ? null : cost.toString(),
      markup: hidden ? null : markup,
      markupAmount: hidden ? null : cost.mul(markup).div(100).toFixed(2),
      selling: hidden
        ? null
        : cost.mul(new Decimal(markup).div(100).add(1)).toFixed(2),
      restricted: hidden,
    };
  });
  const permitted = lines.filter((l: any) => !l.restricted),
    partial = permitted.reduce(
      (n: Decimal, l: any) => n.add(l.cost),
      new Decimal(0),
    );
  return {
    lines,
    total: partial.toFixed(2),
    totalLabel: restricted
      ? "Partial cost — excludes inverter, battery, BMS and C&I BESS"
      : "Complete budgeted cost",
    markupsIncluded: !restricted,
    warnings: boq.warnings ?? [],
    engineering: boq.engineering,
    ruleVersions: boq.rules?.map((x: any) => ({
      key: x.key,
      version: x.version,
      setting: x.setting,
      value: x.value,
    })),
    profile: boq.workflowProfile,
  };
}
export function safeDocument(snapshot: any, role: string) {
  const copy = structuredClone(snapshot);
  if (["Admin", "Management"].includes(role)) {
    if (copy.boq) copy.costing = safeCosting(copy.boq, role, copy.markups);
    return copy;
  }
  if (copy.boq) {
    copy.costing = safeCosting(copy.boq, role, copy.markups);
    delete copy.boq;
  }
  for (const k of [
    "baseline",
    "budget",
    "allocationSource",
    "budgetedCost",
    "markupAmount",
    "markupPercent",
    "installationMarkupPercent",
    "markups",
  ])
    delete copy[k];
  if (copy.orderSnapshot) {
    delete copy.orderSnapshot;
  }
  if (copy.sample) {
    for (const k of [
      "budgetedCost",
      "markupAmount",
      "markupPercent",
      "installationMarkupPercent",
      "reviewNotes",
    ])
      delete copy.sample[k];
    copy.sample.phases = copy.sample.phases?.map(
      ({ budgetedCost, markup, ...p }: any) => p,
    );
  }
  return copy;
}
