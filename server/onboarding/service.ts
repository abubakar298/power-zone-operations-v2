import { z } from "zod";
import { AccountsRepository } from "./repository.js";
import { AuthRepository, type User } from "../auth/repository.js";
import {
  digest,
  newToken,
  hashPassword,
  verifyPassword,
} from "../auth/crypto.js";
import { HttpError } from "../http/errors.js";
import { seal, type EmailDelivery } from "../email/delivery.js";
import type { Config } from "../config.js";
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export class AccountsService {
  constructor(
    public repository: AccountsRepository,
    private auth: AuthRepository,
    private config: Config,
    public delivery: EmailDelivery,
  ) {}
  async throttle(ip: string, scope: string, limit = 10) {
    if (!(await this.auth.consumeRateLimit(digest(`${scope}:${ip}`), limit)))
      throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
  }
  private available() {
    if (!this.delivery.configured || !this.config.emailEncryptionKey)
      throw new HttpError(
        503,
        "Email delivery has not been activated. Contact your administrator.",
      );
  }
  async invite(body: unknown, actor: User, ip: string) {
    await this.throttle(ip, "invite");
    this.available();
    const v = z
      .object({
        email,
        role: z.enum(["Admin", "Management", "Employee"]),
        password: z.string().max(128),
      })
      .strict()
      .safeParse(body);
    if (!v.success)
      throw new HttpError(400, "Enter email, role and your current password.");
    const a = await this.auth.findUser(actor.email);
    if (!a || !(await verifyPassword(v.data.password, a.password_hash)))
      throw new HttpError(403, "Your current password is incorrect.");
    return this.issue(
      "invite",
      v.data.email,
      { role: v.data.role, actorId: a.id, actorHash: a.password_hash },
      48,
    );
  }
  private async issue(
    purpose: "invite" | "reset" | "verify",
    address: string,
    fields: {
      role?: User["role"];
      userId?: string;
      actorId?: string;
      actorHash?: string;
    },
    hours: number,
  ) {
    const token = newToken();
    const url = `${this.config.origin}/account-link#${purpose}/${token}`;
    const encrypted = seal(
      {
        to: address,
        subject:
          purpose === "invite"
            ? "Your Power Zone invitation"
            : purpose === "reset"
              ? "Reset your Power Zone password"
              : "Verify your Power Zone email",
        text: `Open this link to ${purpose === "invite" ? "create your account" : purpose === "reset" ? "reset your password" : "verify your email"}:\n${url}\n\nThis link expires in ${hours} hours and can be used once. If you did not request it, ignore this email.`,
      },
      this.config.emailEncryptionKey!,
    );
    await this.repository.issue({
      hash: digest(token),
      purpose,
      email: address,
      ...fields,
      encrypted,
      hours,
    });
  }
  async recover(body: unknown, ip: string) {
    await this.throttle(ip, "recovery");
    this.available();
    const v = z.object({ email }).strict().safeParse(body);
    if (!v.success) throw new HttpError(400, "Enter a valid email.");
    await this.throttle(v.data.email, "recovery-email", 3);
    const u = await this.auth.findUser(v.data.email);
    if (u?.active && u.email_verified_at)
      await this.issue("reset", u.email, { userId: u.id }, 1);
  }
  async verifyEmail(user: User, ip: string) {
    await this.throttle(ip, "email-verification", 3);
    this.available();
    await this.issue("verify", user.email, { userId: user.id }, 24);
  }
  async consume(body: unknown, ip: string) {
    await this.throttle(ip, "account-link", 20);
    const v = z
      .object({
        purpose: z.enum(["invite", "reset", "verify"]),
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        password: z.string().min(12).max(128).optional(),
        displayName: z.string().trim().min(2).max(100).optional(),
      })
      .strict()
      .safeParse(body);
    if (
      !v.success ||
      (v.data.purpose !== "verify" && !v.data.password) ||
      (v.data.purpose === "invite" && !v.data.displayName)
    )
      throw new HttpError(
        400,
        "Check your name, link and password (12–128 characters).",
      );
    const { purpose, token, password, displayName } = v.data;
    if (!(await this.repository.lookup(digest(token), purpose)))
      throw new HttpError(
        400,
        "This link is invalid, expired or already used. Request a new one.",
      );
    await this.repository.consume(
      digest(token),
      purpose,
      password ? await hashPassword(password) : undefined,
      displayName,
    );
  }
  async change(actor: User, target: string, body: unknown) {
    const v = z
      .object({
        password: z.string().max(128),
        role: z.enum(["Admin", "Management", "Employee"]).optional(),
        active: z.boolean().optional(),
        revokeSessions: z.literal(true).optional(),
      })
      .strict()
      .safeParse(body);
    if (
      !v.success ||
      !z.uuid().safeParse(target).success ||
      [v.data.role, v.data.active, v.data.revokeSessions].every(
        (x) => x === undefined,
      )
    )
      throw new HttpError(400, "Invalid account change.");
    const a = await this.auth.findUser(actor.email);
    if (!a || !(await verifyPassword(v.data.password, a.password_hash)))
      throw new HttpError(403, "Your current password is incorrect.");
    const { password, ...change } = v.data;
    await this.repository.change(actor.id, a.password_hash, target, change);
  }
  async revoke(actor: User, id: string, password: string) {
    const a = await this.auth.findUser(actor.email);
    if (
      !z.uuid().safeParse(id).success ||
      !a ||
      !(await verifyPassword(password, a.password_hash))
    )
      throw new HttpError(403, "Check your current password and invitation.");
    await this.repository.revokeInvitation(actor.id, a.password_hash, id);
  }
}
