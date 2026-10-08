/** Equipment identity is independent of the surrounding installation/sales scope. */
export type ApplicationScope = "SOLAR_HYBRID" | "BESS_UPS" | "DIRECT_PRODUCT" | "CNI_BESS";
export function batteryBanks(totalKwh: number, inverterQty: number) {
  if (!Number.isSafeInteger(inverterQty) || inverterQty < 1 || inverterQty > 2)
    throw new Error("Use one or two approved inverter banks.");
  if (!Number.isSafeInteger(totalKwh) || totalKwh <= 0 || totalKwh % (5 * inverterQty) !== 0)
    throw new Error("Each inverter bank requires whole 5 kWh battery modules.");
  const kwh = totalKwh / inverterQty;
  if (kwh > 60) throw new Error("Each inverter bank supports at most 60 kWh.");
  const modules = kwh / 5;
  const bms = Math.ceil(modules / 4);
  return Array.from({ length: inverterQty }, (_, index) => ({ inverter: index + 1, kwh, modules, bms }));
}

/** Defined for engineering validation; not added to the live HV quotation selector. */
export const singlePhaseConfigurations = Array.from({ length: 12 }, (_, index) => {
  const batteryKwh = (index + 1) * 5;
  const banks = batteryBanks(batteryKwh, 1);
  return {
    id: `6-${batteryKwh}`,
    phase: "Single phase" as const,
    voltageLevel: "LV" as const,
    inverterSku: "HYB-SP-006",
    inverterQty: 1,
    inverterKw: 6,
    batterySku: "BAT-LV-05 KW WO BMS",
    bmsSku: "CH-BMS-LV",
    batteryKwh,
    batteryModules: banks[0].modules,
    bmsQty: banks[0].bms,
    banks,
  };
});
