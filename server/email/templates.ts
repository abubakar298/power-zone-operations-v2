import type { Message } from "./delivery.js";
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Shared, table-based, image-optional design for account and workflow mail. */
function brandedMessage(
  to: string,
  subject: string,
  title: string,
  details: string[],
  action: string,
  url: string,
  note: string,
): Message {
  const origin = new URL(url).origin;
  return {
    to,
    subject,
    text: [
      title,
      ...details,
      "",
      `${action}:`,
      url,
      "",
      note,
      "",
      "Rafiq · Power Zone Systems",
    ].join("\n"),
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"></head><body style="margin:0;background:#f5f3fa;color:#27242f;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e1f1;border-radius:12px"><tr><td style="padding:28px"><div style="background:#5840ad;padding:16px 22px;border-radius:8px"><img src="${escapeHtml(origin)}/brand/power-zone-white.png" width="119" height="75" alt="POWER ZONE" style="display:block;width:119px;height:75px;color:white;font-weight:bold"><span style="font-size:11px;color:#fff;letter-spacing:1px">POWER ZONE SYSTEMS</span></div><h1 style="font-size:24px;line-height:1.3;color:#27242f;margin:26px 0 18px">${escapeHtml(title)}</h1>${details.map((d) => `<p style="line-height:1.6;font-size:15px;color:#494151;margin:8px 0">${escapeHtml(d)}</p>`).join("")}<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 20px;background:#654fe6;color:white;text-decoration:none;border-radius:7px;font-weight:bold">${escapeHtml(action)}</a></p><p style="font-size:12px;color:#746b85;line-height:1.6">${escapeHtml(note)}</p><hr style="border:0;border-top:1px solid #e7e1f1;margin:24px 0"><p style="font-size:12px;color:#746b85">Rafiq · Power Zone Systems</p></td></tr></table></td></tr></table></body></html>`,
  };
}
/** Private single-use account tokens stay in fragments; never attach them to logs. */
export function accountMessage(
  purpose: "invite" | "reset" | "verify",
  to: string,
  url: string,
  hours: number,
): Message {
  const action =
    purpose === "invite"
      ? "Create your account"
      : purpose === "reset"
        ? "Reset your password"
        : "Verify your email";
  const subject =
    purpose === "invite"
      ? "Your Power Zone invitation"
      : purpose === "reset"
        ? "Reset your Power Zone password"
        : "Verify your Power Zone email";
  return brandedMessage(
    to,
    subject,
    action,
    [
      "Your secure link for Power Zone Operations is ready.",
      `This link expires in ${hours} ${hours === 1 ? "hour" : "hours"} and can be used once.`,
    ],
    action,
    url,
    "If you did not request this email, ignore it. Do not forward this private link.",
  );
}
/** Reference-only vocabulary shared with the in-app notification. No financial payloads. */
export function notificationMessage(
  to: string,
  title: string,
  reference: string,
  actor: string,
  url: string,
  date?: string,
): Message {
  return brandedMessage(
    to,
    `${title} — ${reference}`,
    title,
    [
      reference,
      `By: ${actor}`,
      ...(date
        ? [
            new Date(date).toLocaleString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Karachi",
            }) + " PKT",
          ]
        : []),
      "Open the document to review the update and any required action.",
    ],
    "Open document",
    url,
    "You receive this because this workflow is assigned to your account or role. Manage nonessential email preferences in the application.",
  );
}
