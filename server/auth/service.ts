import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.js";
import { HttpError } from "../http/errors.js";
import { AuthRepository, type StoredUser, type User } from "./repository.js";
import {
  digest,
  dummyHash,
  equalSecrets,
  hashPassword,
  newToken,
  verifyPassword,
} from "./crypto.js";

const credentials = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
const setup = credentials.extend({
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(2).max(100),
  setupToken: z.string().min(1).max(256),
});
export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  displayName: u.display_name,
  role: u.role,
  restrictedCostAccess: u.restrictedCostAccess === true,
});

export class AuthService {
  constructor(
    public repository: AuthRepository,
    private config: Config,
  ) {}

  private async throttle(ip: string, scope: string, limit: number) {
    if (
      !(await this.repository.consumeRateLimit(digest(`${scope}:${ip}`), limit))
    ) {
      throw new HttpError(
        429,
        "Too many attempts. Please try again in 15 minutes.",
      );
    }
  }

  async createAdmin(body: unknown, ip: string) {
    await this.throttle(ip, "setup", 10);
    if (!(await this.repository.setupRequired()))
      throw new HttpError(409, "Administrator setup is already complete.");
    const input = setup.safeParse(body);
    if (!input.success)
      throw new HttpError(
        400,
        "Enter a valid email, name, setup key and a password of 12–128 characters.",
      );
    if (!equalSecrets(input.data.setupToken, this.config.setupToken))
      throw new HttpError(403, "The setup key is invalid.");
    const user: StoredUser = {
      id: randomUUID(),
      email: input.data.email,
      display_name: input.data.displayName,
      password_hash: await hashPassword(input.data.password),
      role: "Admin",
      active: true,
    };
    if (!(await this.repository.bootstrap(user)))
      throw new HttpError(409, "Administrator setup is already complete.");
  }

  async changePassword(user: User, body: unknown, ip: string) {
    await this.throttle(ip, `change-password:${user.id}`, 10);
    const parsed = z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(12).max(128),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Enter your current password and a new password of 12–128 characters.",
      );
    const stored = await this.repository.findUser(user.email);
    if (
      !stored ||
      stored.id !== user.id ||
      !(await verifyPassword(parsed.data.currentPassword, stored.password_hash))
    )
      throw new HttpError(400, "Your current password is incorrect.");
    if (parsed.data.currentPassword === parsed.data.newPassword)
      throw new HttpError(400, "Choose a different new password.");
    await this.repository.changePassword(
      user.id,
      stored.password_hash,
      await hashPassword(parsed.data.newPassword),
    );
  }

  /** Password re-entry before money approvals (Moaz, 24 Oct 2026). Every try counts toward the sign-in lockout. */
  async confirmPassword(user: User, body: unknown, ip: string) {
    await this.throttle(ip, "password-check-ip", 30);
    const input = z.object({ password: z.string().min(1).max(128) }).strict().safeParse(body);
    if (!input.success) throw new HttpError(400, "Enter your password.");
    if (!(await this.repository.consumeRateLimit(digest(`login-email:${user.email}`), 10)))
      throw new HttpError(429, "Too many attempts. Please try again in 15 minutes.");
    const stored = await this.repository.findUser(user.email);
    if (!stored?.active || !(await verifyPassword(input.data.password, stored.password_hash)))
      throw new HttpError(403, "Your password is incorrect.");
  }

  async login(body: unknown, ip: string, oldTokenHash?: string) {
    await this.throttle(ip, "login-ip", 30);
    const input = credentials.safeParse(body);
    if (!input.success)
      throw new HttpError(400, "Enter a valid email and password.");
    // Protect an account across IP addresses as well as each client IP.
    if (
      !(await this.repository.consumeRateLimit(
        digest(`login-email:${input.data.email}`),
        10,
      ))
    ) {
      throw new HttpError(
        429,
        "Too many attempts. Please try again in 15 minutes.",
      );
    }
    const user = await this.repository.findUser(input.data.email);
    const valid = await verifyPassword(
      input.data.password,
      user?.password_hash ?? dummyHash,
    );
    if (!user || !valid || !user.active)
      throw new HttpError(401, "Email or password is incorrect.");
    const token = newToken(),
      csrfToken = newToken();
    const expiresAt = await this.repository.createSession(
      user.id,
      digest(token),
      csrfToken,
      this.config.sessionHours,
      oldTokenHash,
      user.password_hash,
    );
    return { token, csrfToken, expiresAt, user: publicUser(user) };
  }
}
