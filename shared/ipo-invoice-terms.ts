export const ipoInvoiceTerms = [
  "delivery",
  "delivery-and-completion",
  "partial-delivery-and-completion",
  "completion",
  "advance-received-balance-at-completion",
] as const;

export type IpoInvoiceTerms = typeof ipoInvoiceTerms[number];

export const ipoInvoiceTermsLabels: Record<IpoInvoiceTerms, string> = {
  delivery: "Full invoice on delivery",
  "delivery-and-completion": "Delivery milestone, then balance at completion",
  "partial-delivery-and-completion": "Qualifying partial delivery, then balance at completion",
  completion: "Full invoice at installation completion",
  "advance-received-balance-at-completion": "Advance received, balance at completion",
};

export function defaultIpoInvoiceTerms(frameworkKey?: string, frameworkType?: string): IpoInvoiceTerms | "" {
  if (frameworkKey === "UBL-UPS-6-10") return "advance-received-balance-at-completion";
  if (frameworkKey === "MBL-UPS-6-5" || frameworkKey === "MBL-UPS-6-10") return "completion";
  if (frameworkType === "ubl-solar" || /^(20-20-30|25-20-30|30-30-40|35-30-40):/.test(frameworkKey ?? ""))
    return "partial-delivery-and-completion";
  return "";
}
