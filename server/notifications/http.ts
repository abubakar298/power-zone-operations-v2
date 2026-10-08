import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { NotificationsRepository } from "./repository.js";
export function notificationsHttp(
  repo: NotificationsRepository,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (
      req.method !== "GET" &&
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  r.get("/", async (req, res) => {
    const cursor = z
      .object({
        beforeTime: z.iso.datetime().optional(),
        beforeId: z.uuid().optional(),
      })
      .safeParse(req.query);
    if (!cursor.success || !!cursor.data.beforeTime !== !!cursor.data.beforeId)
      throw new HttpError(400, "Invalid history cursor.");
    const items = await repo.list(
      req.authSession!.user,
      undefined,
      cursor.data.beforeTime
        ? { time: cursor.data.beforeTime, id: cursor.data.beforeId! }
        : undefined,
    );
    res.json({
      notifications: items,
      unreadCount: items[0]?.unread_count ?? 0,
      hasMore: items.length === 100,
    });
  });
  r.get("/item/:id", async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, "Invalid notification.");
    const n = (await repo.list(req.authSession!.user, id.data))[0];
    if (!n)
      throw new HttpError(
        404,
        "This notification is unavailable for your current access.",
      );
    res.json(n);
  });
  r.post("/read", async (req, res) => {
    const b = z.object({ id: z.uuid().optional() }).safeParse(req.body);
    if (!b.success) throw new HttpError(400, "Select a valid notification.");
    await repo.read(req.authSession!.user, b.data.id);
    res.json({ ok: true });
  });
  r.post("/unread", async (req, res) => {
    const b = z.object({ id: z.uuid() }).safeParse(req.body);
    if (!b.success) throw new HttpError(400, "Select a valid notification.");
    await repo.unread(req.authSession!.user, b.data.id);
    res.json({ ok: true });
  });
  r.get("/preferences", async (req, res) =>
    res.json(await repo.preferences(req.authSession!.user)),
  );
  r.post("/preferences", async (req, res) => {
    const b = z.object({ email_enabled: z.boolean() }).safeParse(req.body);
    if (!b.success) throw new HttpError(400, "Select your email preference.");
    await repo.savePreferences(req.authSession!.user, b.data.email_enabled);
    res.json({ ok: true });
  });
  r.get("/settings", async (req, res) => {
    if (!["Admin", "Management"].includes(req.authSession!.user.role))
      throw new HttpError(403, "Management access required.");
    res.json(await repo.settings());
  });
  r.post("/settings", async (req, res) => {
    if (req.authSession!.user.role !== "Admin")
      throw new HttpError(403, "Administrator access required.");
    const b = z
      .object({
        email_enabled: z.boolean(),
        reminders_enabled: z.boolean(),
        reminder_hours: z.number().int().min(4).max(720),
      })
      .safeParse(req.body);
    if (!b.success)
      throw new HttpError(400, "Enter valid delivery and reminder settings.");
    await repo.saveSettings(req.authSession!.user, b.data);
    res.json({ ok: true });
  });
  r.post("/types", async (req, res) => {
    if (req.authSession!.user.role !== "Admin")
      throw new HttpError(403, "Administrator access required.");
    const b = z
      .object({
        kind: z.string().max(80),
        title: z.string().trim().min(3).max(100),
        email_enabled: z.boolean(),
      })
      .safeParse(req.body);
    if (!b.success)
      throw new HttpError(400, "Enter a short notification heading.");
    await repo.saveType(
      req.authSession!.user,
      b.data.kind,
      b.data.title,
      b.data.email_enabled,
    );
    res.json({ ok: true });
  });
  return r;
}
