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
  // A discount comparison contains aggregate equipment costs even when its
  // item-level pricing has already been projected. Profit also reveals cost
  // by subtraction from the public selling price.
  const discountReview = commercial && "maximumDiscount" in value &&
    value.original && value.proposed && "cost" in value;
  const cniReview = "costVersion" in value && "unitCostBeforeTax" in value &&
    "recommendedDiscount" in value && value.original && value.proposed;
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
    // Accounts closure snapshots store costs as phase-keyed maps rather than
    // priced rows. Redact those same equipment phases at every history depth.
    if (["budget", "actual"].includes(key) && v && typeof v === "object" && !Array.isArray(v)) {
      result[key] = Object.fromEntries(Object.entries(v).map(([phase, amount]) => [
        phase, isBessEquipment({name: phase}) ? null : restrictedCostView(amount, commercial),
      ]));
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
  if (discountReview) {
    result.cost = null;
    result.costRestricted = true;
    for (const metrics of [result.original, result.proposed])
      for (const key of ["profit", "profitPercent", "marginPercent"])
        metrics[key] = null;
    result.targetMarkup = null;
    result.targetMargin = null;
  }
  if (cniReview) {
    result.unitCostBeforeTax = null;
    result.costRestricted = true;
    for (const metrics of [result.original, result.proposed])
      for (const key of ["cost", "profit", "markup"])
        metrics[key] = null;
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
    ["actual", "budgeted", "budget"].some(key => key in value && (value[key] === null || typeof value[key] !== "object"))
  ) {
    for (const k of [
      "actual",
      "budget",
      "budgeted",
      "variance",
      "actualMarkupAmount",
      "budgetedMarkupAmount",
      "actualMarkupPercent",
      "budgetedMarkupPercent",
    ])
      if (k in result && (result[k] === null || typeof result[k] !== "object")) result[k] = null;
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
      "averageActualMarkupPercent",
    ])
      if (k in result) result[k] = null;
  }
  // Comparing a mixed-configuration average with selling value also reveals
  // restricted equipment cost. Preserve sample counts and non-BESS peers.
  if (value.phases && typeof value.phases === "object" && !Array.isArray(value.phases) && value.total && typeof value.total === "object" && "averageActualCost" in value.total) {
    result.phases = Object.fromEntries(Object.entries(value.phases).map(([phase, metrics]) => [phase,
      isBessEquipment({name: phase}) && metrics && typeof metrics === "object"
        ? {...restrictedCostView(metrics, commercial), averageActualCost: null}
        : restrictedCostView(metrics, commercial),
    ]));
    result.total = {...restrictedCostView(value.total, commercial), averageActualCost: null};
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
