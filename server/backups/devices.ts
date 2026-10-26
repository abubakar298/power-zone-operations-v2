import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { pipeline } from "node:stream/promises";
import { stat } from "node:fs/promises";
import { AuthRepository } from "../auth/repository.js";
import {
  digest,
  equalSecrets,
  newToken,
  verifyPassword,
} from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { exportBackup, createReadStream } from "./archive.js";

export function backupDevicesHttp(pool: Pool, requireSession: RequestHandler) {
  const r = Router(),
    auth = new AuthRepository(pool);
  // Device credentials are restricted to this endpoint; never accepted by login or other APIs.
  r.post("/device/download", async (req, res) => {
    const token = req
      .get("Authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (
      !(await auth.consumeRateLimit(digest("backup-device-ip:" + req.ip), 15))
    )
      throw new HttpError(429, "Too many backup attempts. Try again later.");
    if (!token)
      throw new HttpError(401, "Backup device authentication required.");
    const device = (
      await pool.query(
        `SELECT d.id,d.user_id FROM backup_devices d JOIN users u ON u.id=d.user_id
       WHERE d.token_hash=$1 AND d.revoked_at IS NULL AND d.expires_at>now()
       AND u.active AND u.role='Admin'`,
        [digest(token)],
      )
    ).rows[0];
    if (!device)
      throw new HttpError(401, "Backup device is expired or revoked.");
    const v = z
      .object({ passphrase: z.string().min(16).max(128) })
      .strict()
      .safeParse(req.body);
    if (!v.success)
      throw new HttpError(
        400,
        "A 16–128 character encryption passphrase is required.",
      );
    if (!(await auth.consumeRateLimit(digest("backup-device:" + device.id), 3)))
      throw new HttpError(429, "Too many backup attempts. Try again later.");
    const archive = await exportBackup(pool, v.data.passphrase);
    try {
      await pool.query(
        "UPDATE backup_devices SET last_used_at=now() WHERE id=$1",
        [device.id],
      );
      await pool.query(
        "INSERT INTO audit_log(user_id,action) VALUES($1,'backup.device.prepared')",
        [device.user_id],
      );
      res
        .type("application/octet-stream")
        .set(
          "Content-Disposition",
          `attachment; filename="Power-Zone-Backup-${archive.createdAt.replaceAll(":", "-")}.pzb"`,
        )
        .set("Content-Length", String((await stat(archive.path)).size));
      await pipeline(createReadStream(archive.path), res);
    } finally {
      await archive.cleanup();
    }
  });
  r.use(requireSession);
  r.use((req, _res, next) => {
    if (req.authSession!.user.role !== "Admin")
      throw new HttpError(403, "Administrator access required.");
    if (
      req.method !== "GET" &&
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  r.get("/devices", async (_req, res) =>
    res.json({
      devices: (
        await pool.query(
          "SELECT id,label,created_at,expires_at,revoked_at,last_used_at FROM backup_devices ORDER BY created_at DESC",
        )
      ).rows,
    }),
  );
  r.post("/devices", async (req, res) => {
    const v = z
      .object({
        password: z.string().min(1).max(128),
        label: z.string().trim().min(1).max(100),
      })
      .strict()
      .safeParse(req.body);
    if (!v.success)
      throw new HttpError(400, "Enter the current password and device name.");
    if (
      !(await auth.consumeRateLimit(
        digest("backup-device-enroll:" + req.authSession!.user.id),
        5,
      ))
    )
      throw new HttpError(429, "Too many enrollment attempts.");
    const user = await auth.findUser(req.authSession!.user.email);
    if (
      !user?.active ||
      user.role !== "Admin" ||
      !(await verifyPassword(v.data.password, user.password_hash))
    )
      throw new HttpError(403, "Current administrator password is incorrect.");
    const token = newToken(),
      id = randomUUID();
    const inserted = await pool.query(
      "INSERT INTO backup_devices(id,user_id,label,token_hash) SELECT $1,id,$3,$4 FROM users WHERE id=$2 AND active AND role='Admin' AND password_hash=$5 RETURNING id",
      [id, user.id, v.data.label, digest(token), user.password_hash],
    );
    if (!inserted.rowCount)
      throw new HttpError(403, "Administrator access changed. Sign in again.");
    await pool.query(
      "INSERT INTO audit_log(user_id,action) VALUES($1,'backup.device.enrolled')",
      [user.id],
    );
    res.status(201).json({ id, token });
  });
  r.post("/devices/:id/revoke", async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, "Invalid device.");
    await pool.query(
      "UPDATE backup_devices SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1",
      [id.data],
    );
    await pool.query(
      "INSERT INTO audit_log(user_id,action) VALUES($1,'backup.device.revoked')",
      [req.authSession!.user.id],
    );
    res.json({ revoked: true });
  });
  return r;
}
