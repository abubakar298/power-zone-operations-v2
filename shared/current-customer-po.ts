/**
 * The customer PO a site's lists should show (owner request, 27 November 2026).
 * The PO reference saved when the IPO was issued never changes. When Coordination later attaches a customer PO
 * ("Attach customer PO"), the latest attached PO is the current one; the reference at IPO issue stays visible
 * underneath it so nothing is hidden.
 */
type PoFields = {
  sharedPoReference?: string | null;
  sharedPoDate?: string | null;
  latePo?: { poNumber?: string | null; poDate?: string | null } | null;
};

export function currentCustomerPo(data: PoFields | null | undefined) {
  const issuedReference = data?.sharedPoReference || null;
  const issuedDate = data?.sharedPoDate ? String(data.sharedPoDate).slice(0, 10) : null;
  const late = data?.latePo?.poNumber ? data.latePo : null;
  if (!late) return { reference: issuedReference, date: issuedDate, issuedReference: null, issuedDate: null };
  const replaced = !!issuedReference && issuedReference.trim().toLowerCase() !== String(late.poNumber).trim().toLowerCase();
  return {
    reference: late.poNumber as string,
    date: late.poDate ? String(late.poDate).slice(0, 10) : null,
    issuedReference: replaced ? issuedReference : null,
    issuedDate: replaced ? issuedDate : null,
  };
}
