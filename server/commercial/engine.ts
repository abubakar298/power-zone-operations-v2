import {customerScopeItems, earthingScopeDescription} from './customer-scope.js';
import { standardItemPrices, type CommercialPolicy } from "./active-policy.js";
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
const ExactDecimal = Decimal.clone({precision:50});
const D = (v: string) => new ExactDecimal(v),
  money = (v: Decimal) =>
    v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export function cableExcessNote(
  boq: BoqSnapshot,
  currentRates?: Record<string, string>,
) {
  const cableKeys = [
    "6mm² DC Cable Red",
    "6mm² DC Cable Black",
    "2.5mm² Earthing Cable",
    "6mm² Earthing Cable",
    "10mm² Earthing Cable",
    "16mm² 4C AC Cable",
    "25mm² 4C AC Cable",
  ];
  const rates = cableKeys.flatMap((key) => {
    const line = boq.lines.find((l) => l.key === key);
    if (!line) return [];
    const rate = currentRates ? currentRates[key] : line.rate;
    if (
      rate === undefined ||
      !new Decimal(rate).isFinite() ||
      new Decimal(rate).isNegative()
    )
      throw new HttpError(
        422,
        `Enter a valid Rate Master cost for ${key} before preparing the quotation.`,
      );
    return [`${key}: PKR ${money(D(rate).mul("1.20").mul("1.18"))}`];
  });
  return `Cable quantities used in excess of the quantities stated in this quotation will be charged at the following rates per running meter (including GST): ${rates.join("; ")}.`;
}
export function price(
  boq: BoqSnapshot,
  boqNumber: string,
  input: PricingInput,
  policy?: CommercialPolicy,
) {
  if(boq.survey.family === "direct-product" && input.presentation === "Basic Breakup") throw new HttpError(400,"Direct Product Sale supports No Breakup or Breakup only.");
  const itemPricing = policy ? standardItemPrices(boq, input, policy) : undefined;
  if (policy) input = {...input, markups:{solar:policy.markups.solar,structure:policy.markups.structure,bess:policy.markups.bess,earthing:policy.markups.earthing,balance:policy.markups.other,rest:policy.markups.other},additionalMarkup:input.additionalCategory?policy.markups[input.additionalCategory]:undefined};
  const summary = (name: string) =>
    D(boq.summary.find((x) => x.name === name)?.cost ?? "0");
  const solar = summary("Solar Panels"),
    structure = summary("Structure"),
    bess = summary("BESS"),
    earthing = D(boq.epc.find((x) => x.name === "Earthing Cost")?.cost ?? "0"),
    cost = D(boq.total),
    additional = D(
      boq.lines.find((l) => l.key === "Additional Item")?.total ?? "0",
    ),
    balance = cost
      .minus(solar)
      .minus(structure)
      .minus(bess)
      .minus(earthing)
      .minus(additional);
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
    const markup = input.markups[key];
    const selling = itemPricing ? itemPricing.filter(l=>l.group===key).reduce((s,l)=>s.add(l.beforeTax),D("0")) : base.mul(D(markup).div(100).add(1)),
      rate = key === "solar" ? "10" : "18";
    return {
      key,
      name,
      cost: base.toString(),
      markup: itemPricing && !base.isZero() ? selling.div(base).minus(1).mul(100).toFixed(6) : markup,
      profit: selling.minus(base).toString(),
      beforeTax: selling.toString(),
      taxRate: rate,
      tax: selling.mul(D(rate).div(100)).toString(),
      afterTax: selling.mul(D(rate).div(100).add(1)).toString(),
    };
  });
  const extraRows = boq.survey.additionalItem
    ? (() => {
        const markup = input.additionalMarkup ?? input.markups.balance;
        const selling = itemPricing ? D(itemPricing.find(l=>l.group==="additional")!.beforeTax) : additional.mul(D(markup).div(100).add(1));
        const rate =
          input.additionalTaxRate ?? boq.survey.additionalItem.taxRate;
        return [
          {
            key: "additional" as const,
            name: boq.survey.additionalItem.description,
            cost: additional.toString(),
            markup,
            profit: selling.minus(additional).toString(),
            beforeTax: selling.toString(),
            taxRate: rate,
            tax: selling.mul(D(rate).div(100)).toString(),
            afterTax: selling.mul(D(rate).div(100).add(1)).toString(),
          },
        ];
      })()
    : [];
  const allRows = [...rows, ...extraRows].filter(r=>boq.survey.family === "direct-product" ? !D(r.cost).isZero() : boq.survey.family!=="bess-only"||!["solar","structure"].includes(r.key));
  const sum = (field: "beforeTax" | "tax" | "profit") =>
    allRows.reduce((a, r) => a.add(r[field]), D("0"));
  // Keep exact component math, round the two presented tax buckets once.
  const subtotal = money(sum("beforeTax")),
    solarTax = money(
      allRows
        .filter((r) => r.taxRate === "10")
        .reduce((a, r) => a.add(r.tax), D("0")),
    ),
    otherTax = money(
      allRows
        .filter((r) => r.taxRate === "18")
        .reduce((a, r) => a.add(r.tax), D("0")),
    ),
    tax = money(D(solarTax).add(otherTax)),
    total = money(D(subtotal).add(tax)),
    discount = "0.00";
  return {
    boqFamily: boq.survey.family ?? "solar-hybrid",
    engineVersion: policy ? 4 : 2,
    ...(policy ? {policy, itemPricing, standardDiscountStrategy: {
      version: "PZ-STANDARD-DISCOUNT-1",
      groups: allRows.map(row=>({group:row.key,beforeTax:money((itemPricing??[]).filter(l=>l.group===row.key&&["bess","other"].includes(l.category)).reduce((sum,l)=>sum.add(D(l.cost).mul("0.05")),D("0"))),taxRate:row.taxRate})),
    }} : {}),
    input,
    boqNumber,
    customer: boq.customer,
    siteName: boq.survey.siteName,
    siteCode: boq.survey.siteCode,
    solutionId: boq.engineering.solutionId,
    cost: cost.toString(),
    rows: allRows,
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
  group: "solar" | "structure" | "bess" | "earthing" | "balance" | "additional";
  items?: { description: string; unit: string; qty: string }[];
  amount?: string;
  standardAllowanceBeforeTax?: string;
  span?: number;
}
export function quotationLines(
  s: BoqSnapshot,
  bmsDescription = "IP65 Battery Control and Safety Unit for High Voltage Batteries",
  full = false,
): QuoteLine[] {
  if(s.survey.family === "direct-product") return directQuotationLines(s);
  if(s.survey.family === "bess-only") return bessOnlyLines(s, full ? "Full Breakup" : "No Breakup");
  const sp = s.survey.inverter === "6 kW SP";
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
    sp ? `${brand("inverter")} ${line(s.inverterConfig.sku)?.specification ?? "6 kW single-phase low-voltage hybrid inverter"}` : `${brand("inverter")} ${s.inverterConfig.sku.replace("HYB-3P-", "").replace(/^0+/, "")} kW IP66 Three Phase High Voltage Hybrid Inverter with 5-Years Replacement Warranty`,
    "No.",
    String(s.inverterConfig.quantity),
    "bess",
  );
  if (full || D(s.engineering.batteryModules).gt(0))
    add(
      sp ? `${brand("battery")} ${line("BAT-LV-05 KW WO BMS")?.specification ?? "5 kWh low-voltage lithium-ion battery module"}` : `${brand("battery")} 5 kWh IP65 High Voltage Lithium Ion ESS Battery Module with 5-Years Replacement Warranty`,
      "No.",
      s.engineering.batteryModules,
      "bess",
    );
  if (full || D(s.engineering.bms).gt(0))
    add(
      `${brand("battery")} ${sp ? line("CH-BMS-LV")?.specification ?? "Low-voltage battery control and safety unit" : bmsDescription}`,
      "No.",
      s.engineering.bms,
      "bess",
    );
  add(earthingScopeDescription, "No.", qty("Earthing Bore"), "earthing");
  add(
    `6mm² DC Cable Red and Black — ${brand("cable")}`,
    "m",
    s.generalAllowances?.dcMetres ?? s.survey.dcMetres,
    "balance",
  );
  for (const [key, quantity] of [
    ["2.5mm² Earthing Cable", s.generalAllowances?.earth25 ?? s.survey.earth25],
    ["6mm² Earthing Cable", s.generalAllowances?.earth6 ?? s.survey.earth6],
    ["10mm² Earthing Cable", s.generalAllowances?.earth10 ?? s.survey.earth10],
  ])
    if (full || D(quantity).gt(0))
      add(`${key} — ${key.startsWith("2.5") ? "Panel to Panel" : key.startsWith("6") ? "DC Side" : "AC Side"} — ${brand("cable")}`, "m", quantity, "balance");
  const ac = ["16mm² 4C AC Cable", "25mm² 4C AC Cable", "10mm² 1C AC Cable"]
    .filter((k) => line(k))
    .map((k) => k)
    .join(" & ");
  add(`${ac} — ${brand("cable")}`, "LS", "1", "balance");
  add(
    `DC Protection: DC Breakers, DC SPD and DC Fuse with Holders — ${brand("switchgear")}`,
    "LS",
    "1",
    "balance",
  );
  add(
    sp ? `AC Protection & Distribution: 63A input MCB, 32A output MCB, 32A changeover, VPD and protection boxes — ${brand("switchgear")}` : `AC Protection & Distribution: MCB/MCCB, Rotary Changeover, AC SPD and AC/DC Protection Boxes — ${brand("switchgear")}`,
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
  if (s.survey.additionalItem)
    add(
      s.survey.additionalItem.description,
      s.survey.additionalItem.unit,
      s.survey.additionalItem.qty,
      "additional",
    );
  const detailKeys = [
    ["16mm² 4C AC Cable", "25mm² 4C AC Cable", "10mm² 1C AC Cable"],
    ["DC Breaker", "500V 2P DC Breaker", "DC SPD", "DC Fuse with Holder", "SP DC Enclosures"],
    ["63A 4P MCB", "100A 4P MCCB", "100A Rotary Changeover with Box", "AC SPD", "AC & DC Boxes", "63A 2P MCB", "32A 2P MCB", "32A 2P Breaker Changeover", "63A 1P AC VPD", "SP AC Conduit Accessories and Box"],
    ["Misc. Accessories", "Extra Smart Meter", "Genset Synchronisation with Battery SOC"],
  ];
  const firstComposite = rows.findIndex(r => r.description === `${ac} — ${brand("cable")}`);
  detailKeys.forEach((keys,index) => {
    rows[firstComposite + index].items = customerScopeItems(s, s.lines.filter(l=>keys.includes(l.key)));
  });
  const dcRow = rows.find(r=>r.description.startsWith("6mm² DC Cable Red and Black"));
  if(dcRow) dcRow.items = customerScopeItems(s, s.lines.filter(l=>["6mm² DC Cable Red","6mm² DC Cable Black"].includes(l.key)));
  for(const [description,key] of [["Installation, Testing & Commissioning Labour","Labour"],["Project Delivery / Logistics","Delivery"]]) {
    const row = rows.find(r=>r.description===description), source = line(key);
    if(row && source) row.items = [{description:row.description,unit:source.unit,qty:source.qty}];
  }
  return rows;
}
export function quote(
  p: PricingSnapshot,
  boq: BoqSnapshot,
  input: QuotationInput,
  bmsDescription?: string,
  currentCableRates?: Record<string, string>,
) {
  const full = p.input.presentation === "Full Breakup";
  const extra = input.additionalItem;
  if (p.policy && extra) throw new HttpError(422,"Add new scope through an approved BOQ revision so its standard commercial category can be priced.");
  if (extra && boq.survey.additionalItem)
    throw new HttpError(
      409,
      "The additional scope is already included in approved costing; change it through a BOQ revision.",
    );
  if (extra && !full)
    throw new HttpError(400, "Additional items require Full Breakup.");
  const extraPrice = D(extra?.cost ?? "0").mul(
    D(extra?.markup ?? "0")
      .div(100)
      .add(1),
  );
  const extraTax = D(extra?.taxRate ?? "0")
    .div(100)
    .mul(extraPrice);
  const subtotal = money(D(p.subtotal).add(extraPrice));
  const solarTax = money(
    D(p.solarTax).add(extra?.taxRate === "10" ? extraTax : 0),
  );
  const otherTax = money(
    D(p.otherTax).add(extra?.taxRate === "18" ? extraTax : 0),
  );
  const total = money(D(subtotal).add(solarTax).add(otherTax));
  const discount = money(D(input.discount ?? p.discount));
  if (D(discount).gt(total))
    throw new HttpError(
      400,
      "Special discount cannot exceed the quoted total.",
    );
  const netTotal = money(D(total).minus(discount));
  if(boq.survey.family === "direct-product") return quoteDirectProducts(p,boq,input,discount,netTotal,total,subtotal,solarTax,otherTax);
  if(boq.survey.family === "bess-only") return quoteBessOnly(p,boq,input,discount,netTotal,total,subtotal,solarTax,otherTax);
  const lines = quotationLines(boq, bmsDescription, full);
  const scopeCount = lines.length;
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
      ? [{ label: "Total", amount: total }]
      : [
          { label: "Subtotal Before Tax", amount: subtotal },
          { label: "SOLAR PANEL SALES TAX @10%", amount: solarTax },
          { label: "SALES TAX ON OTHER ITEMS @18%", amount: otherTax },
        ];
  footer.push(
    { label: "Special Discount", amount: discount },
    { label: "Net Total", amount: netTotal },
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
  if (full) {
    // Each source cost belongs to exactly one customer row. Protection stays combined.
    const keys = [
      ["Solar PV Modules"],
      [`Structure - ${boq.survey.structure}`],
      [boq.inverterConfig.sku],
      [boq.survey.inverter === "6 kW SP" ? "BAT-LV-05 KW WO BMS" : "BAT-HV-05 KW WO BMS"],
      [boq.survey.inverter === "6 kW SP" ? "CH-BMS-LV" : "CH-BMS-HV"],
      ["Earthing Bore"],
      ["6mm² DC Cable Red", "6mm² DC Cable Black"],
      ["2.5mm² Earthing Cable"],
      ["6mm² Earthing Cable"],
      ["10mm² Earthing Cable"],
      ["16mm² 4C AC Cable", "25mm² 4C AC Cable", "10mm² 1C AC Cable"],
      ["DC Breaker", "500V 2P DC Breaker", "DC SPD", "DC Fuse with Holder", "SP DC Enclosures"],
      [
        "63A 4P MCB",
        "100A 4P MCCB",
        "100A Rotary Changeover with Box",
        "AC SPD",
        "AC & DC Boxes", "63A 2P MCB", "32A 2P MCB", "32A 2P Breaker Changeover", "63A 1P AC VPD", "SP AC Conduit Accessories and Box",
      ],
      [
        "Misc. Accessories",
        "Extra Smart Meter",
        "Genset Synchronisation with Battery SOC",
      ],
      ["Labour"],
      ["Delivery"],
    ];
    if (boq.survey.additionalItem) keys.push(["Additional Item"]);
    const covered = new Set(keys.flat());
    if (boq.lines.some((l) => !covered.has(l.key)))
      throw new HttpError(
        422,
        "A costing item has no Full Breakup row mapping.",
      );
    lines.forEach((l, i) => {
      const category = p.rows.find((r) => r.key === l.group)!;
      const base = boq.lines
        .filter((x) => keys[i].includes(x.key))
        .reduce((a, x) => a.add(x.total), D("0"));
      const selling = p.itemPricing ? p.itemPricing.filter(x=>keys[i].includes(x.key)).reduce((sum,x)=>sum.add(x.beforeTax),D("0")) : base.mul(D(category.markup).div(100).add(1));
      l.amount = money(
        p.input.taxMode === "Tax Included"
          ? selling.mul(D(category.taxRate).div(100).add(1))
          : selling,
      );
      if(p.standardDiscountStrategy)l.standardAllowanceBeforeTax=money((p.itemPricing??[]).filter(x=>keys[i].includes(x.key)&&["bess","other"].includes(x.category)).reduce((sum,x)=>sum.add(D(x.cost).mul("0.05")),D("0")));
      l.span = 1;
    });
    // Carry rounding cents on the last nonzero BOS row so printed rows reconcile.
    const adjustment =
      lines.findLast((l) => l.group === "balance" && D(l.amount!).gt(0)) ??
      lines.at(-1)!;
    adjustment.amount = money(
      D(adjustment.amount!).add(
        D(p.input.taxMode === "Tax Included" ? p.total : p.subtotal).minus(
          lines.reduce((a, l) => a.add(l.amount!), D("0")),
        ),
      ),
    );
    if (extra)
      lines.push({
        description: extra.description,
        unit: "LS",
        qty: "1",
        group: "balance",
        span: 1,
        amount: money(
          p.input.taxMode === "Tax Included"
            ? extraPrice.add(money(extraTax))
            : extraPrice,
        ),
      });
  }
  if (
    p.input.taxMode === "Tax Included" &&
    extra &&
    /\bGST\b|sales tax|tax included/i.test(extra.description)
  )
    throw new HttpError(
      400,
      "Remove tax wording from the additional item description.",
    );
  // Customer snapshot contains selling amounts only; never serialize internal pricing or BOQ specifications.
  return {
    engineVersion: 1,
    customerScopeVersion: 1,
    ...(p.standardDiscountStrategy ? {standardDiscountStrategy:p.standardDiscountStrategy} : {}),
    input: {
      quotedDate: input.quotedDate,
      validity: input.validity,
      proposedBy: input.proposedBy,
      discount,
    },
    customer: { ...p.customer, contactPerson: "", phone: "" },
    siteName: p.siteName,
    siteCode: p.siteCode,
    boqNumber: p.boqNumber,
    solutionId: p.solutionId,
    presentation: p.input.presentation,
    scopeCount,
    subject:
      "Quotation for Solar Hybrid / Battery Energy Storage System (BESS).",
    lines,
    footer,
    notes: [
      cableExcessNote(boq, currentCableRates),
      ...NOTES,
      ...(boq.survey.sourceMode === "General quotation"
        ? [
            "Prepared without a site survey. Cable quantities are calculated allowances; additional quantities are chargeable as stated above.",
          ]
        : []),
    ],
    terms: TERMS,
  };
}
export type QuotationSnapshot = ReturnType<typeof quote>;

/** BESS Only is a presentation of the same approved costing and pricing engine. */
function bessOnlyLines(boq:BoqSnapshot,presentation:string):QuoteLine[]{
  const equipment=boq.lines.filter(l=>l.phase==="BESS");
  const rows:QuoteLine[]=equipment.map(l=>({description:[l.brand,l.specification??l.description].filter(Boolean).join(" "),unit:l.unit,qty:l.qty,group:"bess"}));
  const bore=boq.lines.find(l=>l.key==="Earthing Bore");
  if(presentation==="Full Breakup" && bore) rows.push({description:earthingScopeDescription,unit:"No.",qty:bore.qty,group:"earthing"});
  const others=boq.lines.filter(l=>l.phase!=="BESS"&&(presentation!=="Full Breakup"||l.key!=="Earthing Bore"));
  if(others.length)rows.push({description:"Installation and balance of system",unit:"LS",qty:"1",group:"balance",items:customerScopeItems(boq, others)});
  return rows;
}
function quoteBessOnly(p:PricingSnapshot,boq:BoqSnapshot,input:QuotationInput,discount:string,netTotal:string,total:string,subtotal:string,solarTax:string,otherTax:string){
  const presentation=p.input.presentation;
  const lines=bessOnlyLines(boq,presentation);
  if(input.descriptions && input.descriptions.length!==lines.length)throw new HttpError(400,"Provide one description for each quotation row.");
  const amount=(keys:string[])=>{
    if(p.itemPricing)return p.itemPricing.filter(l=>keys.includes(l.key)).reduce((v,l)=>v.add(p.input.taxMode==="Tax Included"?D(l.beforeTax).add(l.tax):l.beforeTax),D("0"));
    return boq.lines.filter(l=>keys.includes(l.key)).reduce((v,l)=>{const group=l.phase==="BESS"?"bess":l.epc==="Earthing Cost"?"earthing":l.key==="Additional Item"?"additional":"balance";const row=p.rows.find(r=>r.key===group)!;return v.add(D(l.total).mul(D(row.markup).div(100).add(1)));},D("0"));
  };
  const equipment=boq.lines.filter(l=>l.phase==="BESS");
  lines.forEach((l,i)=>{
    if(input.descriptions)l.description=input.descriptions[i];
    if(p.input.taxMode==="Tax Included"&&/\bGST\b|sales tax|tax included/i.test(l.description))throw new HttpError(400,"Remove tax wording from customer descriptions for this presentation.");
    if(presentation==="No Breakup")return;
    if(presentation==="Basic Breakup"&&i>0&&i<equipment.length)return;
    const keys=i<equipment.length?(presentation==="Basic Breakup"?equipment.map(x=>x.key):[equipment[i].key]):l.group==="earthing"?["Earthing Bore"]:boq.lines.filter(x=>x.phase!=="BESS"&&(presentation!=="Full Breakup"||x.key!=="Earthing Bore")).map(x=>x.key);
    l.amount=money(amount(keys));
    l.span=presentation==="Basic Breakup"&&i===0?equipment.length:1;
    if(p.standardDiscountStrategy)l.standardAllowanceBeforeTax=money((p.itemPricing??[]).filter(x=>keys.includes(x.key)&&["bess","other"].includes(x.category)).reduce((v,x)=>v.add(D(x.cost).mul("0.05")),D("0")));
  });
  if(presentation!=="No Breakup"){
    const last=lines.findLast(l=>l.amount!==undefined)!;
    last.amount=money(D(last.amount!).add(D(p.input.taxMode==="Tax Included"?total:subtotal).sub(lines.reduce((v,l)=>v.add(l.amount??"0"),D("0")))));
  }
  const footer=p.input.taxMode==="Tax Included"?[{label:"Total",amount:total}]:[{label:"Subtotal Before Tax",amount:subtotal},{label:"SALES TAX ON OTHER ITEMS @18%",amount:otherTax}];
  if(p.input.taxMode!=="Tax Included"&&!D(solarTax).isZero())footer.splice(1,0,{label:"SALES TAX ON ADDITIONAL ITEMS @10%",amount:solarTax});
  footer.push({label:"Special Discount",amount:discount},{label:"Net Total",amount:netTotal});
  return {engineVersion:1,...(p.standardDiscountStrategy?{standardDiscountStrategy:p.standardDiscountStrategy}:{}),input:{quotedDate:input.quotedDate,validity:input.validity,proposedBy:input.proposedBy,discount},customer:{...p.customer,contactPerson:"",phone:""},siteName:p.siteName,siteCode:p.siteCode,boqNumber:p.boqNumber,solutionId:p.solutionId,presentation,scopeCount:lines.length,subject:"Quotation for BESS Only (UPS with Installation).",lines,footer,notes:NOTES,terms:TERMS};
}

function directQuotationLines(boq:BoqSnapshot):QuoteLine[] {
  return (boq.directProductGroups ?? []).flatMap(group=>group.components.map(component=>{
    const source=boq.lines.find(l=>l.key===component.key)!;
    return {description:[source.specification || source.description,source.brand].filter(Boolean).join(" — "),unit:source.unit,qty:component.qty,group:source.phase==="BESS"?"bess" as const:source.phase==="Solar Panels"?"solar" as const:"balance" as const};
  }));
}
function quoteDirectProducts(p:PricingSnapshot,boq:BoqSnapshot,input:QuotationInput,discount:string,netTotal:string,total:string,subtotal:string,solarTax:string,otherTax:string) {
  if(p.input.presentation==="Basic Breakup")throw new HttpError(400,"Direct Product Sale supports No Breakup or Breakup only.");
  const lines=directQuotationLines(boq);
  if(input.descriptions && input.descriptions.length!==lines.length)throw new HttpError(400,"Provide one description for each quotation row.");
  let offset=0;
  for(const group of boq.directProductGroups ?? []){
    const grouped=group.package && p.input.groupBessPackages===true;
    let amount=D("0"),allowance=D("0");
    group.components.forEach((component,index)=>{
      const line=lines[offset+index],source=boq.lines.find(l=>l.key===component.key)!;
      const priced=p.itemPricing?.find(l=>l.key===component.key);
      if(!priced)throw new HttpError(422,"Standard item pricing is required for Direct Product Sale.");
      if(input.descriptions)line.description=input.descriptions[offset+index];
      if(p.input.taxMode==="Tax Included"&&/\bGST\b|sales tax|tax included/i.test(line.description))throw new HttpError(400,"Remove tax wording from customer descriptions for this presentation.");
      const share=D(component.qty).div(source.qty);
      const selling=D(priced.beforeTax).mul(share).mul(p.input.taxMode==="Tax Included"?D(priced.taxRate).div(100).add(1):1);
      const introductory=["bess","other"].includes(priced.category)?D(priced.cost).mul(share).mul("0.05"):D("0");
      amount=amount.add(selling);allowance=allowance.add(introductory);
      if(p.input.presentation!=="No Breakup"&&!grouped){line.amount=money(selling);line.span=1;line.standardAllowanceBeforeTax=money(introductory);}
    });
    if(p.input.presentation!=="No Breakup"&&grouped){lines[offset].amount=money(amount);lines[offset].span=group.components.length;lines[offset].standardAllowanceBeforeTax=money(allowance);}
    offset+=group.components.length;
  }
  if(p.input.presentation!=="No Breakup"){
    const last=lines.findLast(l=>l.amount!==undefined)!;
    last.amount=money(D(last.amount!).add(D(p.input.taxMode==="Tax Included"?total:subtotal).sub(lines.reduce((v,l)=>v.add(l.amount??"0"),D("0")))));
  }
  const footer=p.input.taxMode==="Tax Included"?[{label:"Total",amount:total}]:[{label:"Subtotal Before Tax",amount:subtotal},...(D(solarTax).isZero()?[]:[{label:"SOLAR PANEL SALES TAX @10%",amount:solarTax}]),...(D(otherTax).isZero()?[]:[{label:"SALES TAX ON OTHER ITEMS @18%",amount:otherTax}])];
  footer.push({label:"Special Discount",amount:discount},{label:"Net Total",amount:netTotal});
  return {engineVersion:1,...(p.standardDiscountStrategy?{standardDiscountStrategy:p.standardDiscountStrategy}:{}),input:{quotedDate:input.quotedDate,validity:input.validity,proposedBy:input.proposedBy,discount},customer:{...p.customer,contactPerson:"",phone:""},siteName:p.siteName,siteCode:p.siteCode,boqNumber:p.boqNumber,solutionId:p.solutionId,presentation:p.input.presentation,scopeCount:lines.length,subject:"Quotation for Direct Product Sale.",lines,footer,notes:["All prices are ex-warehouse Lahore/Karachi.",...NOTES.slice(0,1)],terms:TERMS};
}
