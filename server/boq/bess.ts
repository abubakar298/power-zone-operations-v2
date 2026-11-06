export const BESS_RULE_VERSION = "hv-bess-per-inverter-2026-10-07";
/** Owner-approved HV configurations. LV and on-grid deliberately deferred. */
export const bessConfigurations = [10, 12, 15, 20, 24, 30, 40].flatMap(
  (totalKw) => {
    const inverterQty = totalKw > 20 ? 2 : 1;
    const inverterKw = totalKw / inverterQty;
    return (
      inverterQty === 2 ? [20, 30, 40, 60, 80, 120] : [10, 15, 20, 30, 40, 60]
    ).map((batteryKwh) => ({
      id: `BESS-${totalKw}-${batteryKwh}`,
      inverter: `${inverterQty === 2 ? "2×" : ""}${inverterKw} kW`,
      inverterQty,
      inverterKw,
      batteryKwh,
      batteryModules: batteryKwh / 5,
      bmsQty: inverterQty * Math.ceil(batteryKwh / inverterQty / 20),
    }));
  },
);
export function findBess(id: string) {
  return bessConfigurations.find((b) => b.id === id);
}
export function legacyBess(inverter: string, batteryKwh: number) {
  return (
    bessConfigurations.find(
      (b) => b.inverter === inverter && b.batteryKwh === batteryKwh,
    )?.id ?? ""
  );
}
