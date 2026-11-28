/**
 * The customer PO a site's lists should show (owner instruction, 29 November 2026).
 * The PO reference saved when the IPO was issued never changes in the database. When Coordination later attaches
 * a customer PO ("Attach customer PO"), the latest attached PO is the only one shown: the earlier PO is no longer
 * in use and showing both causes confusion. The earlier PO and its file stay stored for the audit trail.
 */
type PoFields = {
  sharedPoReference?: string | null;
  sharedPoDate?: string | null;
  latePo?: { poNumber?: string | null; poDate?: string | null } | null;
};

export function currentCustomerPo(data: PoFields | null | undefined) {
  const late = data?.latePo?.poNumber ? data.latePo : null;
  if (late) return { reference: late.poNumber as string, date: late.poDate ? String(late.poDate).slice(0, 10) : null };
  return {
    reference: data?.sharedPoReference || null,
    date: data?.sharedPoDate ? String(data.sharedPoDate).slice(0, 10) : null,
  };
}
