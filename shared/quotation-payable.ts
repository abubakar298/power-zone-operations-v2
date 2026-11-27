/**
 * The amount the customer pays on a saved quotation snapshot.
 * Most quotations save a "Net Total" footer row. A Tax Included quotation whose
 * discount is built into the selling prices saves only a "Total" row, which is then
 * the payable. Returns undefined when neither row carries an amount, so screens can
 * say the amount is missing instead of failing.
 */
export function quotationPayable(snapshot: any): string | undefined {
  const footer: any[] = Array.isArray(snapshot?.footer) ? snapshot.footer : [];
  const row = (label: string) => footer.find((r: any) => r?.label === label);
  const value = row("Net Total")?.amount ?? row("Total")?.amount;
  return value == null || value === "" ? undefined : String(value);
}
