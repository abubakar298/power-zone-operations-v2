import { Decimal } from "decimal.js";
import { singlePhaseConfigurations } from "./equipment.js";

/** Operational allowances only. Datasheet/rating verification is a separate release gate. */
export function singlePhaseScope(input: {
  bessId: string;
  panelQty: number;
  mode: "Survey" | "General quotation";
  loadPanelRunMetres?: string;
  rooftopPerString: { fuseWithHolder: number; dcSpd: number };
}) {
  const equipment = singlePhaseConfigurations.find(c => c.id === input.bessId);
  if (!equipment) throw new Error("Select an approved single-inverter 6 kW configuration. Dual configurations are pending engineering approval.");
  if (!Number.isSafeInteger(input.panelQty) || input.panelQty < 1 || input.panelQty > 1_000_000)
    throw new Error("Enter a positive whole panel quantity.");
  for (const count of Object.values(input.rooftopPerString))
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Use the approved rooftop fuse/SPD quantities per string.");
  const estimated = input.mode === "General quotation";
  const rawRun = estimated ? "20" : input.loadPanelRunMetres;
  if (!rawRun || !/^\d{1,8}(\.\d{1,4})?$/.test(rawRun))
    throw new Error("Enter the measured load-panel cable run in meters.");
  const run = new Decimal(rawRun);
  const strings = Math.ceil(input.panelQty / 10);
  return {
    equipment,
    strings,
    operationalModulesPerStringMax: 10,
    electricalVerification: "Pending approved inverter/module datasheets and protection specifications" as const,
    releaseReady: false as const,
    dc: {
      breakerPoles: 2,
      breakerVolts: 500,
      roomBreakers: strings,
      rooftopBreakers: strings,
      totalBreakers: strings * 2,
      rooftopFuseWithHolder: strings * input.rooftopPerString.fuseWithHolder,
      rooftopSpd: strings * input.rooftopPerString.dcSpd,
    },
    ac: { inputAmps: 63, outputAmps: 32, changeoverAmps: 32, poles: 2, vpdRequired: true, acSpdQty: 0 },
    cable: {
      sizeMm2: 10,
      cores: 1,
      fixedPhaseMetres: "10",
      fixedNeutralMetres: "10",
      fixedTotalMetres: singlePhaseTermination(1).totalMetres,
      loadPanelRunMetres: run.toString(),
      loadPanelConductorMetres: run.mul(2).toString(),
      loadPanelBasis: estimated ? "Estimated Quick BOQ allowance" : "Measured survey run",
    },
  };
}

/** Owner-confirmed physical termination quantities; does not approve dual protection or IDs. */
export function singlePhaseTermination(inverterQty: 1 | 2) {
  if (inverterQty !== 1 && inverterQty !== 2) throw new Error("Use one or two 6 kW inverters.");
  const circuits = inverterQty === 2
    ? [{ port: "input", lineMetres: "7.5", neutralMetres: "7.5" },
       { port: "output", lineMetres: "7.5", neutralMetres: "7.5" }]
    : [{ port: "input", lineMetres: "5", neutralMetres: "5" },
       { port: "output", lineMetres: "5", neutralMetres: "5" }];
  const perInverter = circuits.reduce((sum, c) => sum.plus(c.lineMetres).plus(c.neutralMetres), new Decimal(0));
  return { sizeMm2: 10, cores: 1, inverterQty, circuitsPerInverter: circuits,
    perInverterMetres: perInverter.toString(), totalMetres: perInverter.mul(inverterQty).toString() };
}

/** Exact equipment/material requirements for the SP costing adapter.
 * Rates are supplied by the authorized master-data layer, never embedded here.
 * This manifest is not electrical certification or permission to submit an unsafe design.
 */
