// Display order only: rates, permissions and costing remain unchanged.
const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
function rank(key: string): number[] {
  const k = key.toLowerCase();
  const size = Number(k.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  if (/hyb|inverter/.test(k) && !/breaker|changeover|change.over|termination|room|cable/.test(k)) {
    const capacity = Number(k.match(/(?:hyb-(?:sp|3p)-)(\d+)/)?.[1] ?? size);
    return [0, 0, capacity];
  }
  if (/bat-|battery/.test(k) && !/cable|synchron/.test(k)) return [0, /lv|low voltage/.test(k) ? 1 : 2, size];
  if (/bms/.test(k)) return [0, /lv|low voltage/.test(k) ? 3 : 4, size];
  if (/cable/.test(k)) {
    const family = /earthing|earth cable/.test(k) ? 1 : /dc/.test(k) ? 0 : /4c|4.core/.test(k) ? 3 : 2;
    return [1, family, size, /red/.test(k) ? 0 : /black/.test(k) ? 1 : 2];
  }
  if (/breaker|mcb|mccb|changeover|change.over|spd|vpd|fuse/.test(k)) {
    const dc = /dc|fuse/.test(k);
    const type = /changeover|change.over/.test(k) ? 1 : /fuse/.test(k) ? 1 : /spd/.test(k) ? 2 : /vpd/.test(k) ? 3 : 0;
    const amps = Number(k.match(/(\d+)\s*a(?:\b|(?=\d))/)?.[1] ?? 0);
    const poles = Number(k.match(/(\d+)\s*p(?:\b|ole)/)?.[1] ?? 0);
    return [dc ? 3 : 2, type, amps, poles];
  }
  return [4];
}
export function compareRateItems(a: string, b: string): number {
  const ar = rank(a), br = rank(b);
  for (let i = 0; i < Math.max(ar.length, br.length); i++) {
    const difference = (ar[i] ?? 0) - (br[i] ?? 0);
    if (difference) return difference;
  }
  return natural.compare(a, b);
}
