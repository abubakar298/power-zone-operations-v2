export function quotationTypeLabel(value: any): string {
  const type = value?.quotationType ?? value?.peachtree ?? value;
  return type?.presentation && type?.taxMode
    ? `${type.saleType ? type.saleType+" · " : ""}${type.presentation} · ${type.saleType === "Cash Deal" ? type.cashGstTreatment ?? "No GST added" : type.taxMode}`
    : "Not recorded";
}
