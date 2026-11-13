import { recentFirst } from "./recent-records.js";

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

type SharedIpo = { data: { ipoNumber?: string | null; sharedOrderNumber?: string | null } };

function orderSequence(order: string | null | undefined): number {
  const match = order?.trim().match(/^(\d+)(?:\s*\/\s*\d+)?$/);
  return match ? Number(match[1]) : -1;
}

export function sortSharedIpos<T extends SharedIpo>(records: readonly T[]): T[] {
  return recentFirst(records).sort((a, b) => {
    const first = a.data.ipoNumber?.trim() ?? "";
    const second = b.data.ipoNumber?.trim() ?? "";
    return natural.compare(second, first)
      || orderSequence(b.data.sharedOrderNumber) - orderSequence(a.data.sharedOrderNumber);
  });
}
