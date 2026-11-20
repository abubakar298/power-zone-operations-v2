import { recentFirst } from "./recent-records.js";

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

type SharedIpo = { data: { ipoNumber?: string | null; sharedOrderNumber?: string | null } };

function orderSequence(order: string | null | undefined): number {
  const match = order?.trim().match(/^(\d+)(?:\s*\/\s*\d+)?$/);
  return match ? Number(match[1]) : -1;
}

/** A shared IPO saves the bank order as one text "213/250": the permanent running order number and the
 * IPO's target site count. They are different values (the order number can pass the target when orders
 * are cancelled), so they are shown separately, never as a progress fraction. */
export function splitSharedOrder(order: string | null | undefined): { orderNo: string; target: string | null } | null {
  const match = order?.trim().match(/^(\d+)(?:\s*\/\s*(\d+))?$/);
  return match ? { orderNo: match[1], target: match[2] ?? null } : null;
}

/** "Order No. 213 · Target Sites 250"; text that is not a number pair is shown unchanged. */
export function sharedOrderLabel(order: string | null | undefined): string | null {
  if (!order?.trim()) return null;
  const parts = splitSharedOrder(order);
  if (!parts) return order.trim();
  return `Order No. ${parts.orderNo}${parts.target ? ` · Target Sites ${parts.target}` : ""}`;
}

export function sortSharedIpos<T extends SharedIpo>(records: readonly T[]): T[] {
  return recentFirst(records).sort((a, b) => {
    const first = a.data.ipoNumber?.trim() ?? "";
    const second = b.data.ipoNumber?.trim() ?? "";
    return natural.compare(second, first)
      || orderSequence(b.data.sharedOrderNumber) - orderSequence(a.data.sharedOrderNumber);
  });
}
