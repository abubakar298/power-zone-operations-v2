/** Display dates in Pakistan time. Never rewrite stored ISO dates/snapshots. */
const businessTimeZone = "Asia/Karachi";
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: businessTimeZone,
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: businessTimeZone,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
function parsed(value: string | Date | null | undefined) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  // Reject JavaScript's normalization of an impossible calendar date.
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    date.toISOString().slice(0, 10) !== value
  )
    return null;
  return date;
}
export function displayDate(value: string | Date | null | undefined): string {
  const date = parsed(value);
  return date ? dateFormat.format(date) : "—";
}
export function displayDateTime(
  value: string | Date | null | undefined,
): string {
  const date = parsed(value);
  if (!date) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return dateFormat.format(date);
  return `${dateFormat.format(date)} · ${timeFormat.format(date)}`;
}
