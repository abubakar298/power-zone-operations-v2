import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import type { StoredUser, User } from "../auth/repository.js";
import { unseal, type EmailDelivery } from "../email/delivery.js";

type Purpose = "invite" | "reset" | "verify";
export interface AccountToken {
  id: string;
  purpose: Purpose;
  email: string;
  role: User["role"] | null;
  user_id: string | null;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}
export class AccountsRepository {
  constructor(private pool: Pool) {}
  private async lock(client: PoolClient) {
    await client.query(
      "SELECT singleton FROM admin_bootstrap WHERE singleton FOR UPDATE",
    );
  }
  private async actor(client: PoolClient, id: string, passwordHash: string) {
    const r = await client.query<StoredUser>(
      "SELECT * FROM users WHERE id=$1 FOR UPDATE",
      [id],
    );
    const user = r.rows[0];
    if (
      !user?.active ||
      user.role !== "Admin" ||
      user.password_hash !== passwordHash
    )
      throw new HttpError(403, "Your account access changed. Sign in again.");
  }
  private async audit(
    client: PoolClient,
    actor: string | null,
    action: string,
    target?: string,
  ) {
    await client.query(
      "INSERT INTO audit_log (user_id,action,target_user_id) VALUES ($1,$2,$3)",
      [actor, action, target ?? null],
    );
  }
  private async cancelTokens(
    client: PoolClient,
    where: string,
    params: unknown[],
  ) {
    const r = await client.query<{ id: string }>(
      `UPDATE account_tokens SET revoked_at=now() WHERE used_at IS NULL AND revoked_at IS NULL AND ${where} RETURNING id`,
      params,
    );
    if (r.rowCount)
      await client.query(
        "UPDATE email_outbox SET status='cancelled',encrypted_message=NULL WHERE id=ANY($1::uuid[]) AND status IN ('queued','failed')",
        [r.rows.map((t) => t.id)],
      );
  }
  async list() {
    const users = await this.pool.query(
      "SELECT id,email,display_name,role,active,email_verified_at,created_at FROM users ORDER BY created_at,id",
    );
    const invitations = await this.pool
      .query(`SELECT t.id,t.email,t.role,t.expires_at,o.status AS delivery_status FROM account_tokens t JOIN email_outbox o ON o.id=t.id
      WHERE t.purpose='invite' AND t.used_at IS NULL AND t.revoked_at IS NULL ORDER BY t.created_at DESC`);
    return { users: users.rows, invitations: invitations.rows };
  }
  async createDirect(input: {
    email: string;
    displayName: string;
    role: User["role"];
    passwordHash: string;
    actorId: string;
    actorHash: string;
  }) {
    return transaction(this.pool, async (c) => {
      await this.lock(c);
      await this.actor(c, input.actorId, input.actorHash);
      if (
        (await c.query("SELECT id FROM users WHERE email=$1", [input.email]))
          .rowCount
      )
        throw new HttpError(409, "An account already exists for this email.");
      await this.cancelTokens(c, "email=$1 AND purpose='invite'", [
        input.email,
      ]);
      const id = randomUUID();
      await c.query(
        "INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
        [id, input.email, input.displayName, input.role, input.passwordHash],
      );
      await this.audit(c, input.actorId, "account.created.by_admin", id);
      return { id, email: input.email, role: input.role };
    });
  }
  async issue(input: {
    hash: string;
    purpose: Purpose;
    email: string;
    role?: User["role"];
    userId?: string;
    actorId?: string;
    actorHash?: string;
    encrypted: string;
    hours: number;
  }) {
    return transaction(this.pool, async (c) => {
      await this.lock(c);
      if (input.actorId) await this.actor(c, input.actorId, input.actorHash!);
      if (input.purpose === "invite") {
        if (
          (await c.query("SELECT id FROM users WHERE email=$1", [input.email]))
            .rowCount
        )
          throw new HttpError(
            409,
            "This email already has an account. Manage it below.",
          );
      } else {
        const user = (
          await c.query(
            "SELECT active,email_verified_at,email FROM users WHERE id=$1 FOR UPDATE",
            [input.userId],
          )
        ).rows[0];
        if (
          !user?.active ||
          user.email !== input.email ||
          (input.purpose === "reset" && !user.email_verified_at)
        )
          return false;
      }
      await this.cancelTokens(c, "purpose=$1 AND email=$2", [
        input.purpose,
        input.email,
      ]);
      const id = randomUUID();
      await c.query(
        `INSERT INTO account_tokens (id,token_hash,purpose,email,role,user_id,created_by,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,now()+$8 * interval '1 hour')`,
        [
          id,
          input.hash,
          input.purpose,
          input.email,
          input.role ?? null,
          input.userId ?? null,
          input.actorId ?? null,
          input.hours,
        ],
      );
      await c.query(
        "INSERT INTO email_outbox(id,encrypted_message) VALUES ($1,$2)",
        [id, input.encrypted],
      );
      await this.audit(
        c,
        input.actorId ?? input.userId ?? null,
        `account.${input.purpose}.requested`,
        input.userId,
      );
      return true;
    });
  }
  async lookup(hash: string, purpose: Purpose) {
    const r = await this.pool.query<AccountToken>(
      `SELECT id,purpose,email,role,user_id,expires_at,used_at,revoked_at FROM account_tokens
      WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()`,
      [hash, purpose],
    );
    return r.rows[0];
  }
  async consume(
    hash: string,
    purpose: Purpose,
    passwordHash?: string,
    displayName?: string,
  ) {
    return transaction(this.pool, async (c) => {
      await this.lock(c);
      const t = (
        await c.query<AccountToken>(
          `SELECT * FROM account_tokens WHERE token_hash=$1 AND purpose=$2
        AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
          [hash, purpose],
        )
      ).rows[0];
      if (!t)
        throw new HttpError(
          400,
          "This link is invalid, expired or already used. Request a new one.",
        );
      let id = t.user_id;
      if (purpose === "invite") {
        if (
          (await c.query("SELECT id FROM users WHERE email=$1", [t.email]))
            .rowCount
        )
          throw new HttpError(
            409,
            "This email already has an account. Sign in instead.",
          );
        id = randomUUID();
        await c.query(
          `INSERT INTO users(id,email,display_name,role,password_hash,email_verified_at)
          VALUES($1,$2,$3,$4,$5,now())`,
          [id, t.email, displayName, t.role, passwordHash],
        );
      } else {
        const u = (
          await c.query(
            "SELECT active,email,email_verified_at FROM users WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (
          !u?.active ||
          u.email !== t.email ||
          (purpose === "reset" && !u.email_verified_at)
        )
          throw new HttpError(
            400,
            "This link is invalid, expired or already used. Request a new one.",
          );
        if (purpose === "reset") {
          await c.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
            passwordHash,
            id,
          ]);
          await c.query("DELETE FROM auth_sessions WHERE user_id=$1", [id]);
          await this.cancelTokens(c, "user_id=$1 AND id<>$2", [id, t.id]);
        } else
          await c.query(
            "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1",
            [id],
          );
      }
      await c.query("UPDATE account_tokens SET used_at=now() WHERE id=$1", [
        t.id,
      ]);
      await c.query(
        "UPDATE email_outbox SET status=CASE WHEN status='accepted' THEN status ELSE 'cancelled' END,encrypted_message=NULL WHERE id=$1",
        [t.id],
      );
      await this.audit(c, id, `account.${purpose}.completed`, id!);
    });
  }
  async change(
    actorId: string,
    actorHash: string,
    targetId: string,
    change: { role?: User["role"]; active?: boolean; revokeSessions?: boolean },
  ) {
    await transaction(this.pool, async (c) => {
      await this.lock(c);
      await this.actor(c, actorId, actorHash);
      const target = (
        await c.query<StoredUser>(
          "SELECT * FROM users WHERE id=$1 FOR UPDATE",
          [targetId],
        )
      ).rows[0];
      if (!target) throw new HttpError(404, "Account not found.");
      if (
        targetId === actorId &&
        (change.active === false || (change.role && change.role !== "Admin"))
      )
        throw new HttpError(
          409,
          "You cannot disable or demote your own administrator account.",
        );
      if (
        target.active &&
        target.role === "Admin" &&
        (change.active === false || (change.role && change.role !== "Admin"))
      ) {
        const n = (
          await c.query(
            "SELECT count(*) FROM users WHERE active AND role='Admin'",
          )
        ).rows[0].count;
        if (Number(n) <= 1)
          throw new HttpError(
            409,
            "At least one active administrator is required.",
          );
      }
      await c.query(
        "UPDATE users SET role=COALESCE($1,role),active=COALESCE($2,active) WHERE id=$3",
        [change.role ?? null, change.active ?? null, targetId],
      );
      // Every access change revokes existing sessions and recovery links, including reactivation.
      await c.query("DELETE FROM auth_sessions WHERE user_id=$1", [targetId]);
      await this.cancelTokens(c, "user_id=$1", [targetId]);
      const action = change.role
        ? "account.role.changed"
        : change.active !== undefined
          ? change.active
            ? "account.activated"
            : "account.deactivated"
          : "account.sessions.revoked";
      await this.audit(c, actorId, action, targetId);
    });
  }
  async revokeInvitation(actorId: string, actorHash: string, id: string) {
    await transaction(this.pool, async (c) => {
      await this.lock(c);
      await this.actor(c, actorId, actorHash);
      const t = (
        await c.query(
          "SELECT id FROM account_tokens WHERE id=$1 AND purpose='invite' AND used_at IS NULL AND revoked_at IS NULL",
          [id],
        )
      ).rows[0];
      if (!t) throw new HttpError(404, "Pending invitation not found.");
      await this.cancelTokens(c, "id=$1", [id]);
      await this.audit(c, actorId, "account.invite.revoked");
    });
  }
  async deliverOne(delivery: EmailDelivery, key: string) {
    return transaction(this.pool, async (c) => {
      // SKIP LOCKED supports multiple web instances; provider idempotency covers a crash after sending.
      const row = (
        await c.query(`SELECT o.* FROM email_outbox o JOIN account_tokens t ON t.id=o.id
        WHERE o.status='queued' AND o.next_attempt_at<=now() AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now()
        ORDER BY o.next_attempt_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED`)
      ).rows[0];
      if (!row) return false;
      try {
        const providerId = await delivery.send(
          unseal(row.encrypted_message, key),
          row.id,
        );
        await c.query(
          "UPDATE email_outbox SET status='accepted',accepted_at=now(),provider_id=$2,encrypted_message=NULL,attempts=attempts+1 WHERE id=$1",
          [row.id, providerId],
        );
      } catch {
        await c.query(
          `UPDATE email_outbox SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'queued' END,
          next_attempt_at=now()+interval '1 minute' * power(2,attempts) WHERE id=$1`,
          [row.id],
        );
      }
      return true;
    });
  }
  async cleanup() {
    await this.pool
      .query(`UPDATE email_outbox o SET encrypted_message=NULL,status=CASE WHEN status='accepted' THEN status ELSE 'cancelled' END
      FROM account_tokens t WHERE o.id=t.id AND o.encrypted_message IS NOT NULL AND (t.expires_at<=now() OR t.used_at IS NOT NULL OR t.revoked_at IS NOT NULL)`);
  }
}
