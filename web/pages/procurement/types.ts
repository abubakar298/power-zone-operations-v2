/** Shapes returned by /api/procurement and small display helpers for the Procurement pages. */
export interface Me { role: string; displayName: string; buyer: boolean; approver: boolean }
export interface ReceivedPo {
  issuanceId: string; ipoNumber: string; customer: string | null; siteName: string | null; siteCode: string | null; region: string | null;
  poDate: string | null; stage: string | null; deliveredOn: string | null; expectedDelivery: string | null;
  items: number; pending: boolean; shortItems: string[]; material: "delivered" | "short" | "ready";
}
export interface UpcomingPo {
  recordId: string; reference: string; customer: string | null; siteName: string | null; siteCode: string | null; region: string | null;
  workflowStage: string | null; expectedDate: string | null; items: number; bigItems: { panels: string; batteries: string; inverters: string }; updatedAt: string;
}
export interface InventoryRow {
  itemKey: string; name: string; unit: string; inRateMaster: boolean; boughtByBuyer: boolean; counted: boolean; lastCountAt: string | null; stockUnit: string | null;
  inStock: string; receivedNeed: string; upcomingNeed: string; onOrder: string; requested: string; toBuy: string; shortForReceived: boolean; unitMismatch: boolean;
}
export type RequestStatus = "draft" | "pending_approval" | "approved" | "rejected" | "ordered" | "received" | "cancelled";
export interface RequestRow {
  id: string; number: string; title: string; status: RequestStatus; statusLabel: string; lines: number; total: string; vendors: string; createdBy: string;
  createdAt: string; updatedAt: string; submittedAt: string | null; decidedAt: string | null; orderedAt: string | null; receivedAt: string | null; neededBy: string | null;
}
export interface Quote { id: string; vendor: string; rate: string; note: string; createdAt: string }
export interface RequestLine {
  id: string; itemKey: string; name: string; masterUnit: string | null; quantity: string; unit: string; note: string; quotes: Quote[]; chosenQuoteId: string | null;
  chosen: Quote | null; best: Quote | null; lastRate: { rate: string; unit: string; source: string; comparable: boolean } | null; difference: string | null; lineTotal: string;
}
export interface RequestDetail {
  id: string; number: string; title: string; purpose: string; neededBy: string | null; deliveryTo: string; paymentTerms: string; status: RequestStatus; statusLabel: string;
  createdBy: string; createdAt: string; submittedAt: string | null; decidedBy: string | null; decidedAt: string | null; decisionNote: string;
  orderedBy: string | null; orderedAt: string | null; orderReference: string; receivedBy: string | null; receivedAt: string | null;
  lines: RequestLine[]; events: { id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string; actor: string; at: string }[];
  totals: { atChosen: string; lastComparable: string; chosenComparable: string; saving: string; firstPurchases: number };
  can: { edit: boolean; submit: boolean; decide: boolean; order: boolean; receive: boolean; cancel: boolean };
}
export interface Overview { me: Me; inventory: InventoryRow[]; receivedPOs: ReceivedPo[]; upcoming: UpcomingPo[]; requests: RequestRow[] }

export const WORKFLOW_STAGES: Record<string, string> = {
  request_review: "Survey request", survey_requested: "Survey requested", survey_scheduled: "Survey scheduled", report_received: "Report received",
  technical_review: "Technical review", design_handed_off: "Design review", management_review: "Management review", commercial_revision: "Revisions",
  approved_dispatch: "Ready to send", customer_tracking: "Customer follow-up", advance_pending: "Advance planning", po_receipt: "PO receipt",
  order_exception: "Order exception", issued: "Issued", deferred: "Deferred", declined: "Declined",
};
export const stageText = (s: string | null) => (s ? WORKFLOW_STAGES[s] ?? s.replace(/_/g, " ") : "—");

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const shiftDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const fmtDay = (v: string | null | undefined) =>
  v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(v.length === 10 ? `${v}T00:00:00` : v)) : "—";
export const fmtShort = (v: string | null | undefined) =>
  v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(v.length === 10 ? `${v}T00:00:00` : v)) : "—";
export const fmtAt = (v: string | null | undefined) =>
  v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(v)) : "—";
export const relDay = (v: string) => {
  const t = today();
  if (v === t) return "today";
  if (v === shiftDays(1)) return "tomorrow";
  if (v < t) return `${fmtShort(v)} (passed)`;
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${v}T00:00:00`));
};
/** Whole numbers with thousands separators; decimals kept as given (up to 2 shown). */
export const qty = (v: string | number) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return String(v);
  return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
export const pkr = (v: string | number) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
export const short = (v: string | number) => {
  const x = Number(v);
  return x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : pkr(x);
};
export const STATUS_CHIP: Record<RequestStatus, string> = {
  draft: "sw-chip", pending_approval: "sw-chip sw-chip--warning", approved: "sw-chip sw-chip--ok", rejected: "sw-chip sw-chip--danger",
  ordered: "sw-chip", received: "sw-chip sw-chip--ok", cancelled: "sw-chip",
};
