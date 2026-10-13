import { HttpError } from "../http/errors.js";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";

export interface User {
  id: string;
  email: string;
  display_name: string;
  restrictedCostAccess?: boolean;
  role:
    | "Admin"
    | "Management"
    | "Employee"
    | "Coordinator"
    | "Operations"
    | "Inventory"
    | "Accounts"
    | "Design";
}
export interface StoredUser extends User {
  password_hash: string;
  active: boolean;
  email_verified_at?: Date | null;
}
export interface Session {
  user: User;
  csrfToken: string;
  expiresAt: Date;
  tokenHash: string;
}

export class AuthRepository {
  constructor(private pool: Pool) {}

  async setupRequired() {
    const r = await this.pool.query(
      "SELECT completed_at FROM admin_bootstrap WHERE singleton = true",
    );
    if (r.rowCount !== 1) throw new Error("Missing admin bootstrap migration");
    return r.rows[0].completed_at === null;
  }

  async bootstrap(user: StoredUser) {
    return transaction(this.pool, async (client) => {
      const row = await client.query(
        "SELECT completed_at FROM admin_bootstrap WHERE singleton = true FOR UPDATE",
      );
      if (row.rowCount !== 1)
        throw new Error("Missing admin bootstrap migration");
      if (row.rows[0].completed_at !== null) return false;
      await client.query(
        `INSERT INTO users (id, email, display_name, password_hash, role)
        VALUES ($1,$2,$3,$4,'Admin')`,
        [user.id, user.email, user.display_name, user.password_hash],
      );
      await client.query(
        "UPDATE admin_bootstrap SET completed_at = now() WHERE singleton = true",
      );
      await this.audit(client, user.id, "admin.setup");
      return true;
    });
  }

  async findUser(email: string) {
    const result = await this.pool.query<StoredUser>(
      `SELECT id, email, display_name, role, password_hash, active, email_verified_at,EXISTS(SELECT 1 FROM restricted_cost_access a WHERE a.user_id=users.id) AS "restrictedCostAccess" FROM users WHERE email = $1`,
      [email],
    );
    return result.rows[0];
  }

  async createSession(
    userId: string,
    tokenHash: string,
    csrf: string,
    hours: number,
    oldTokenHash?: string,
    expectedPasswordHash?: string,
  ) {
    return transaction(this.pool, async (client) => {
      const current = await client.query<StoredUser>(
        "SELECT active,password_hash FROM users WHERE id=$1 FOR UPDATE",
        [userId],
      );
      if (
        !current.rows[0]?.active ||
        (expectedPasswordHash &&
          current.rows[0].password_hash !== expectedPasswordHash)
      )
        throw new HttpError(401, "Email or password is incorrect.");
      if (oldTokenHash)
        await client.query("DELETE FROM auth_sessions WHERE token_hash = $1", [
          oldTokenHash,
        ]);
      const r = await client.query<{ expires_at: Date }>(
        `INSERT INTO auth_sessions (user_id,token_hash,csrf_token,expires_at)
        VALUES ($1,$2,$3,now() + $4 * interval '1 hour') RETURNING expires_at`,
        [userId, tokenHash, csrf, hours],
      );
      await this.audit(client, userId, "auth.login");
      return r.rows[0].expires_at;
    });
  }

  async getSession(tokenHash: string): Promise<Session | undefined> {
    const r = await this.pool.query<
      User & { csrf_token: string; expires_at: Date }
    >(
      `SELECT u.id,u.email,u.display_name,u.role,EXISTS(SELECT 1 FROM restricted_cost_access a WHERE a.user_id=u.id) AS "restrictedCostAccess",s.csrf_token,s.expires_at
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true`,
      [tokenHash],
    );
    if (!r.rows[0]) return undefined;
    const { csrf_token, expires_at, ...user } = r.rows[0];
    return { user, csrfToken: csrf_token, expiresAt: expires_at, tokenHash };
  }

  async deleteSession(session: Session) {
    await transaction(this.pool, async (client) => {
      await client.query("DELETE FROM auth_sessions WHERE token_hash = $1", [
        session.tokenHash,
      ]);
      await this.audit(client, session.user.id, "auth.logout");
    });
  }

  async changePassword(userId: string, expectedHash: string, newHash: string) {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        "UPDATE users SET password_hash=$3 WHERE id=$1 AND password_hash=$2 AND active=true RETURNING id",
        [userId, expectedHash, newHash],
      );
      if (!result.rowCount)
        throw new HttpError(
          409,
          "Your account changed. Sign in again before changing your password.",
        );
      await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [
        userId,
      ]);
      await this.audit(client, userId, "auth.password_changed");
    });
  }

  async consumeRateLimit(bucketHash: string, limit: number) {
    // Atomic upsert works across API processes and survives restarts.
    const r = await this.pool.query<{ attempts: number }>(
      `INSERT INTO auth_rate_limits (bucket_hash,attempts,reset_at)
      VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT (bucket_hash) DO UPDATE SET
      attempts = CASE WHEN auth_rate_limits.reset_at <= now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
      reset_at = CASE WHEN auth_rate_limits.reset_at <= now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.reset_at END
      RETURNING attempts`,
      [bucketHash],
    );
    return r.rows[0].attempts <= limit;
  }

  async cleanup() {
    await this.pool.query(
      "DELETE FROM auth_sessions WHERE expires_at <= now()",
    );
    await this.pool.query(
      "DELETE FROM auth_rate_limits WHERE reset_at <= now()",
    );
  }

  private async audit(client: PoolClient, userId: string, action: string) {
    await client.query(
      "INSERT INTO audit_log (user_id,action) VALUES ($1,$2)",
      [userId, action],
    );
  }
}
