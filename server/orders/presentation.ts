import { Decimal } from "decimal.js";
export function ipoPresentation(snapshot: any) {
  const presentation =
    snapshot.peachtree?.presentation ?? snapshot.presentation ?? "Full Breakup";
  const included =
    (snapshot.peachtree?.taxMode ?? snapshot.taxMode) === "Tax Included";
  const source = snapshot.allocation.lines.filter(
    (l: any) => Number(l.qty) > 0 || Number(l.total) > 0,
  );
  const sum = (ls: any[], key: string) =>
    ls.reduce((v: Decimal, l: any) => v.add(l[key]), new Decimal(0)).toFixed(2);
  const groups: any[][] =
    presentation === "No Breakup"
      ? [source]
      : presentation === "Basic Breakup"
        ? [...new Set(source.map((l: any) => l.group))].map((group) =>
            source.filter((l: any) => l.group === group),
          )
        : source.map((l: any) => [l]);
  const rows = groups.map((ls) => {
    const combined = ls.length > 1 || presentation === "No Breakup";
    const amount = sum(ls, included ? "total" : "beforeTax"),
      qty = combined ? "1" : ls[0].qty;
    return {
      description: ls
        .map((l) =>
          combined ? `${l.description} (${l.qty} ${l.unit})` : l.description,
        )
        .join("\n"),
      qty,
      unit: combined ? "LS" : ls[0].unit,
      amount,
      rate: new Decimal(qty).gt(0)
        ? new Decimal(amount).div(qty).toFixed(6)
        : "0",
      taxRate: included
        ? "0"
        : [...new Set(ls.map((l) => l.taxRate))].join(" / "),
      tax: included ? "0.00" : sum(ls, "tax"),
      total: sum(ls, "total"),
    };
  });
  return {
    presentation,
    included,
    rows,
    amount: included ? snapshot.allocation.total : snapshot.allocation.subtotal,
    tax: included ? "0.00" : snapshot.allocation.tax,
    total: snapshot.allocation.total,
  };
}
