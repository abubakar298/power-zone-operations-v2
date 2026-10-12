export function quotationTypeLabel(value: any): string {
  const type = value?.quotationType ?? value?.peachtree ?? value;
  return type?.presentation && type?.taxMode
    ? `${type.presentation} · ${type.taxMode}`
    : "Not recorded";
}
