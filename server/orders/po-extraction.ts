import type { OrderInput } from "./schema.js";
// Suggest only uniquely labelled fields. Never guess tax IDs, dates or addresses.
export function poSuggestions(text: string): Partial<OrderInput> {
  const out: Partial<OrderInput> = {};
  const fields: [keyof OrderInput, RegExp][] = [
    [
      "poNumber",
      /^(?:customer\s+)?(?:purchase order|po|p\.o\.)\s*(?:number|no\.?|reference|ref\.?)?\s*[:#]\s*(.+)$/i,
    ],
    [
      "orderDate",
      /^(?:(?:purchase order|po)\s+)?(?:order\s+)?date\s*:\s*(.+)$/i,
    ],
    ["customerNtn", /^(?:customer\s+)?ntn\s*(?:no\.?)?\s*:\s*(.+)$/i],
    ["customerStrn", /^(?:customer\s+)?strn\s*(?:no\.?)?\s*:\s*(.+)$/i],
    ["billingAddress", /^(?:billing address|bill to address)\s*:\s*(.+)$/i],
  ];
  for (const [field, pattern] of fields) {
    const values = [
      ...new Set(
        text
          .split(/\r?\n/)
          .map((line) => line.trim().match(pattern)?.[1]?.trim())
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (values.length !== 1) continue;
    const value = values[0];
    if (field === "orderDate") {
      // Numeric day/month dates are ambiguous; accept ISO or a named month only.
      let iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
      if (
        /^(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/.test(
          value,
        )
      ) {
        const d = new Date(value + " UTC");
        if (!Number.isNaN(d.valueOf())) iso = d.toISOString().slice(0, 10);
      }
      if (
        iso &&
        !Number.isNaN(Date.parse(iso)) &&
        new Date(iso).toISOString().slice(0, 10) === iso
      )
        out.orderDate = iso;
    } else if (
      value.length <=
      (field === "billingAddress" ? 1000 : field === "poNumber" ? 100 : 300)
    ) {
      Object.assign(out, { [field]: value });
    }
  }
  return out;
}
