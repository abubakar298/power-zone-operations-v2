/** Shared pieces of the site workflow pages: stage order, colours, dates and the board modes. */
export const STAGE_KEYS = ["ipo_received", "planning", "delivery", "installation", "commissioning", "handover", "doc_dispatch", "closed"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export const STAGE_LABELS: Record<StageKey, string> = {
  ipo_received: "IPO received", planning: "Under planning", delivery: "Delivery", installation: "Installation",
  commissioning: "Commissioning", handover: "Handover", doc_dispatch: "Doc dispatch", closed: "Closed",
};
/** Product palette (design-tokens.css): the primary ramp for the work, success greens once the customer side is done. */
export const STAGE_COLOURS: Record<StageKey, string> = {
  ipo_received: "#c4b5fd", planning: "#a89af0", delivery: "#8c7fe6", installation: "#6658e8",
  commissioning: "#5547d0", handover: "#4435b5", doc_dispatch: "#2f7d55", closed: "#246443",
};
export const stageInk = (key: StageKey) => (["ipo_received", "planning", "delivery"].includes(key) ? "#1d1b2e" : "#fff");
/** Stages a site passes through for its scope. Delivery-only sites close straight after Delivery. */
export const pathFor = (scope: string | null): StageKey[] =>
  scope === "delivery_only" ? ["ipo_received", "planning", "delivery", "closed"] : [...STAGE_KEYS];

export interface SiteRow {
  id: string; issuanceId: string; ipoNumber: string; boqNumber: string; customer: string | null; siteName: string | null; siteCode: string | null;
  region: string | null; siteType: string | null; stage: StageKey; stageLabel: string; stageOrder: number; stageEnteredAt: string; daysInStage: number;
  late: boolean; overdue: string[]; scope: "installation" | "delivery_only" | null; scopeLabel: string | null; nextStage: StageKey | null; previousStage: StageKey | null;
  poDate: string | null; expectedStart: string | null; expectedDelivery: string | null; expectedCompletion: string | null; deliveredOn: string | null;
  startedOn: string | null; installationCompletedOn: string | null; commissionedOn: string | null; matriCloud: string | null; fourG: string | null;
  handedOverOn: string | null; customerSignoff: boolean | null; doDate: string | null; acknowledgementDate: string | null; submittedToCustomerDate: string | null;
  advanceClaimed: boolean; finalClaimed: boolean; documentsNote: string; notes: string; closedAt: string | null; openProblems: number; missingPictureDays: number;
  updatedAt: string; updatedBy: string | null;
}

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => isoDay(new Date());
export const shiftDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
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
  if (v < t) { const days = Math.round((new Date(`${t}T00:00:00`).getTime() - new Date(`${v}T00:00:00`).getTime()) / 86_400_000); return `${days} day${days === 1 ? "" : "s"} ago`; }
  return fmtShort(v);
};

/** Documents a handed-over site still owes. UBL pays 50% on the DO and 50% on the acknowledgement. */
export const missingDocs = (s: SiteRow) => {
  const out: string[] = [];
  if (!s.doDate) out.push("DO date");
  if (!s.acknowledgementDate) out.push("acknowledgement");
  if (!s.submittedToCustomerDate) out.push("submitted to customer");
  if (s.customerSignoff !== true) out.push("customer sign-off");
  return out;
};
/** A site owes documents once it has reached Doc dispatch, or closed after it. */
export const hasDocIssue = (s: SiteRow) =>
  (s.stage === "doc_dispatch" || (s.stage === "closed" && s.scope === "installation")) && missingDocs(s).length > 0;
export const OVERDUE_TEXT: Record<string, string> = { delivery: "Delivery overdue", start: "Start overdue", completion: "Completion overdue" };

export type BoardMode = "all" | "new" | "ongoing" | "completed" | "docs";
export const MODE_TEXT: Record<BoardMode, { title: string; note: string; empty: string }> = {
  all: { title: "All sites", note: "Every site after its IPO, whatever its stage.", empty: "No sites yet. A site appears when its IPO is issued to Operations." },
  new: { title: "New sites", note: "IPO received, planning not started.", empty: "No new sites: every IPO received is under planning or further." },
  ongoing: { title: "Ongoing sites", note: "Every site that is not closed.", empty: "No ongoing sites." },
  completed: { title: "Sites completed (last 30 days)", note: "Sites closed in the last 30 days, after Doc dispatch or after a delivery-only handover.", empty: "No site closed in the last 30 days." },
  docs: { title: "Documentation issues", note: "Sites at Doc dispatch, or closed, still missing the DO date, acknowledgement, submission to the customer or customer sign-off.", empty: "Every site that reached Doc dispatch has its documents." },
};
export const inMode = (s: SiteRow, mode: BoardMode) =>
  mode === "all" ? true
  : mode === "new" ? s.stage === "ipo_received"
  : mode === "ongoing" ? s.stage !== "closed"
  : mode === "completed" ? Boolean(s.closedAt && s.closedAt.slice(0, 10) >= shiftDays(-30))
  : hasDocIssue(s);