export function singlePhaseRequirements(input: Parameters<typeof singlePhaseScope>[0]) {
  const scope = singlePhaseScope(input);
  const equipment = scope.equipment;
  const requirements = [
    { role: "inverter", itemKey: equipment.inverterSku, quantity: String(equipment.inverterQty), unit: "Each" },
    { role: "battery", itemKey: equipment.batterySku, quantity: String(equipment.batteryModules), unit: "Each" },
    { role: "bms", itemKey: equipment.bmsSku, quantity: String(equipment.bmsQty), unit: "Each" },
    { role: "inverter-termination", quantity: scope.cable.fixedTotalMetres, unit: "Metre", sizeMm2: 10, cores: 1 },
    { role: "load-panel-termination", quantity: scope.cable.loadPanelConductorMetres, unit: "Metre", sizeMm2: 10, cores: 1 },
    { role: "dc-room-breaker", quantity: String(scope.dc.roomBreakers), unit: "Each", poles: 2, volts: 500 },
    { role: "dc-rooftop-breaker", quantity: String(scope.dc.rooftopBreakers), unit: "Each", poles: 2, volts: 500 },
    { role: "dc-fuse-holder", quantity: String(scope.dc.rooftopFuseWithHolder), unit: "Each" },
    { role: "dc-spd", quantity: String(scope.dc.rooftopSpd), unit: "Each" },
    { role: "ac-input-breaker", quantity: "1", unit: "Each", poles: 2, amps: 63 },
    { role: "ac-output-breaker", quantity: "1", unit: "Each", poles: 2, amps: 32 },
    { role: "ac-changeover-breaker", quantity: "1", unit: "Each", poles: 2, amps: 32 },
    { role: "ac-vpd", quantity: "1", unit: "Each", location: "AC protection box" },
  ];
  return { scope, requirements, operationalVoltageLimit: 500, mpptCount: 2,
    designWarnings: scope.strings > 2
      ? ["More strings than the two available MPPT inputs; revise the design before approval."] : [],
    releaseReady: false as const };
}

/** Fail closed on missing master mappings/rates rather than pricing a partial SP BOQ. */
export function priceSinglePhaseRequirements(
  input: Parameters<typeof singlePhaseScope>[0],
  mappings: Record<string, string>,
  rates: { key: string; rate: string | null; version: number; status: string }[],
) {
  const manifest = singlePhaseRequirements(input);
  const lines = manifest.requirements.filter(line => new Decimal(line.quantity).gt(0)).map(line => {
    const key = "itemKey" in line && line.itemKey ? line.itemKey : mappings[line.role];
    if (!key) throw new Error(`Approved item mapping required for ${line.role}.`);
    const matches = rates.filter(rate => rate.key === key);
    if (matches.length !== 1) throw new Error(`Exactly one current master rate required for ${key}.`);
    const rate = matches[0];
    if (rate.status !== "Active" || rate.rate === null || !/^\d+(\.\d+)?$/.test(rate.rate))
      throw new Error(`Active confirmed numeric rate required for ${key}.`);
    return { ...line, key, rate: new Decimal(rate.rate).toString(), rateVersion: rate.version,
      total: new Decimal(line.quantity).mul(rate.rate).toString() };
  });
  return { ...manifest, lines,
    equipmentAndProtectionTotal: lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0)).toString(),
    scopeLabel: "Equipment, AC cable and protection only; not a complete installed project BOQ" };
}

/** Owner screenshot, 8 October 2026. Tax basis is unconfirmed; do not add GST automatically. */
export const singlePhaseAcCostReference = {
  version: "owner-sp-ac-2026-10-08-v1",
  taxBasis: "Unconfirmed",
  inputBreaker: { specification: "AC MCB 63A, 2-Pole", unitRate: "1045", unit: "Each" },
  outputBreaker: { specification: "AC MCB 32A, 2-Pole", unitRate: "1045", unit: "Each" },
  vpd: { specification: "VPD 63A, 1-Pole", unitRate: "4950", unit: "Each", location: "AC protection box" },
  changeover: { specification: "32A, 2-Pole breaker type", unitRate: "2290", unit: "Each" },
  cable: { specification: "AC Cable 10 mm² 1-Core (Stranded/Flexible)", unitRate: "720", unit: "Metre" },
  accessoriesAndBox: { specification: 'Conduit 1.5 inch / 2 inch as site; lugs, ferrules, termination kits; 5-way AC combiner box',
    unitRate: "5000", unit: "Set", basis: "Owner-approved temporary combined project allowance; actual cost expected higher and review required", provisional: true },
} as const;

export function singlePhaseAcReferenceCost(loadPanelRunMetres: string) {
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(loadPanelRunMetres)) throw new Error("Enter a measured cable run.");
  const rates = singlePhaseAcCostReference;
  const lines = [
    { role: "ac-input-breaker", quantity: "1", ...rates.inputBreaker },
    { role: "ac-output-breaker", quantity: "1", ...rates.outputBreaker },
    { role: "ac-vpd", quantity: "1", ...rates.vpd },
    { role: "ac-changeover-breaker", quantity: "1", ...rates.changeover },
    { role: "inverter-termination", quantity: "20", ...rates.cable },
    { role: "load-panel-termination", quantity: new Decimal(loadPanelRunMetres).mul(2).toString(), ...rates.cable },
    { role: "ac-accessories-and-box", quantity: "1", ...rates.accessoriesAndBox },
  ].map(line => ({ ...line, total: new Decimal(line.quantity).mul(line.unitRate).toString() }));
  return { version: rates.version, taxBasis: rates.taxBasis, lines,
    total: lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0)).toString() };
}
