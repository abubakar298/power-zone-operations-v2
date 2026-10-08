import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, raw } from "express";
import type { Pool } from "pg";
import { transaction } from "../db/transaction.js";
// Resend/Svix protocol: raw bytes, timestamp tolerance, constant-time signature comparison.
export function verifyWebhook(
  body: Buffer,
  id: string,
  timestamp: string,
  signature: string,
  secret: string,
  now = Date.now(),
) {
  if (
    !/^whsec_[A-Za-z0-9+/=]+$/.test(secret) ||
    !id ||
    id.length > 200 ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest();
  return signature.split(" ").some((v) => {
    const [version, value] = v.split(",");
    if (version !== "v1" || !value) return false;
    const got = Buffer.from(value, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
export function notificationWebhook(pool: Pool, secret?: string) {
  const r = Router();
  r.post(
    "/",
    raw({ type: "application/json", limit: "32kb" }),
    async (req, res) => {
      if (!secret) {
        res.status(503).json({ message: "Webhook is not configured." });
        return;
      }
      const id = req.get("svix-id") ?? "";
      if (
        !Buffer.isBuffer(req.body) ||
        !verifyWebhook(
          req.body,
          id,
          req.get("svix-timestamp") ?? "",
          req.get("svix-signature") ?? "",
          secret,
        )
      ) {
        res.status(400).json({ message: "Invalid webhook." });
        return;
      }
      let event: any;
      try {
        event = JSON.parse(req.body.toString());
      } catch {
        res.status(400).json({ message: "Invalid webhook." });
        return;
      }
      const statuses: Record<string, string> = {
        "email.delivered": "delivered",
        "email.bounced": "bounced",
        "email.complained": "complained",
        "email.failed": "failed",
        "email.delivery_delayed": "delayed",
      };
      const status = statuses[event.type];
      if (!status || typeof event.data?.email_id !== "string") {
        res.json({ ok: true });
        return;
      }
      await transaction(pool, async (c) => {
        const receipt = await c.query(
          "INSERT INTO notification_webhook_receipts(id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
          [id, event.type],
        );
        if (!receipt.rowCount) return;
        // Terminal failures cannot be overwritten by delayed/out-of-order delivery events.
        for (const table of ["notification_email_queue", "email_outbox"])
          await c.query(
            `UPDATE ${table} SET provider_status=$2 WHERE provider_id=$1 AND (provider_status IS NULL OR provider_status NOT IN('bounced','complained','failed'))`,
            [event.data.email_id, status],
          );
      });
      res.json({ ok: true });
    },
  );
  return r;
}
