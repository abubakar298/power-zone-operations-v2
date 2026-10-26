import type { Pool, PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { calculate, calculateTechnicalReview } from "../boq/engine.js";
import { surveySchema } from "../boq/schema.js";
import { MastersRepository } from "../masters/repository.js";
import { selectCatalogueItem } from "../masters/catalogue.js";
import { OrdersRepository } from "../orders/repository.js";
import { requireEligibleQuotation } from "../commercial/eligibility.js";
import { orderSchema, orderBasisInputSchema } from "../orders/schema.js";
import { ublIpoSample } from "../ubl/ipo-sample.js";
import { HttpError } from "../http/errors.js";
import { commercialComparison } from "./policy.js";
import { fingerprint } from "../boq/repository.js";
type Db = Pool | PoolClient;
const money = (v: any) =>
  new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export async function designCalculation(
  c: Db,
  r: any,
  input: any,
  actorName: string,
) {
  const masters = await new MastersRepository(c, true).list();
  const profile = (
    await c.query(
      "SELECT * FROM engineering_profile_versions WHERE key=$1 AND version=$2",
      [input.profileKey, input.profileVersion],
    )
  ).rows[0];
  if (!profile)
    throw new HttpError(
      422,
      "Select an approved database engineering profile version.",
    );
  const customer = masters.customers.find((x: any) => x.id === r.customer_id);
  if (
    profile.key !== "standard-installation" &&
    profile.payload.customerShortCode !== customer?.short_code
  )
    throw new HttpError(
      422,
      "This profile does not apply to the selected customer.",
    );
  if (profile.key === "standard-installation")
    masters.engineeringProfiles = masters.engineeringProfiles.map((p: any) =>
      p.key === profile.key ? profile : p,
    );
  else
    masters.engineeringProfiles = masters.engineeringProfiles.map((p: any) =>
      p.key === profile.key ? profile : p,
    );
  const survey = surveySchema.parse({
    ...input.survey,
    customerId: r.customer_id,
    siteName: r.site_name,
    siteCode: r.site_code,
    location: input.survey.location ?? "",
    preparedBy: actorName,
    uploadIds: [],
    ocrText: "",
    ocrReviewed: false,
  });
  if (
    profile.key !== "standard-installation" &&
    profile.key !== `${customer?.short_code.toUpperCase()}-UPS-${survey.bessId}`
  )
    throw new HttpError(
      422,
      "The selected customer engineering profile does not match this solution configuration. Use the approved framework route for a fixed UBL solar configuration.",
    );
  const boq: any = calculateTechnicalReview(survey, masters);
  for (const line of boq.lines) {
    const selected = input.itemSelections?.[line.key];
    if (!selected) continue;
    const item = masters.catalogue.find((x: any) => x.item_id === selected);
    const automatic = selectCatalogueItem(
      masters,
      line.key,
      line.brand,
      survey.panelWattage,
    );
    if (
      !item ||
      !automatic ||
      automatic.rate_key !== item.rate_key ||
      automatic.payload.brandCategory !== item.payload.brandCategory
    )
      throw new HttpError(
        422,
        `${line.key}: Item ID must match its selected brand and specification.`,
      );
    if (
      item.payload.technicalDescription !==
        automatic.payload.technicalDescription &&
      item.item_id !== automatic.item_id
    )
      throw new HttpError(
        422,
        `${line.key}: the selected stock specification differs from the approved rule selection.`,
      );
    line.itemId = item.item_id;
    line.itemVersion = item.version;
    line.stockBrand = item.payload.brandCategory;
    line.specification = item.payload.technicalDescription;
  }
  const restrictedKeys = boq.lines
    .filter(
      (l: any) =>
        /^(HYB-|BAT-|CH-BMS-|CH-PCS-|CH-BAT-|CH-CNI-)/.test(l.key) ||
        l.phase === "BESS",
    )
    .map((l: any) => l.key);
  boq.workflowProfile = { key: profile.key, version: profile.version };
  return { boq, restrictedKeys };
}
function orderInput(customer: any, r: any, extra: any = {}) {
  return {
    evidenceType: "Customer PO",
    evidenceNotes:
      extra.notes ??
      extra.evidenceNotes ??
      "Customer confirmation against approved framework",
    poNumber: extra.reference ?? extra.poNumber ?? "",
    orderDate:
      extra.date ?? extra.orderDate ?? new Date().toISOString().slice(0, 10),
    invoiceCompany: extra.invoiceCompany ?? "PZES (PVT Ltd)",
    salesPerson: "Atif",
    customerAccepted: true,
    customerNtn: extra.customerNtn ?? "",
    customerStrn: extra.customerStrn ?? "",
    contactPerson: customer.contact_person ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    billingAddress: customer.address ?? "",
    deliveryAddress: "",
    siteContact: "",
    sitePhone: "",
    paymentMode: "",
    remarks: "",
    ...(extra.quotationId ? { quotationId: extra.quotationId } : {}),
  };
}
function phaseFor(l: any) {
  return l.phase === "Solar Panels"
    ? "Solar Panels"
    : l.phase === "Structure"
      ? "Structure"
      : /^(HYB-|CH-PCS-)/.test(l.key)
        ? "Inverter"
        : /^(BAT-|CH-BAT-)/.test(l.key)
          ? "Batteries"
          : /^(BMS-|CH-BMS-)/.test(l.key)
            ? "BMS"
            : "EPC";
}
function savedUblBoq(r: any, p: any, m: any) {
  const aliases: Record<string, string> = {
    "Solar panels": "Solar PV Modules",
    "Elevated structure": "Structure - Elevated",
    "HV 5kWh battery": "BAT-HV-05 KW WO BMS",
    "HV BMS": "CH-BMS-HV",
    "Roof DC breaker": "DC Breaker",
    "Inverter room DC breaker": "DC Breaker",
    "DC fuse with holder": "DC Fuse with Holder",
    "DC SPD": "DC SPD",
    "AC & DC Boxes combined": "AC & DC Boxes",
    "DC cable red 6mm²": "6mm² DC Cable Red",
    "DC cable black 6mm²": "6mm² DC Cable Black",
    "Misc accessories combined": "Misc. Accessories",
    "Grid input 100A 4P MCCB": "100A 4P MCCB",
    "Output 63A 4P MCB": "63A 4P MCB",
    "Output 100A 4P MCCB": "100A 4P MCCB",
    "AC SPD": "AC SPD",
    "16mm² 4C inverter cable": "16mm² 4C AC Cable",
    "16mm² 4C load cable": "16mm² 4C AC Cable",
    "25mm² 4C load cable": "25mm² 4C AC Cable",
    "UBL earthing bore": "Earthing Bore",
    "2.5mm² earth panel to panel": "2.5mm² Earthing Cable",
    "6mm² DC earth": "6mm² Earthing Cable",
    "10mm² AC earth": "10mm² Earthing Cable",
    "Smart meter included with inverter": "Extra Smart Meter",
    "UBL genset synchronization": "UBL Genset Synchronisation",
    "Router/device plus first month": "UBL Internet",
    "Installation labour": "Labour",
    Delivery: "Delivery",
  };
  const watts = new Decimal(p.configuration.split("-")[0]).mul(1000).toString();
  const lines = p.budget.items.map((i: any, index: number) => {
    const key = aliases[i.item] ?? i.item;
    const brand = /Cable/.test(key)
      ? "Pakistan Cables"
      : /HYB-|BAT-|BMS/.test(key)
        ? "Chint Power"
        : /Rotary/.test(key)
          ? "OPAL"
          : /MCB|MCCB|SPD|Breaker|Fuse|Changeover/.test(key)
            ? "CHINT"
            : "General";
    const item = selectCatalogueItem(m, key, brand);
    const phase =
      key === "Solar PV Modules"
        ? "Solar Panels"
        : key.startsWith("Structure")
          ? "Structure"
          : /^(HYB-|BAT-|CH-BMS-)/.test(key)
            ? "BESS"
            : "EPC";
    return {
      key,
      workflowLineId: `ubl-${index}`,
      itemId: item?.item_id,
      itemVersion: item?.version,
      stockBrand: item?.payload.brandCategory ?? brand,
      description: i.item,
      brand,
      brandAlternatives: [],
      specification: item?.payload.technicalDescription ?? i.item,
      specVersion: item?.version ?? null,
      qty: String(i.quantity),
      unit: i.unit,
      rate: String(i.buying_rate_ex_gst),
      total: String(i.total_ex_gst),
      rateVersion: 0,
      rateStatus: "Frozen framework budget",
      phase,
      epc:
        key === "Labour"
          ? "Electrical Labour"
          : key === "Delivery"
            ? "Deliveries"
            : key === "Earthing Bore"
              ? "Earthing Cost"
              : "Installation Cost",
    };
  });
  const total = lines
    .reduce((n: Decimal, l: any) => n.add(l.total), new Decimal(0))
    .toFixed(2);
  if (!new Decimal(total).eq(p.budget.budgetedCost))
    throw new HttpError(422, "Saved UBL framework costs do not reconcile.");
  return {
    customer: m.customers.find((x: any) => x.id === r.customer_id),
    survey: {
      customerId: r.customer_id,
      siteName: r.site_name,
      siteCode: r.site_code,
      location: "",
      family: "solar-hybrid",
      panelQty: 0,
      panelWattage: "0",
      brands: {},
      preparedBy: "Atif",
      uploadIds: [],
    },
    engineering: {
      pvWatts: watts,
      pvKwp: new Decimal(watts).div(1000).toString(),
      solutionId: p.configuration,
    },
    lines,
    total,
    summary: ["Solar Panels", "Structure", "BESS", "EPC"].map((name) => ({
      name,
      cost: lines
        .filter((l: any) => l.phase === name)
        .reduce((n: Decimal, l: any) => n.add(l.total), new Decimal(0))
        .toFixed(2),
    })),
    epc: [],
    rules: [],
    warnings: lines
      .filter(
        (l: any) =>
          !l.itemId &&
          !/(labour|labor|delivery|logistics|synchroni|internet)/i.test(
            l.description,
          ),
      )
      .map(
        (l: any) =>
          `${l.description}: stock Item ID is not finalised in the approved framework. Confirm stock specification before physical allocation; the financial snapshot remains fixed.`,
      ),
    engineVersion: 1,
    frameworkTechnical: p.technical,
  };
}
export async function frameworkBasis(
  pool: Pool,
  c: Db,
  r: any,
  id: string,
  extra: any = {},
) {
  const f = (
    await c.query(
      "SELECT * FROM project_framework_versions WHERE id=$1 AND customer_id=$2",
      [id, r.customer_id],
    )
  ).rows[0];
  if (!f || !f.payload.routes?.includes(r.route))
    throw new HttpError(
      422,
      "Select an approved agreement permitting this route for this customer.",
    );
  const customer = (
    await c.query("SELECT * FROM customers WHERE id=$1 AND status='Active'", [
      r.customer_id,
    ])
  ).rows[0];
  if (!customer) throw new HttpError(422, "Select an active customer.");
  const p = f.payload,
    m = await new MastersRepository(c, true).list();
  let boq: any, order: any;
  if (p.type === "quotation") {
    boq = structuredClone(p.boq);
    boq.survey = {
      ...boq.survey,
      customerId: r.customer_id,
      siteName: r.site_name,
      siteCode: r.site_code,
    };
    boq.customer = {
      id: customer.id,
      name: customer.name,
      shortCode: customer.short_code,
    };
    order = structuredClone(p.orderSnapshot);
  } else if (p.type === "ubl-solar") {
    boq = savedUblBoq(r, p, m);
    const base = {
      ...p.budget,
      commercialEvidence: {
        ...p.commercial,
        panelSellingExcludingGst: new Decimal(p.configuration.split("-")[0])
          .mul(1000)
          .mul(p.pricingStage === "Revised" ? 44 : 33)
          .toString(),
      },
      sellingIncludingGst: p.commercial.totalIncludingGst,
    };
    const sample = ublIpoSample({
      status: "Active",
      baseline: p.allocationSource?.baseline
        ? {
            ...p.allocationSource.baseline,
            commercialEvidence: base.commercialEvidence,
            sellingIncludingGst: base.sellingIncludingGst,
          }
        : base,
      site_name: r.site_name,
      branch_code: r.site_code,
      configuration_id: p.configuration,
      pricing_stage: p.pricingStage,
    });
    const lines = sample.billing.map((l: any) => ({
      description: l.name,
      qty: l.name === "Solar Panels" ? boq.engineering.pvWatts : "1",
      unit: l.name === "Solar Panels" ? "W" : "JOB",
      group: l.name === "Solar Panels" ? "solar" : "other",
      beforeTax: l.sellingExcludingGst,
      taxRate: l.name === "Solar Panels" ? "10" : "18",
      rate:
        l.name === "Solar Panels"
          ? String(p.pricingStage === "Revised" ? 44 : 33)
          : l.sellingExcludingGst,
      tax: l.gst,
      total: l.payable,
      allocatedDiscount: "0.00",
      originalBeforeTax: l.sellingExcludingGst,
      originalTotal: l.payable,
      originalTax: l.gst,
      beforeTaxReduction: "0",
      taxReduction: "0",
      taxRoundingAdjustment: "0",
    }));
    order = {
      allocation: {
        policy: "frozen-pre-agreed-configuration",
        originalDiscount: "0",
        lines,
        subtotal: sample.totalSellingExcludingGst,
        tax: sample.totalGst,
        total: sample.totalPayable,
      },
      peachtree: {
        version: 2,
        presentation: "Basic Breakup",
        taxMode: "Show Sales Tax Separately",
        saleType: "Tax Deal",
        basis: "Selling values excluding tax",
        policy: "frozen-approved-PT-allocation",
        phases: sample.phases.map((v: any) => ({
          name: v.name,
          amount: v.sellingExcludingGst,
          description: boq.lines
            .filter((l: any) => phaseFor(l) === v.name)
            .map(
              (l: any) => `${l.qty} × ${l.itemId ?? l.key} (${l.description})`,
            )
            .join("; "),
        })),
        phaseTotal: sample.totalSellingExcludingGst,
        ipoBeforeTax: sample.totalSellingExcludingGst,
        ipoTax: sample.totalGst,
        ipoPayable: sample.totalPayable,
      },
      quotationType: {
        presentation: "Basic Breakup",
        taxMode: "Show Sales Tax Separately",
        saleType: "Tax Deal",
      },
      solutionId: p.configuration,
    };
  } else if (p.type === "bank-ups") {
    const brands = (category: string, name: string) =>
      m.brands.find(
        (x: any) =>
          x.category === category &&
          x.status === "Active" &&
          x.name.toLowerCase() === name.toLowerCase(),
      )?.id;
    const survey = surveySchema.parse({
      family: "bess-only",
      sourceMode: "General quotation",
      customerId: r.customer_id,
      siteName: r.site_name,
      siteCode: r.site_code,
      location: "",
      panelQty: 0,
      panelWattage: "0",
      structure: "L1",
      dcMetres: "0",
      earth25: "1",
      earth6: "0",
      earth10: "0",
      bessId: p.profile.configuration,
      inverter: "6 kW SP",
      batteryKwh: Number(p.profile.configuration.split("-")[1]),
      smartMeter: false,
      genset: false,
      brands: {
        solar: 0,
        inverter:
          brands("Inverter", "Chint Power") ?? brands("Inverter", "CHINT"),
        battery:
          brands("Battery & BMS", "Chint Power") ??
          brands("Battery & BMS", "CHINT"),
        cable: brands("Cable", p.profile.acCable.brand),
        switchgear: brands("Switchgear", "CHINT"),
      },
      preparedBy: "Atif",
      uploadIds: [],
    });
    m.engineeringProfiles = m.engineeringProfiles.map((v: any) =>
      v.key === p.profileKey
        ? { ...v, version: p.profileVersion, payload: p.profile }
        : v,
    );
    boq = calculate(survey, m);
    const gross = new Decimal(p.profile.sellingPriceInclusiveTaxPkr),
      net = new Decimal(money(gross.div("1.18"))),
      tax = gross.sub(net);
    let used = new Decimal(0);
    const names = [
        "Solar Panels",
        "Structure",
        "Inverter",
        "Batteries",
        "BMS",
        "EPC",
      ],
      totalCost = new Decimal(boq.total);
    if (!totalCost.gt(0))
      throw new HttpError(422, "Framework costs are unavailable.");
    const phases = names.map((name, index) => {
      const ls = boq.lines.filter((l: any) => phaseFor(l) === name);
      const cost = ls.reduce(
        (n: Decimal, l: any) => n.add(l.total),
        new Decimal(0),
      );
      const amount =
        index === 5
          ? net.sub(used)
          : new Decimal(money(net.mul(cost).div(totalCost)));
      if (index < 5) used = used.add(amount);
      return {
        name,
        amount: money(amount),
        description: ls
          .map((l: any) => `${l.qty} × ${l.itemId ?? l.key} (${l.description})`)
          .join("; "),
      };
    });
    order = {
      allocation: {
        policy: "fixed-bank-ups",
        originalDiscount: "0",
        subtotal: money(net),
        tax: money(tax),
        total: money(gross),
        lines: [
          {
            description: `BATTERY ENERGY STORAGE SOLUTION (6 kW INVERTER + ${p.profile.configuration.split("-")[1]} kWh LITHIUM BATTERY BANK)`,
            group: "other",
            qty: "1",
            unit: "JOB",
            rate: money(net),
            beforeTax: money(net),
            taxRate: "18",
            tax: money(tax),
            total: money(gross),
            allocatedDiscount: "0",
            originalBeforeTax: money(net),
            originalTotal: money(gross),
            originalTax: money(tax),
            beforeTaxReduction: "0",
            taxReduction: "0",
            taxRoundingAdjustment: money(
              tax.sub(new Decimal(money(net.mul("0.18")))),
            ),
          },
        ],
      },
      peachtree: {
        version: 2,
        presentation: "Basic Breakup",
        taxMode: "Show Sales Tax Separately",
        saleType: "Tax Deal",
        basis: "Selling values excluding tax",
        policy: "fixed-bank-ups-proportional-cost",
        phases,
        phaseTotal: money(net),
        ipoBeforeTax: money(net),
        ipoTax: money(tax),
        ipoPayable: money(gross),
      },
      quotationType: {
        presentation: "Basic Breakup",
        taxMode: "Show Sales Tax Separately",
        saleType: "Tax Deal",
      },
      solutionId: `UPS-${p.profile.configuration}`,
    };
  } else throw new HttpError(422, "Unsupported approved framework basis.");
  order = {
    ...order,
    source: "Approved pre-agreed configuration",
    frameworkId: f.id,
    frameworkVersion: f.version,
    frameworkKey: f.configuration_key,
    quotationId: null,
    quotationNumber: `Framework ${f.configuration_key} v${f.version}`,
    customer: {
      id: customer.id,
      name: customer.name,
      shortCode: customer.short_code,
    },
    siteName: r.site_name,
    siteCode: r.site_code,
    boqRevisionId: null,
    boqNumber: "Pending issuance",
    input: orderInput(customer, r, {
      invoiceCompany:
        p.invoiceCompany ??
        p.orderSnapshot?.input?.invoiceCompany ??
        "PZES (PVT Ltd)",
      ...extra,
    }),
    documentLayoutVersion: 3,
  };
  const comparison = commercialComparison(boq, order, p.terms ?? {});
  return {
    source: {
      type: "framework",
      id: f.id,
      version: f.version,
      key: f.configuration_key,
    },
    boq,
    order,
    comparison,
    fingerprint: fingerprint({ boq, order, comparison }),
  };
}
export async function quotationBasis(
  pool: Pool,
  c: Db,
  actor: string,
  r: any,
  id: string,
  extra: any = {},
  commercialLookupOnly = false,
) {
  await requireEligibleQuotation(c, id);
  const q = (
    await c.query(
      "SELECT q.*,b.site_id,b.customer_id FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id JOIN boqs b ON b.id=br.boq_id WHERE q.id=$1",
      [id],
    )
  ).rows[0];
  if (
    !q ||
    q.customer_id !== r.customer_id ||
    q.snapshot.siteCode?.toLowerCase() !== r.site_code.toLowerCase()
  )
    throw new HttpError(
      422,
      "The quotation must belong to this customer and site.",
    );
  const boq = (
    await c.query("SELECT * FROM boq_revisions WHERE id=$1", [
      q.boq_revision_id,
    ])
  ).rows[0];
  const pricing = (
    await c.query(
      "SELECT snapshot FROM commercial_pricing_versions WHERE id=$1",
      [q.pricing_id],
    )
  ).rows[0]?.snapshot;
  const customer = (
    await c.query("SELECT * FROM customers WHERE id=$1", [r.customer_id])
  ).rows[0];
  const input = (commercialLookupOnly ? orderBasisInputSchema : orderSchema).parse(
    orderInput(customer, r, {
      quotationId: id,
      invoiceCompany:
        pricing?.input?.saleType === "Cash Deal"
          ? "Energy Solutions"
          : "PZES (PVT Ltd)",
      ...extra,
    }),
  );
  const preview = await new OrdersRepository(pool).preview(actor, input, c);
  const terms = {
    payment:
      q.snapshot.input?.paymentTerms ?? q.snapshot.input?.paymentMode ?? "",
    delivery: q.snapshot.input?.deliveryTerms ?? "",
    validity: q.snapshot.input?.validity ?? "",
  };
  const comparison = commercialComparison(
    boq.snapshot,
    preview.snapshot,
    terms,
  );
  return {
    source: { type: "quotation", id: q.id, version: q.version, key: q.number },
    boq: boq.snapshot,
    boqRevisionId: boq.id,
    order: preview.snapshot,
    comparison,
    fingerprint: fingerprint({
      boq: boq.snapshot,
      order: preview.snapshot,
      comparison,
    }),
  };
}
