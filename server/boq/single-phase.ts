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
function singlePhaseTermination(inverterQty: 1 | 2) {
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
function singlePhaseRequirements(input: Parameters<typeof singlePhaseScope>[0]) {
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
