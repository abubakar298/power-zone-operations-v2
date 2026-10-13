import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { parse } from "cookie";
import type { Config } from "../config.js";
import { HttpError } from "../http/errors.js";
import { digest, equalSecrets } from "./crypto.js";
import { AuthService, publicUser } from "./service.js";
import type { Session } from "./repository.js";

declare global {
  namespace Express {
    interface Request {
      authSession?: Session;
    }
  }
}

export function authHttp(service: AuthService, config: Config) {
  const router = Router();
  const cookieName = config.production ? "__Host-pz_session" : "pz_session";
  const options = {
    httpOnly: true,
    secure: config.production,
    sameSite: "strict" as const,
    path: "/",
  };
  function tokenHash(req: Request) {
    const token = parse(req.headers.cookie ?? "")[cookieName];
    return token && /^[A-Za-z0-9_-]{43}$/.test(token)
      ? digest(token)
      : undefined;
  }
  async function requireSession(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const hash = tokenHash(req);
    req.authSession = hash
      ? await service.repository.getSession(hash)
      : undefined;
    if (!req.authSession) {
      res.clearCookie(cookieName, options);
      throw new HttpError(401, "Your session has ended. Please sign in again.");
    }
    next();
  }
  router.get("/status", async (_req, res) => {
    res.json({ setupRequired: await service.repository.setupRequired() });
  });
  router.post("/setup", async (req, res) => {
    await service.createAdmin(req.body, req.ip ?? "unknown");
    res
      .status(201)
      .json({ message: "Administrator created. Sign in to continue." });
  });
  router.post("/login", async (req, res) => {
    const { token, ...result } = await service.login(
      req.body,
      req.ip ?? "unknown",
      tokenHash(req),
    );
    res.cookie(cookieName, token, { ...options, expires: result.expiresAt });
    res.json(result);
  });
  router.get("/session", requireSession, (req, res) => {
    const s = req.authSession!;
    res.json({
      user: publicUser(s.user),
      csrfToken: s.csrfToken,
      expiresAt: s.expiresAt,
    });
  });
  router.post("/change-password", requireSession, async (req, res) => {
    const s = req.authSession!;
    if (!equalSecrets(req.get("X-CSRF-Token") ?? "", s.csrfToken))
      throw new HttpError(403, "Refresh and try again.");
    await service.changePassword(s.user, req.body, req.ip ?? "unknown");
    res.clearCookie(cookieName, options);
    res.json({
      message: "Password changed. Sign in again with your new password.",
    });
  });
  router.post("/logout", requireSession, async (req, res) => {
    const s = req.authSession!;
    if (!equalSecrets(req.get("X-CSRF-Token") ?? "", s.csrfToken))
      throw new HttpError(403, "Please refresh the page and try again.");
    await service.repository.deleteSession(s);
    res.clearCookie(cookieName, options);
    res.status(204).end();
  });
  return { router, requireSession };
}
