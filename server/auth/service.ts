import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import { HttpError } from '../http/errors.js';
import { AuthRepository, type StoredUser, type User } from './repository.js';
import { digest, dummyHash, equalSecrets, hashPassword, newToken, verifyPassword } from './crypto.js';

const credentials = z.object({
  email: z.email().max(254).transform(s => s.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();
const setup = credentials.extend({
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(2).max(100),
  setupToken: z.string().min(1).max(256),
});
export const publicUser = (u: User) => ({ id: u.id, email: u.email, displayName: u.display_name, role: u.role });

export class AuthService {
  constructor(public repository: AuthRepository, private config: Config) {}

  private async throttle(ip: string, scope: string, limit: number) {
    if (!await this.repository.consumeRateLimit(digest(`${scope}:${ip}`), limit)) {
      throw new HttpError(429, 'Too many attempts. Please try again in 15 minutes.');
    }
  }

  async createAdmin(body: unknown, ip: string) {
    await this.throttle(ip, 'setup', 10);
    if (!await this.repository.setupRequired()) throw new HttpError(409, 'Administrator setup is already complete.');
    const input = setup.safeParse(body);
    if (!input.success) throw new HttpError(400, 'Enter a valid email, name, setup key and a password of 12–128 characters.');
    if (!equalSecrets(input.data.setupToken, this.config.setupToken)) throw new HttpError(403, 'The setup key is invalid.');
    const user: StoredUser = {
      id: randomUUID(), email: input.data.email, display_name: input.data.displayName,
      password_hash: await hashPassword(input.data.password), role: 'Admin', active: true,
    };
    if (!await this.repository.bootstrap(user)) throw new HttpError(409, 'Administrator setup is already complete.');
  }

  async login(body: unknown, ip: string, oldTokenHash?: string) {
    await this.throttle(ip, 'login-ip', 30);
    const input = credentials.safeParse(body);
    if (!input.success) throw new HttpError(400, 'Enter a valid email and password.');
    // Protect an account across IP addresses as well as each client IP.
    if (!await this.repository.consumeRateLimit(digest(`login-email:${input.data.email}`), 10)) {
      throw new HttpError(429, 'Too many attempts. Please try again in 15 minutes.');
    }
    const user = await this.repository.findUser(input.data.email);
    const valid = await verifyPassword(input.data.password, user?.password_hash ?? dummyHash);
    if (!user || !valid || !user.active) throw new HttpError(401, 'Email or password is incorrect.');
    const token = newToken(), csrfToken = newToken();
    const expiresAt = await this.repository.createSession(user.id, digest(token), csrfToken, this.config.sessionHours, oldTokenHash);
    return { token, csrfToken, expiresAt, user: publicUser(user) };
  }
}
