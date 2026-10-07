import { Decimal } from "decimal.js";

/** Display only: retain decimal precision without converting money to Number. */
export function decimalDisplay(
  value: string | number | null | undefined,
  places = 2,
): string {
  if (value === null || value === undefined || value === "")
    return "Not entered";
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) return "Not available";
    const [whole, fraction] = decimal
      .toFixed(places, Decimal.ROUND_HALF_UP)
      .split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
  } catch {
    return "Not available";
  }
}

export const money = (value: string | number | null | undefined) =>
  decimalDisplay(value, 2);
