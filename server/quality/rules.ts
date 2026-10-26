/**
 * Quality Control rules (Moaz, 26 Oct 2026): which documents a site needs, when each is due, and when a site turns
 * red. Working week Mon-Fri, 9:00-18:00, Pakistan time (UTC+5, no daylight saving). Public holidays are not known
 * to the app, so they count as working days.
 */
export const QC_KINDS = ["solar_dc", "bess_dc", "installation", "cable_variance", "acknowledgement"] as const;
export type QcKind = (typeof QC_KINDS)[number];

const PKT = "+05:00";
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;
/** Delivery papers are due within the first three working hours of the next working day. */
export const DELIVERY_GRACE_HOURS = 3;
/** BESS installation papers are due within three calendar days of BESS delivery. */
export const BESS_PAPERS_DAYS = 3;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
const at = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00${PKT}`);

export function nextWorkingDay(day: string) {
  let d = addDays(day, 1);
  while (weekend(d)) d = addDays(d, 1);
  return d;
}
/** Due by 12:00 on the next working day; red once that working day has ended (18:00). */
export function deliveryDeadline(deliveredOn: string) {
  const next = nextWorkingDay(deliveredOn);
  return { dueAt: at(next, WORK_START_HOUR + DELIVERY_GRACE_HOURS), redAfter: at(next, WORK_END_HOUR) };
}
/** Due by the end of the third calendar day after BESS delivery. */
export function bessPapersDeadline(bessDeliveredOn: string) {
  return at(addDays(bessDeliveredOn, BESS_PAPERS_DAYS + 1), 0);
}

export interface QcSite { siteType: string | null; scope: string | null; deliveredOn: string | null; bessDeliveredOn: string | null }
const hasSolar = (t: string | null) => !t || t === "Solar" || t === "Solar + BESS";
const hasBess = (t: string | null) => !t || t === "BESS" || t === "UPS" || t === "Solar + BESS";
/** The day the batteries and inverters arrived: the site's delivery for BESS-only sites, its own date on Solar + BESS. */
export const bessDay = (s: QcSite) => (s.siteType === "BESS" || s.siteType === "UPS" ? s.deliveredOn : hasBess(s.siteType) ? s.bessDeliveredOn : null);

/** Solar sites: solar DC, installation report, cable variance, acknowledgement. BESS: battery DC, installation, acknowledgement. Delivery only: DCs and acknowledgement. */
export function requiredKinds(s: QcSite): QcKind[] {
  const install = s.scope !== "delivery_only";
  return QC_KINDS.filter((k) =>
    k === "solar_dc" ? hasSolar(s.siteType)
    : k === "bess_dc" ? hasBess(s.siteType)
    : k === "installation" ? install
    : k === "cable_variance" ? install && hasSolar(s.siteType)
    : true);
}
export function kindLabel(kind: QcKind, s?: Pick<QcSite, "siteType">) {
  return kind === "solar_dc" ? "Solar & Structure DC + delivery pictures"
    : kind === "bess_dc" ? "Inverter & battery DC"
    : kind === "installation" ? (s && hasBess(s.siteType) ? "Installation report + BESS installation picture" : "Installation report")
    : kind === "cable_variance" ? "Cable variance report"
    : "Acknowledgement";
}
/** When a document is due, if it has a deadline at all. */
export function dueAt(kind: QcKind, s: QcSite): Date | null {
  if (kind === "solar_dc") return hasSolar(s.siteType) && s.deliveredOn ? deliveryDeadline(s.deliveredOn).dueAt : null;
  const b = bessDay(s);
  if (kind === "bess_dc") return b ? deliveryDeadline(b).dueAt : null;
  if ((kind === "installation" || kind === "cable_variance") && b && hasBess(s.siteType) && s.scope !== "delivery_only") return bessPapersDeadline(b);
  return null;
}

/** The checklist for a site: what is needed, what is in, what is overdue, and whether the site is red. A closed site is never red. */
export function assessQc(s: QcSite & { closed?: boolean }, submitted: Set<QcKind>, now = new Date()) {
  const required = requiredKinds(s);
  const items = required.map((kind) => {
    const due = dueAt(kind, s);
    const done = submitted.has(kind);
    return { kind, label: kindLabel(kind, s), done, dueAt: due ? due.toISOString() : null, overdue: !s.closed && !done && Boolean(due && now > due) };
  });
  // Bright red: a delivery happened, its next working day has ended, and its papers are still not in.
  const red = !s.closed && (
    (hasSolar(s.siteType) && Boolean(s.deliveredOn) && !submitted.has("solar_dc") && now > deliveryDeadline(s.deliveredOn!).redAfter) ||
    (Boolean(bessDay(s)) && !submitted.has("bess_dc") && now > deliveryDeadline(bessDay(s)!).redAfter));
  const missing = items.filter((i) => !i.done);
  return { items, red, required: required.length, done: required.length - missing.length, missing: missing.map((i) => i.label), overdue: items.filter((i) => i.overdue).map((i) => i.label) };
}
