import { Decimal } from "decimal.js";
export const GENERAL_ALLOWANCE_VERSION = "general-cables-2026-10-v1";
/** User-approved allowances; quantities are metres and PV capacity is watts. */
export function generalAllowances(
  panelQty: number,
  panelWattage: string,
  inverterQuantity: number,
) {
  const watts = new Decimal(panelWattage || "0").mul(panelQty);
  return {
    pvWatts: watts.toString(),
    dcRed: watts.mul("0.0045").toString(),
    dcBlack: watts.mul("0.0045").toString(),
    dcMetres: watts.mul("0.009").toString(),
    earth25: watts.mul("0.00075").toString(),
    earth6: watts.mul("0.003").toString(),
    earth10: watts.mul("0.003").toString(),
    ac16: inverterQuantity === 2 ? "15" : "30",
    ac25: inverterQuantity === 2 ? "20" : "0",
  };
}
