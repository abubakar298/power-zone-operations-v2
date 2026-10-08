export function displayUnit(unit: string, quantity: string) {
  return /^(metre|meter)s?$/i.test(unit) ? (Number(quantity) === 1 ? "meter" : "meters") : unit;
}
