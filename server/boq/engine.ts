import {
  identifyLines,
  standardProfile,
  bankUpsProfile,
  type CatalogueItem,
  type EngineeringProfile,
} from "../masters/catalogue.js";
import {
  calculateDirectProducts,
  directProductGroups,
} from "./direct-products.js";
import { singlePhaseCableDescription } from "./ac-cable.js";
import { singlePhaseConfigurations } from "./equipment.js";
import { singlePhaseScope } from "./single-phase.js";
import { findBess, BESS_RULE_VERSION } from "./bess.js";
import { Decimal } from "decimal.js";
import { HttpError } from "../http/errors.js";
import { generalAllowances, GENERAL_ALLOWANCE_VERSION } from "./general.js";
import type { Survey } from "./schema.js";
export interface CustomerMaster {
  id: number;
  name: string;
  short_code: string;
  status: string;
}
export interface BrandMaster {
  id: number;
  category: string;
  name: string;
  status: string;
  version: number;
  notes: string;
}
export interface RateMaster {
  key: string;
  unit: string;
  rate: string | null;
  version: number;
  status: string;
  notes: string;
}
export interface RuleMaster {
  key: string;
  value: string;
  version: number;
  rule_group: string;
  setting: string;
  notes: string;
}
export interface ItemMaster {
  key: string;
  approved_specification: string | null;
  status: string;
  version: number;
}
export interface InverterMaster {
  configuration: string;
  total_kw: string;
  sku: string;
  quantity: number;
}
export interface Classification {
  phase: string;
  epc_category: string;
  item_rule: string;
  notes: string;
}
export interface Masters {
  customers: CustomerMaster[];
  brands: BrandMaster[];
  rates: RateMaster[];
  rules: RuleMaster[];
  items: ItemMaster[];
  inverters: InverterMaster[];
  classifications: Classification[];
  catalogue?: CatalogueItem[];
  engineeringProfiles?: EngineeringProfile[];
}
export interface CostLine {
  item_group?: string;
  costRestricted?: boolean;
  itemId?: string;
  itemVersion?: number;
  stockBrand?: string;
  rateKey?: string;
  costingCategory?: string;
  colour?: string;
  key: string;
  description: string;
  brand: string;
  brandAlternatives: string[];
  specification: string | null;
  specVersion: number | null;
  qty: string;
  unit: string;
  rate: string;
  rateVersion: number;
  rateStatus: string;
  total: string;
  phase: string;
  epc: string;
}
export type SelectedBrand = BrandMaster & { alternatives: string[] };
export function calculate(s: Survey, m: Masters) {
  if (s.family === "direct-product") return calculateDirectProducts(s, m);
  return calculateInstallation(s, m);
}
// Design verifies quantities before Coordination chooses commercial brands.
export function calculateTechnicalReview(s: Survey, m: Masters) {
  if (s.family === "direct-product") return calculateDirectProducts(s, m);
  return calculateInstallation(s, m, true);
}
function calculateInstallation(s: Survey, m: Masters, deferBrands = false) {
  const bessOnly = s.family === "bess-only";
  const approved = standardProfile(m);
  if (!bessOnly && (s.panelQty < 1 || new Decimal(s.panelWattage).lte(0)))
    throw new HttpError(400, "Enter positive panel quantity and wattage.");
  const customer = m.customers.find(
    (c) => c.id === s.customerId && c.status === "Active",
  );
  if (!customer) throw new HttpError(400, "Select an active customer.");
  const sp = singlePhaseConfigurations.find((c) => c.id === s.bessId);
  if (s.inverter === "6 kW SP" && !sp)
    throw new HttpError(400, "Select a supported single-phase BESS ID.");
  if (sp && (s.inverter !== "6 kW SP" || s.batteryKwh !== sp.batteryKwh))
    throw new HttpError(
      400,
      "Single-phase BESS ID does not match its equipment.",
    );
  if (s.bessId && !sp) {
    const bess = findBess(s.bessId);
    if (!bess) throw new HttpError(400, "Select a supported HV BESS ID.");
    if (s.inverter !== bess.inverter || s.batteryKwh !== bess.batteryKwh)
      throw new HttpError(
        400,
        "BESS ID does not match the inverter and battery configuration.",
      );
  }
  const config = m.inverters.find((i) => i.configuration === s.inverter);
  if (!config)
    throw new HttpError(400, "Select a supported inverter configuration.");
  if (
    sp &&
    (config.sku !== sp.inverterSku ||
      config.quantity !== 1 ||
      !new Decimal(config.total_kw).eq(6))
  )
    throw new HttpError(
      422,
      "Single-phase inverter master configuration is inconsistent. Ask an administrator to review it.",
    );
  const bankProfile =
    bessOnly && sp && approved
      ? bankUpsProfile(m, customer.short_code, s.batteryKwh)
      : undefined;
  if (
    bessOnly &&
    sp &&
    approved &&
    ["UBL", "MBL"].includes(customer.short_code) &&
    !bankProfile
  )
    throw new HttpError(400, "Select the customer-approved UPS configuration.");
  const allowances =
    !bessOnly && s.sourceMode === "General quotation"
      ? generalAllowances(s.panelQty, s.panelWattage, config.quantity)
      : undefined;
  const rule = (n: number) => {
    const v = m.rules.find((r) => r.key === `engineering-${n}`);
    if (!v) throw new HttpError(422, `Engineering rule ${n} is missing.`);
    return new Decimal(v.value);
  };
  const rnum = (n: number) => rule(n).toNumber();
  const selected: Record<string, SelectedBrand> = {};
  for (const [field, category] of Object.entries({
    solar: "Solar Panel",
    inverter: "Inverter",
    battery: "Battery & BMS",
    cable: "Cable",
    switchgear: "Switchgear",
  })) {
    if (deferBrands || (bessOnly && field === "solar")) continue;
    const b = m.brands.find(
      (b) =>
        b.id === s.brands[field as keyof Survey["brands"]] &&
        b.category === category &&
        b.status === "Active",
    );
    if (!b) throw new HttpError(400, `Select an active ${category} brand.`);
    const requested=s.brandSelections?.[field as keyof NonNullable<Survey['brandSelections']>];
    const options=requested?.length?[...new Set(requested)].map(id=>{const option=m.brands.find(x=>x.id===id&&x.category===category&&x.status==='Active'&&x.name!=='Any of the Above');if(!option)throw new HttpError(400,`Choose active ${category} brand options.`);return option;}):null;
    if(options&&(options.length>1?b.name!=='Any of the Above':b.id!==options[0].id))throw new HttpError(400,`Review the ${category} brand selection before costing.`);
    selected[field] = {
      ...b,
      alternatives:
        b.name === "Any of the Above"
          ? options?options.map(x=>x.name):m.brands
              .filter(
                (x) =>
                  x.category === category &&
                  x.status === "Active" &&
                  x.name !== "Any of the Above",
              )
              .map((x) => x.name)
          : [],
    };
  }
  const dual = config.quantity === 2,
    pv = bessOnly
      ? new Decimal(0)
      : new Decimal(s.panelWattage).mul(s.panelQty),
    modules = new Decimal(s.batteryKwh).div(rule(6));
  if (
    !modules.isInteger() ||
    !modules.div(config.quantity).isInteger() ||
    new Decimal(s.batteryKwh).gt(rule(8).mul(config.quantity))
  )
    throw new HttpError(
      400,
      "Battery must use module-sized steps and stay within the per-inverter limit.",
    );
  if (rnum(4) <= 0 || rnum(5) <= 0 || rnum(7) <= 0)
    throw new HttpError(
      422,
      "String and battery design limits must be positive.",
    );
  const spScope = sp
    ? singlePhaseScope({
        bessId: sp.id,
        panelQty: bessOnly ? 1 : s.panelQty,
        mode: s.sourceMode ?? "Survey",
        loadPanelRunMetres: s.spLoadPanelRunMetres,
        rooftopPerString: { fuseWithHolder: rnum(24), dcSpd: rnum(23) },
      })
    : undefined;
  if (spScope && spScope.strings > 2)
    throw new HttpError(
      400,
      "Single-phase design exceeds two MPPT string inputs. Revise the panel design.",
    );
  const strings = bessOnly
      ? 0
      : (spScope?.strings ??
        Math.max(
          1,
          1 + Math.ceil(Math.max(0, s.panelQty - rnum(4)) / rnum(5)),
        )),
    bms = sp
      ? new Decimal(sp.bmsQty)
      : modules.div(config.quantity).div(rule(7)).ceil().mul(config.quantity);
  const deferredBrandKeys = new Set<string>();
  const lines: CostLine[] = [],
    warnings: string[] = [];
  function add(
    key: string,
    qty: Decimal.Value,
    phase: string,
    brandField?: string,
    epc = "",
  ) {
    const q = new Decimal(qty);
    if (q.eq(0)) return;
    const rateKey=key==='Earthing Bore'&&customer?.short_code==='UBL'&&!bessOnly?'UBL Earthing Bore':key;
    const rate = m.rates.find((r) => r.key === rateKey);
    if (!rate || rate.rate === null || rate.status === "Inactive")
      throw new HttpError(422, `A usable rate is required for ${key}.`);
    const spec = m.items.find((i) => i.key === key);
    if (rate.status === "Needs Rate")
      warnings.push(
        `${key}: rate marked Needs Rate; current numeric rate used.`,
      );
    if (deferBrands && brandField) deferredBrandKeys.add(key);
    lines.push({
      key,
      description: key,
      brand: brandField ? selected[brandField]?.name ?? "" : "",
      brandAlternatives: brandField ? selected[brandField]?.alternatives ?? [] : [],
      specification:
        spec?.status === "Approved" ? spec.approved_specification : null,
      specVersion: spec?.version ?? null,
      qty: q.toString(),
      unit: rate.unit,
      rate: new Decimal(rate.rate).toString(),
      rateVersion: rate.version,
      rateStatus: rate.status,
      total: q.mul(rate.rate).toString(),
      phase,
      epc,
    });
  }
  add("Solar PV Modules", pv, "Solar Panels", "solar");
  add(`Structure - ${s.structure}`, pv, "Structure");
  add(config.sku, config.quantity, "BESS", "inverter");
  add(
    sp?.batterySku ?? "BAT-HV-05 KW WO BMS",
    sp?.batteryModules ?? modules,
    "BESS",
    "battery",
  );
  add(sp?.bmsSku ?? "CH-BMS-HV", bms, "BESS", "battery");
  if (!bankProfile)
    for (const [key, qty] of Object.entries({
      "6mm² DC Cable Red": bessOnly
        ? "0"
        : allowances
          ? new Decimal(allowances.dcRed)
          : new Decimal(s.dcMetres).div(2),
      "6mm² DC Cable Black": bessOnly
        ? "0"
        : allowances
          ? new Decimal(allowances.dcBlack)
          : new Decimal(s.dcMetres).div(2),
      "2.5mm² Earthing Cable": bessOnly
        ? "0"
        : (allowances?.earth25 ?? s.earth25),
      "6mm² Earthing Cable":
        bessOnly && !sp ? "0" : (allowances?.earth6 ?? s.earth6),
      "10mm² Earthing Cable":
        bessOnly && sp ? "0" : (allowances?.earth10 ?? s.earth10),
      "16mm² 4C AC Cable": sp
        ? "0"
        : bessOnly && s.sourceMode === "General quotation"
          ? dual
            ? "15"
            : "30"
          : allowances
            ? allowances.ac16
            : new Decimal(
                s.acTerminationMode === "Fixed"
                  ? config.quantity === 2
                    ? "15"
                    : "30"
                  : (s.acInverter16 ?? "0"),
              ).add(s.acPanel16 ?? "0"),
      "25mm² 4C AC Cable": sp
        ? "0"
        : bessOnly && s.sourceMode === "General quotation"
          ? dual
            ? "20"
            : "0"
          : allowances
            ? allowances.ac25
            : new Decimal(
                s.acTerminationMode === "Fixed"
                  ? config.quantity === 2
                    ? "20"
                    : "0"
                  : (s.acInverter25 ?? "0"),
              ).add(s.acPanel25 ?? "0"),
    }))
      add(key, qty, "EPC", "cable", "Installation Cost");
  if (bankProfile) {
    const p = bankProfile.payload;
    const cableItem = m.catalogue?.find(
      (i) => i.item_id === p.acCable.stockItemId,
    );
    if (!cableItem?.rate_key)
      throw new HttpError(422, "Customer UPS cable rate mapping is missing.");
    add(cableItem.rate_key, 4, "EPC", "cable", "Installation Cost");
    const ac = lines[lines.length - 1];
    ac.itemId = cableItem.item_id;
    ac.stockBrand = p.acCable.brand;
    ac.brand = p.acCable.brand;
    ac.description = `${p.acCable.sizeMm2}mm² single-core AC cable: input 1 MTRS red + 1 MTRS black; output 1 MTRS red + 1 MTRS black`;
    add("2.5mm² Earthing Cable", 1, "EPC", "cable", "Installation Cost");
    lines[lines.length - 1].brand = p.acCable.brand;
    add("63A 1P AC VPD", 1, "EPC", "switchgear", "Installation Cost");
    add("CH-5WAY-DB", 1, "EPC", undefined, "Installation Cost");
  } else if (spScope) {
    const termination =
      s.sourceMode !== "General quotation" && s.acTerminationMode === "Measured"
        ? (s.spInverterTerminationMetres ?? spScope.cable.fixedTotalMetres)
        : spScope.cable.fixedTotalMetres;
    add(
      "10mm² 1C AC Cable",
      new Decimal(termination).plus(spScope.cable.loadPanelConductorMetres),
      "EPC",
      "cable",
      "Installation Cost",
    );
    const cable = lines.find((l) => l.key === "10mm² 1C AC Cable");
    if (cable)
      cable.description = `10mm² single-core AC cable\nInverter termination (${termination} m): ${singlePhaseCableDescription(termination)}\nLoad-panel termination (${spScope.cable.loadPanelConductorMetres} m): ${singlePhaseCableDescription(spScope.cable.loadPanelConductorMetres)}`;
    for (const [key, qty] of Object.entries({
      "500V 2P DC Breaker": bessOnly ? 0 : spScope.dc.totalBreakers,
      "DC SPD": bessOnly ? 0 : spScope.dc.rooftopSpd,
      "DC Fuse with Holder": bessOnly ? 0 : spScope.dc.rooftopFuseWithHolder,
      "63A 2P MCB": 1,
      "32A 2P MCB": 1,
      "32A 2P Breaker Changeover": 1,
      "63A 1P AC VPD": 1,
    }))
      add(key, qty, "EPC", "switchgear", "Installation Cost");
    add(
      "SP AC Conduit Accessories and Box",
      1,
      "EPC",
      undefined,
      "Installation Cost",
    );
    add(
      "SP DC Enclosures",
      bessOnly ? 0 : 1,
      "EPC",
      undefined,
      "Installation Cost",
    );
    warnings.push(
      "Single-phase design requires electrical verification before release. SP accessory and enclosure costs are owner-confirmed; protection specifications remain subject to verification.",
    );
  } else {
    for (const [key, qty] of Object.entries({
      "DC Breaker": rule(22).mul(strings),
      "DC SPD": rule(23).mul(strings),
      "DC Fuse with Holder": rule(24).mul(strings),
      "63A 4P MCB": rule(dual ? 16 : 14),
      "100A 4P MCCB": rule(dual ? 17 : 15),
      [approved && !dual
        ? "63A 4P Changeover"
        : "100A Rotary Changeover with Box"]: rule(18),
      "AC SPD": rule(19),
    }))
      add(key, qty, "EPC", "switchgear", "Installation Cost");
    add(
      "AC & DC Boxes",
      approved ? 1 : rule(20),
      "EPC",
      undefined,
      "Installation Cost",
    );
  }
  add(
    "Earthing Bore",
    bankProfile || s.spIncludeEarthingBore === false
      ? 0
      : bessOnly
        ? 1
        : approved
          ? approved.solarBores
          : rule(13),
    "EPC",
    undefined,
    "Earthing Cost",
  );
  const fixedCharge = (
    key: string,
    qty: number,
    rate: string,
    unit: string,
    description: string,
    epc: (typeof lines)[number]["epc"],
  ) => {
    const spec = m.items.find((i) => i.key === key);
    lines.push({
      key,
      description,
      brand: "",
      brandAlternatives: [],
      specification: spec?.approved_specification ?? null,
      specVersion: spec?.version ?? null,
      qty: String(qty),
      unit,
      rate,
      rateVersion: 0,
      rateStatus: "Active",
      total: new Decimal(qty).mul(rate).toString(),
      phase: "EPC",
      epc,
    });
  };
  if (sp && !approved)
    fixedCharge(
      "Misc. Accessories",
      1,
      "45000",
      "LS",
      "Miscellaneous accessories",
      "Installation Cost",
    );
  else if (!sp)
    add("Misc. Accessories", rule(21), "EPC", undefined, "Installation Cost");
  if (sp || bessOnly) {
    fixedCharge(
      "Labour",
      config.quantity,
      bankProfile ? "5000" : sp ? "15000" : "50000",
      approved ? "JOB" : "Inverter",
      sp
        ? "Single-phase installation per inverter"
        : "UPS installation per inverter",
      "Electrical Labour",
    );
    fixedCharge(
      "Delivery",
      1,
      bankProfile ? "5000" : sp ? "15000" : "50000",
      approved ? "JOB" : "Project",
      "Project delivery",
      "Deliveries",
    );
  } else {
    add("Labour", pv, "EPC", undefined, "Electrical Labour");
    add("Delivery", pv, "EPC", undefined, "Deliveries");
  }
  if (bessOnly) {
    const box = lines.find((l) => l.key === "AC & DC Boxes");
    if (box) box.description = "AC protection / distribution boxes";
  }
  if (s.smartMeter)
    add("Extra Smart Meter", 1, "EPC", undefined, "Installation Cost");
  if (s.genset)
    add(
      "Genset Synchronisation with Battery SOC",
      1,
      "EPC",
      undefined,
      "Installation Cost",
    );
  if (s.additionalItem) {
    const a = s.additionalItem;
    lines.push({
      key: "Additional Item",
      description: a.description,
      specification: a.specification || null,
      specVersion: null,
      brand: "",
      brandAlternatives: [],
      qty: a.qty,
      unit: a.unit,
      rate: a.unitCost,
      rateVersion: 0,
      rateStatus: "Active",
      total: new Decimal(a.qty).mul(a.unitCost).toString(),
      phase: "EPC",
      epc: "Installation Cost",
    });
  }
  for (const [key, specification] of Object.entries(s.specifications ?? {})) {
    if (!m.rates.some((r) => r.key === key) && key !== "Additional Item")
      throw new HttpError(
        400,
        "Choose an existing BOQ item for a technical specification override.",
      );
    const l = lines.find((x) => x.key === key);
    if (l) {
      l.specification = specification;
      l.specVersion = null;
    }
  }
  identifyLines(m, lines.filter(line => !deferredBrandKeys.has(line.key)), s, warnings);
  const total = lines.reduce((a, l) => a.add(l.total), new Decimal(0));
  const summary = (
    bessOnly ? ["BESS", "EPC"] : ["Solar Panels", "Structure", "BESS", "EPC"]
  ).map((phase) => {
    const cost = lines
      .filter((l) => l.phase === phase)
      .reduce((a, l) => a.add(l.total), new Decimal(0));
    return {
      name: phase,
      cost: cost.toString(),
      perWatt: pv.isZero() ? "0.00" : cost.div(pv).toFixed(2),
    };
  });
  const epc = [
    "Electrical Labour",
    "Earthing Cost",
    "Deliveries",
    "Installation Cost",
  ].map((name) => {
    const cost = lines
      .filter((l) => l.epc === name)
      .reduce((a, l) => a.add(l.total), new Decimal(0));
    return {
      name,
      cost: cost.toString(),
      perWatt: pv.isZero() ? "0.00" : cost.div(pv).toFixed(2),
    };
  });
  return {
    customer: {
      id: customer.id,
      name: customer.name,
      shortCode: customer.short_code,
    },
    survey: s,
    selectedBrands: selected,
    engineering: {
      pvWatts: pv.toString(),
      pvKwp: pv.div(1000).toString(),
      strings,
      batteryModules: modules.toString(),
      bms: bms.toString(),
      bmsRuleVersion: sp ? "sp-single-bank-2026-10-08-v1" : BESS_RULE_VERSION,
      bmsPerInverter: bms.div(config.quantity).toString(),
      batteryPerInverter: new Decimal(s.batteryKwh)
        .div(config.quantity)
        .toString(),
      ...(spScope ? { singlePhaseScope: spScope, releaseReady: false } : {}),
      bessId: sp?.id ?? `${new Decimal(config.total_kw)}-${s.batteryKwh}`,
      solutionId: bessOnly
        ? `UPS-${new Decimal(config.total_kw)}-${s.batteryKwh}`
        : `${pv.div(1000).toDecimalPlaces(1, Decimal.ROUND_HALF_UP)}-${new Decimal(config.total_kw)}-${s.batteryKwh}`,
    },
    lines,
    summary,
    epc,
    total: total.toString(),
    perWatt: pv.isZero() ? "0.00" : total.div(pv).toFixed(2),
    warnings,
    rules: m.rules,
    inverterConfig: config,
    classifications: m.classifications,
    ...(allowances
      ? {
          generalAllowances: {
            version: GENERAL_ALLOWANCE_VERSION,
            ...allowances,
          },
        }
      : {}),
    directProductGroups: undefined as
      ReturnType<typeof directProductGroups> | undefined,
    ...(approved
      ? {
          masterRuleVersion: "owner-approved-2026-10-12-v1",
          customerRuleProfile: bankProfile?.key,
          customerRuleVersion: bankProfile?.version,
        }
      : {}),
    engineVersion: 1,
  };
}

export type BoqSnapshot = ReturnType<typeof calculateInstallation>;
