import { Decimal } from "decimal.js";
/** Total single-core conductor metres across input/output and line/neutral. */
export function singlePhaseCableDescription(totalMetres: string) {
  const total = new Decimal(totalMetres || "0");
  const half = total.div(2).toString(), quarter = total.div(4).toString();
  return `${half} m input + ${half} m output (${quarter} m line + ${quarter} m neutral each). Total: ${half} m red + ${half} m black.`;
}
