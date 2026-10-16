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
      departmentViewApplied?: boolean;
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
    if(req.departmentViewApplied&&req.authSession){next();return;}
    const hash = tokenHash(req);
    req.authSession = hash
      ? await service.repository.getSession(hash)
      : undefined;
    if (!req.authSession) {
      res.clearCookie(cookieName, options);
      throw new HttpError(401, "Your session has ended. Please sign in again.");
    }
    const actingUserId=req.get('X-PZ-Department-User');
    // The real cookie/session remains Management. Department scope is per request,
    // so switching this tab never signs out other tabs or shares staff credentials.
    if(actingUserId && req.baseUrl!=='/api/auth'){
      const principal=req.authSession.user;
      if(req.get('X-PZ-Management-User')!==principal.id)throw new HttpError(403,'The Management account changed. Refresh before continuing.');
      const target=await service.repository.departmentUser(principal,actingUserId);
      if(!['GET','HEAD','OPTIONS'].includes(req.method)){
        if(!equalSecrets(req.get('X-CSRF-Token')??'',req.authSession.csrfToken))throw new HttpError(403,'Refresh and try again.');
        await service.repository.departmentAudit(principal,target,{kind:'request-attempt',method:req.method,path:req.originalUrl.split('?')[0],requestKey:typeof req.body?.requestKey==='string'?req.body.requestKey.slice(0,100):null});
      }
      req.authSession={...req.authSession,user:target};
      req.departmentViewApplied=true;
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
  router.get('/department-views',requireSession,async(req,res)=>{
    res.json({users:(await service.repository.departmentUsers(req.authSession!.user)).map(publicUser)});
  });
  router.post('/department-view',requireSession,async(req,res)=>{
    const s=req.authSession!;
    if(!equalSecrets(req.get('X-CSRF-Token')??'',s.csrfToken))throw new HttpError(403,'Refresh and try again.');
    const target=req.body?.userId===null?null:await service.repository.departmentUser(s.user,String(req.body?.userId??''));
    await service.repository.departmentAudit(s.user,target,{kind:target?'enter':'exit'});
    res.json({user:target?publicUser(target):publicUser(s.user)});
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
