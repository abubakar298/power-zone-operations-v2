import { Decimal } from "decimal.js";
import type { RequestHandler } from "express";

// Legacy internal projections still receive a role. HTTP boundaries always pass the authenticated capability.
export const canSeeBessCost = (
  user?: string | { restrictedCostAccess?: boolean },
) =>
  typeof user === "object"
    ? user.restrictedCostAccess === true
    : user === "Admin" || user === "Management" || user === "Accounts";
export const isBessEquipment = (value: any) =>
  ["BESS", "Inverter", "Batteries", "Battery", "BMS"].includes(value?.phase) ||
  ["BESS", "Inverter", "Batteries", "Battery", "BMS"].includes(value?.name) ||
  value?.costRestricted === true ||
  /C&I BESS/.test(value?.item_group ?? value?.itemGroup ?? "") ||
  /^(HYB-|BAT-|CH-BMS-|BMS-|CH-PCS-|CH-BAT-|CH-CNI-|CH-C&I)/i.test(
    String(value?.key ?? value?.item_key ?? ""),
  );

/** Projection only: authoritative stored costing and financial engines stay intact. */
export function restrictedCostView(value: any, commercial = false): any {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value))
    return value.map((v) => restrictedCostView(v, commercial));
  if (!value || typeof value !== "object") return value;
  const result: any = {};
  const boq = Array.isArray(value.lines) && value.engineering && value.survey;
  for (const [key, v] of Object.entries(value)) {
    if(key==='discountStrategy')continue; // Frozen internal per-item costs/allowances stay server-side.
    if (key === "budgeted_markup") continue;
    if(commercial && key==='standardDiscountStrategy' && (v as any)?.version==='PZ-STANDARD-DISCOUNT-2')continue;
    if(commercial && key==='discountAuthorization' && v){const {preapprovedBeforeTax,...safe}=v as any;result[key]=safe;continue;}
    if (key === "budgeted_cost") {
      result[key] = null;
      continue;
    }
    if (commercial && ["profit", "margin", "marginOnSales"].includes(key))
      continue;
    if (commercial && key === "cost" && Array.isArray(value.rows)) continue;
    if (key === "markups" && v && typeof v === "object") {
      result[key] = Object.fromEntries(
        Object.entries(v).filter(
          ([k]) => k !== "bess" && !isBessEquipment({ key: k }),
        ),
      );
      continue;
    }
    if (key === "rates" && Array.isArray(v)) {
      result[key] = v
        .filter((x) => !isBessEquipment(x))
        .map((x) => restrictedCostView(x, commercial));
      continue;
    }

    result[key] = restrictedCostView(v, commercial);
    if (
      commercial &&
      key === "additionalItem" &&
      (value.additionalCategory === "bess" || value.category === "bess") &&
      result[key]
    )
      delete result[key].cost;
  }
  if (
    value.key === "bess" ||
    value.category === "bess" ||
    isBessEquipment(value)
  ) {
    for (const k of [
      "cost",
      "markup",
      "rate",
      "unitCost",
      "total",
      "budgetedCost",
      "actualCost",
      "actual",
      "budgeted",
      "variance",
      "budgetedMarkup",
      "actualMarkup",
      "markupAmount",
      "markupPercent",
      "margin",
      "profit",
    ])
      if (k in result && !(['rate','total'].includes(k)&&typeof value.originalBeforeTax==='string'&&typeof value.beforeTax==='string'&&typeof value.allocatedDiscount==='string')) result[k] = null;
  }
  if (
    !boq &&
    "selling" in value &&
    ("actual" in value || "budgeted" in value)
  ) {
    for (const k of [
      "actual",
      "budgeted",
      "variance",
      "actualMarkupAmount",
      "budgetedMarkupAmount",
    ])
      if (k in result) result[k] = null;
  }
  if (!boq) {
    for (const k of [
      "budgetedCost",
      "totalCost",
      "totalBudgetedCost",
      "totalActualCost",
      "budgetedMarkup",
      "actualMarkup",
      "markupAmount",
      "markupPercent",
      "installationMarkupPercent",
    ])
      if (k in result) result[k] = null;
  }
  if (
    commercial &&
    Array.isArray(result.rows) &&
    value.input?.additionalCategory === "bess"
  )
    result.rows = result.rows.map((r: any) =>
      r.key === "additional" ? { ...r, cost: undefined, markup: undefined } : r,
    );
  if (boq) {
    result.costVisibility = "Excluding BESS";
    result.lines = value.lines.map((l: any) =>
      isBessEquipment(l)
        ? {
            ...restrictedCostView(l),
            rate: null,
            total: null,
            costRestricted: true,
          }
        : restrictedCostView(l),
    );
    result.summary = (value.summary ?? []).filter(
      (r: any) => r.name !== "BESS",
    );
    result.total = value.lines
      .filter((l: any) => !isBessEquipment(l))
      .reduce((n: Decimal, l: any) => n.plus(l.total), new Decimal(0))
      .toString();
    result.perWatt = new Decimal(value.engineering.pvWatts).isZero()
      ? "0.00"
      : new Decimal(result.total).div(value.engineering.pvWatts).toFixed(2);
  }
  return result;
}

/** Central outbound boundary; evaluated at send time, after route authentication. */
export const financialVisibility: RequestHandler = (req, res, next) => {
  const json = res.json.bind(res);
  res.json = ((body: any) => {
    if (canSeeBessCost(req.authSession?.user)) return json(body);
    const path = req.originalUrl;
    if (req.authSession) {
      body = restrictedCostView(body, path.startsWith("/api/commercial"));
      if (path.startsWith("/api/boqs"))
        for (const key of ["boqs", "revisions", "reviews"])
          if (Array.isArray(body?.[key]))
            body[key] = body[key].map((r: any) => {
              if (r.snapshot) return r;
              const { total, perWatt, ...safe } = r;
              return safe;
            });
    }
    return json(body);
  }) as typeof res.json;
  next();
};
