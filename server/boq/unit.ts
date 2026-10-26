/** Canonical document UOM for cable lengths; source master units remain unchanged. */
export function displayUnit(unit: string, _quantity: string) {
  return /^(m|mtrs|metre|meter)s?$/i.test(unit.trim()) ? "MTRS" : unit;
}
