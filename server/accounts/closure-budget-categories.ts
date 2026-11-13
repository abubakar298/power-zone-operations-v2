import { Decimal } from 'decimal.js';
import { closureEpcItems } from './phase-comparison.js';
import { solarEpcLineCategory } from '../ubl/solar-epc.js';

type FrozenLine = { key: string; description?: string; phase: string; epc?: string; total: string };
type CostingBasis = { isUblSolar: boolean; isBankUps: boolean; lines: FrozenLine[] };

export function closureEpcCategory(line: FrozenLine, isUblSolar: boolean) {
  return isUblSolar ? solarEpcLineCategory(line) : line.epc || 'Installation Cost';
}

function sum(lines: FrozenLine[]) {
  return lines.reduce((total, line) => total.add(line.total), new Decimal(0));
}

/** Repair a classification in the review projection using the exact issued BOQ.
 * Preserve recorded actuals, approvals and the approved budget and selling totals. */
export function correctedClosureCategories(snapshot: any, basis?: CostingBasis) {
  if (!basis || !Array.isArray(basis.lines)) return snapshot;
  let result = snapshot;
  if (basis.isUblSolar && snapshot.epcBudget && snapshot.budget?.EPC != null) {
    const epc = basis.lines.filter(line => line.phase === 'EPC');
    const delta = closureEpcItems.map(name => {
      const old = sum(epc.filter(line => closureEpcCategory(line, false) === name));
      const corrected = sum(epc.filter(line => closureEpcCategory(line, true) === name));
      return { name, old, delta: corrected.sub(old) };
    });
    // Apply only to a saved breakdown with the old classifications. Extra scope can
    // be present in Installation Cost, but it must still reconcile with EPC.
    const original = delta.map(({name}) => new Decimal(snapshot.epcBudget[name] ?? -1));
    if (delta.some(row => !row.delta.isZero()) &&
        delta.every(({name, old}, i) => name === 'Installation Cost'
          ? original[i].gte(old.toDecimalPlaces(2))
          : original[i].eq(old.toDecimalPlaces(2))) &&
        original.reduce((total, value) => total.add(value), new Decimal(0)).eq(snapshot.budget.EPC)) {
      const adjusted = delta.map((row, i) => original[i].add(row.delta).toDecimalPlaces(2));
      if (adjusted.every(value => value.gte(0)) &&
          adjusted.reduce((total, value) => total.add(value), new Decimal(0)).eq(snapshot.budget.EPC)) {
        result = { ...result, epcBudget: Object.fromEntries(delta.map(({name}, i) => [name, adjusted[i].toFixed(2)])) };
      }
    }
  }
  if (basis.isBankUps && snapshot.budget?.BMS != null && snapshot.budget?.Batteries != null) {
    const bms = sum(basis.lines.filter(line => /^(CH-BMS-|BMS-)/i.test(line.key)));
    const batteries = sum(basis.lines.filter(line => line.phase === 'BESS' && /^(CH-BAT-|BAT-)/i.test(line.key)));
    if (bms.gt(0) && new Decimal(snapshot.budget.BMS).isZero() &&
        new Decimal(snapshot.budget.Batteries).eq(batteries.add(bms).toDecimalPlaces(2))) {
      const total = new Decimal(snapshot.budget.Batteries);
      const bmsCost = bms.toDecimalPlaces(2);
      result = { ...result, budget: { ...snapshot.budget, BMS: bmsCost.toFixed(2), Batteries: total.sub(bmsCost).toFixed(2) } };
    }
  }
  if (basis.isBankUps && result.phaseSelling?.Installations != null && result.phaseSelling.EPC == null) {
    const { Installations, ...phases } = result.phaseSelling;
    result = { ...result, phaseSelling: { ...phases, EPC: Installations } };
  }
  return result;
}
