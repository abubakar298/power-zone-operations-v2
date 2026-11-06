import { Decimal } from "decimal.js";
import { z } from "zod";
import { HttpError } from "../http/errors.js";
export interface InventoryLine {
  key: string;
  description: string;
  unit: string;
  approved: string;
  brand: string;
  specification: string;
  sellingRate: string | null;
  gstRate: string;
  group: "watt" | "cable" | "material";
}
const qty = z
  .string()
  .max(30)
  .refine(
    (v) => v === "" || /^\d+(\.\d{1,4})?$/.test(v),
    "Enter a nonnegative quantity.",
  );
export const entrySchema = z
  .object({
    start: z.string().max(10),
    end: z.string().max(10),
    panelCount: qty,
    panelWattage: qty,
    installedWatts: qty.optional(),
    usage: z.record(z.string().max(200), qty),
    remarks: z.string().max(4000),
    expectedReturns: z.string().max(2000),
    receivedReturns: z.string().max(2000),
    extra: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(300),
          unit: z.string().trim().min(1).max(30),
          used: qty,
        }),
      )
      .max(50),
  })
  .strict();
export type ReportEntry = z.infer<typeof entrySchema>;
const D = (v: string) => new Decimal(v),
  money = (v: Decimal) => v.toFixed(2);
export function reconcile(lines: InventoryLine[], entry: ReportEntry) {
  const watts =
    entry.panelCount && entry.panelWattage
      ? D(entry.panelCount).mul(entry.panelWattage).toString()
      : entry.installedWatts || null;
  const rows = lines.map((l) => {
    const actual = l.group === "watt" ? watts : entry.usage[l.key];
    const installed = actual === undefined || actual === "" ? null : actual;
    const change = installed === null ? null : D(installed).sub(l.approved);
    const value =
      change === null || l.sellingRate === null
        ? null
        : change.mul(l.sellingRate).toDecimalPlaces(2);
    return {
      ...l,
      installed,
      change: change?.toString() ?? null,
      value: value === null ? null : money(value),
    };
  });
  const sections = (["watt", "cable", "material"] as const).map((group) => {
    const selected = rows.filter((r) => r.group === group),
      known = selected.filter((r) => r.value !== null);
    const net = known.reduce((n, r) => n.add(r.value!), D("0"));
    const rates = [...new Set(known.map((r) => r.gstRate))];
    const taxes = rates.map((rate) => ({
      rate,
      amount: money(
        known
          .filter((r) => r.gstRate === rate)
          .reduce((n, r) => n.add(r.value!), D("0"))
          .mul(rate)
          .div(100),
      ),
    }));
    const gst = taxes.reduce((n, t) => n.add(t.amount), D("0"));
    const unresolved = selected.filter(
      (r) => r.installed === null || (r.change !== "0" && r.value === null),
    );
    return {
      group,
      rows: selected,
      net: money(net),
      taxes,
      gst: money(gst),
      gross: money(net.add(gst)),
      complete: unresolved.length === 0,
    };
  });
  const net = sections.reduce((n, s) => n.add(s.net), D("0")),
    gst = sections.reduce((n, s) => n.add(s.gst), D("0"));
  return {
    watts,
    sections,
    net: money(net),
    gst: money(gst),
    gross: money(net.add(gst)),
    complete: sections.every((s) => s.complete) && entry.extra.length === 0,
    status:
      "Potential invoice adjustment — Accounts review and Management authorization required",
  };
}
export function validateSubmission(entry: ReportEntry, lines: InventoryLine[]) {
  const date = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (!date(entry.start) || !date(entry.end) || entry.end < entry.start)
    throw new HttpError(400, "Enter valid installation dates in order.");
  if (
    lines.some((l) => l.group === "watt") &&
    (!entry.panelCount ||
      !entry.panelWattage ||
      D(entry.panelCount).lte(0) ||
      !D(entry.panelCount).isInteger() ||
      D(entry.panelWattage).lte(0))
  )
    throw new HttpError(400, "Confirm the installed panel count and wattage.");
  if (
    lines.some(
      (l) =>
        l.group !== "watt" &&
        (entry.usage[l.key] === undefined || entry.usage[l.key] === ""),
    )
  )
    throw new HttpError(
      400,
      "Confirm every material quantity, using zero only when none was used.",
    );
  if (entry.extra.some((e) => e.used === ""))
    throw new HttpError(400, "Enter the additional material quantities.");
}

// Quantity variances outside cables are retained for reporting, never used as invoice impact.
export function cableInvoiceAdjustment(reconciliation: any) {
  const cable = reconciliation?.sections?.find((s: any) => s.group === "cable");
  return cable
    ? {
        net: cable.net,
        gst: cable.gst,
        gross: cable.gross,
        complete: cable.complete,
      }
    : { net: null, gst: null, gross: null, complete: false };
}
