// These DOs have site-signed delivery evidence in Operations. QC can review
// their quantities while the warehouse still owns gate filing and stock posting.
const reviewedDispatches: Record<string, readonly string[]> = {
  'live-ipo:0f71c963-15fd-41d5-a95a-fae37dafbf33': ['0b6821fd-3bc3-4a63-9287-0aa9620c6edd'],
  'live-ipo:fb4d80e4-55ee-46ed-bba8-97c927afb06e': ['234233c4-3801-4e6d-a8ab-1540b954b2e2'],
  'registered-UBL:UPS:176/250': ['ca636da9-db6b-466e-a9e6-4db0af19c2c2', 'f5ffca24-16cc-4d7a-9670-85e37f0b19bc'],
  'registered-UBL:UPS:178/250': ['99a358fd-9d6f-4d3a-ac6a-5df89f0e9547', 'f5ffca24-16cc-4d7a-9670-85e37f0b19bc'],
};

export function qcReviewedDispatchIds(boardSiteId?: string): readonly string[] {
  return boardSiteId ? reviewedDispatches[boardSiteId] ?? [] : [];
}

export const qcReviewedDispatches = [...new Set(Object.values(reviewedDispatches).flat())];

export function qcDispatchQuantities(lines: {key: string; quantity: string}[]): string {
  return JSON.stringify(lines.map(line => [line.key, line.quantity]).sort(([a], [b]) => a.localeCompare(b)));
}
