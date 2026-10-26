import { Router, type RequestHandler } from "express";
import { pipeline } from "node:stream/promises";
import { stat } from "node:fs/promises";
import type { Pool } from "pg";
import { z } from "zod";
import { AuthRepository } from "../auth/repository.js";
import { digest, equalSecrets, verifyPassword } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { exportBackup, createReadStream } from "./archive.js";
export function backupsHttp(pool: Pool, requireSession: RequestHandler) {
  const router = Router(),
    auth = new AuthRepository(pool);
  router.use(requireSession);
  router.use((req, _res, next) => {
    if (req.authSession!.user.role !== "Admin")
      throw new HttpError(403, "Administrator access required.");
    if (
      req.method !== "GET" &&
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    next();
  });
  router.get("/", async (_req, res) =>
    res.json({
      downloads: (
        await pool.query(
          "SELECT created_at FROM audit_log WHERE action='backup.download.prepared' ORDER BY created_at DESC LIMIT 10",
        )
      ).rows,
    }),
  );
  router.post("/download", async (req, res) => {
    const parsed = z
      .object({
        password: z.string().min(1).max(128),
        passphrase: z.string().min(16).max(128),
        passphraseConfirmation: z.string().min(16).max(128),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Enter your current password and a backup passphrase of 16–128 characters.",
      );
    const input = parsed.data;
    if (input.passphrase !== input.passphraseConfirmation)
      throw new HttpError(400, "Backup passphrases do not match.");
    if (input.password === input.passphrase)
      throw new HttpError(
        400,
        "Use a backup passphrase different from your login password.",
      );
    if (
      !(await auth.consumeRateLimit(
        digest("backup:" + req.authSession!.user.id),
        3,
      ))
    )
      throw new HttpError(
        429,
        "Too many backup attempts. Try again in 15 minutes.",
      );
    const current = await auth.findUser(req.authSession!.user.email);
    if (
      !current?.active ||
      current.role !== "Admin" ||
      !(await verifyPassword(input.password, current.password_hash))
    )
      throw new HttpError(403, "Current administrator password is incorrect.");
    const archive = await exportBackup(pool, input.passphrase);
    try {
      await pool.query(
        "INSERT INTO audit_log(user_id,action) VALUES($1,'backup.download.prepared')",
        [current.id],
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
  return router;
}
