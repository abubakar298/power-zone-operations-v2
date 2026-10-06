import { Router, type RequestHandler } from "express";
import { equalSecrets } from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { AccountsService } from "./service.js";
export function accountsHttp(
  service: AccountsService,
  requireSession: RequestHandler,
) {
  const r = Router();
  r.post("/recover", async (req, res) => {
    await service.recover(req.body, req.ip ?? "unknown");
    res.json({
      message:
        "If an active, verified account matches, a reset email will arrive shortly.",
    });
  });
  r.post("/consume", async (req, res) => {
    await service.consume(req.body, req.ip ?? "unknown");
    res.json({ message: "Completed. You can sign in now." });
  });
  r.use(requireSession);
  r.get("/status", async (req, res) =>
    res.json({ emailConfigured: service.delivery.configured }),
  );
  r.post("/verify-email", async (req, res) => {
    if (
      !equalSecrets(req.get("X-CSRF-Token") ?? "", req.authSession!.csrfToken)
    )
      throw new HttpError(403, "Refresh and try again.");
    await service.verifyEmail(req.authSession!.user, req.ip ?? "unknown");
    res.json({ message: "Verification email requested." });
  });
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
  r.get("/", async (_req, res) =>
    res.json({
      ...(await service.repository.list()),
      emailConfigured: service.delivery.configured,
    }),
  );
  r.post("/create", async (req, res) => {
    const account = await service.createDirect(
      req.body,
      req.authSession!.user,
      req.ip ?? "unknown",
    );
    res
      .status(201)
      .json({
        message:
          "Account created. Sign in with the selected email and password. Email verification remains pending.",
        account,
      });
  });
  r.post("/invite", async (req, res) => {
    await service.invite(req.body, req.authSession!.user, req.ip ?? "unknown");
    res.status(201).json({ message: "Invitation queued." });
  });
  r.post("/users/:id", async (req, res) => {
    await service.change(
      req.authSession!.user,
      String(req.params.id),
      req.body,
    );
    res.json({ message: "Account updated. Existing sessions ended." });
  });
  r.post("/invitations/:id/revoke", async (req, res) => {
    await service.revoke(
      req.authSession!.user,
      String(req.params.id),
      String(req.body.password ?? ""),
    );
    res.json({ message: "Invitation cancelled." });
  });
  return r;
}
