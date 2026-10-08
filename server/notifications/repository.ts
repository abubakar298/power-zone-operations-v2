import type { Pool } from "pg";
import { transaction } from "../db/transaction.js";
import type { User } from "../auth/repository.js";
import type { EmailDelivery } from "../email/delivery.js";
import { notificationMessage } from "../email/templates.js";
export const eventTitle = (kind: string) =>
  ({
    Submitted: "Quotation approval required",
    "Approval requested": "Quotation approval required",
    Approved: "Quotation approved",
    "Changes requested": "Revision requested",
    "PO received": "Customer confirmation received",
  })[kind] ?? kind;
export class NotificationsRepository {
  constructor(private pool: Pool) {}
  // Projection runs separately from business transactions: delivery failures never undo work.
  async sync() {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019032)");
      await c.query(`INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at)
   SELECT gen_random_uuid(),u.id,e.source_key,e.entity_key,e.kind,
    CASE WHEN e.kind IN('Submitted','Approval requested') THEN 'Quotation approval required' WHEN e.kind='Approved' THEN 'Quotation approved' WHEN e.kind='Changes requested' THEN 'Revision requested' ELSE e.kind END,
    e.reference,e.actor_id,e.target,e.actionable,e.created_at
   FROM notification_events e CROSS JOIN notification_settings s JOIN users u ON u.active AND (
    (e.audience='management' AND u.role IN('Admin','Management')) OR
    (e.audience='owner' AND u.id=e.owner_id AND u.role IN('Admin','Management','Coordinator')) OR (e.audience='security' AND u.id=e.owner_id) OR u.role=e.audience)
   WHERE e.created_at>=s.activated_at AND (u.id<>e.actor_id OR e.kind='Security')
   ON CONFLICT(user_id,source_key) DO NOTHING`);
      await c.query(`UPDATE notifications n SET resolved_at=now() WHERE n.resolved_at IS NULL AND n.actionable AND (
   NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.source_key=split_part(split_part(n.source_key,'/reminder',1),'/escalation',1)) OR EXISTS(SELECT 1 FROM notification_events e WHERE e.entity_key=n.entity_key AND e.created_at>n.created_at)
   OR (n.kind='Revision requested' AND EXISTS(SELECT 1 FROM quotation_revision_links l WHERE l.request_id::text=n.target->>'request_id'))
   OR (n.kind='Work assigned' AND EXISTS(SELECT 1 FROM boq_draft_finalizations f WHERE f.draft_id::text=n.target->>'draft_id')))`);
      await c.query(`INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at,parent_id)
   SELECT gen_random_uuid(),n.user_id,n.source_key||'/reminder',n.entity_key,'Reminder','Action overdue',n.reference,NULL,n.target,true,now(),n.id
   FROM notifications n CROSS JOIN notification_settings s WHERE s.reminders_enabled AND n.actionable AND n.resolved_at IS NULL AND n.parent_id IS NULL AND n.created_at<now()-make_interval(hours=>s.reminder_hours) ON CONFLICT DO NOTHING`);
      await c.query(`INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at,parent_id)
   SELECT gen_random_uuid(),u.id,n.source_key||'/escalation',n.entity_key,'Escalation','Overdue work requires attention',n.reference,NULL,n.target,true,now(),n.id
   FROM notifications n CROSS JOIN notification_settings s JOIN users u ON u.active AND u.role IN('Admin','Management')
   WHERE s.reminders_enabled AND n.actionable AND n.resolved_at IS NULL AND n.parent_id IS NULL AND n.created_at<now()-make_interval(hours=>s.reminder_hours*2) AND n.user_id<>u.id ON CONFLICT DO NOTHING`);
      await c.query(
        `UPDATE notifications n SET resolved_at=now() FROM notifications p WHERE n.parent_id=p.id AND p.resolved_at IS NOT NULL AND n.resolved_at IS NULL`,
      );
      await c.query(
        `UPDATE notification_email_queue q SET state='cancelled' FROM notifications n WHERE n.id=q.id AND n.resolved_at IS NOT NULL AND q.state='queued'`,
      );
      await c.query(`INSERT INTO notification_email_queue(id) SELECT n.id FROM notifications n JOIN notification_settings s ON s.email_enabled
   JOIN notification_types t ON t.kind=n.kind AND t.email_enabled LEFT JOIN notification_preferences p ON p.user_id=n.user_id
   WHERE (t.critical OR COALESCE(p.email_enabled,true)) AND n.resolved_at IS NULL AND n.kind NOT IN('PO received') ON CONFLICT DO NOTHING`);
    });
  }
  async list(user: User, id?: string, cursor?: { time: string; id: string }) {
    return (
      await this.pool.query(
        `WITH inbox AS (SELECT COUNT(*) FILTER(WHERE n.read_at IS NULL AND n.resolved_at IS NULL) OVER()::integer AS unread_count,n.id,n.kind,COALESCE(t.title,n.title) AS title,n.reference,n.target,n.actionable,n.created_at,n.read_at,n.resolved_at,COALESCE(u.display_name,'Power Zone') AS actor FROM notifications n JOIN notification_events e ON e.source_key=split_part(split_part(n.source_key,'/reminder',1),'/escalation',1) LEFT JOIN notification_types t ON t.kind=n.kind LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=$1 AND ($3::uuid IS NULL OR n.id=$3) AND ((e.audience='management' AND $2 IN('Admin','Management')) OR (e.audience='owner' AND e.owner_id=$1 AND $2 IN('Admin','Management','Coordinator')) OR (e.audience='security' AND e.owner_id=$1) OR e.audience=$2 OR (n.kind='Escalation' AND $2 IN('Admin','Management'))) ) SELECT * FROM inbox WHERE ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT 100`,
        [
          user.id,
          user.role,
          id ?? null,
          cursor?.time ?? null,
          cursor?.id ?? null,
        ],
      )
    ).rows;
  }
  async read(user: User, id?: string) {
    await this.pool.query(
      "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2)",
      [user.id, id ?? null],
    );
  }
  async unread(user: User, id: string) {
    await this.pool.query(
      "UPDATE notifications SET read_at=NULL WHERE user_id=$1 AND id=$2",
      [user.id, id],
    );
  }
  async preferences(user: User) {
    return (
      await this.pool.query(
        "SELECT COALESCE((SELECT email_enabled FROM notification_preferences WHERE user_id=$1),true) AS email_enabled",
        [user.id],
      )
    ).rows[0];
  }
  async savePreferences(user: User, enabled: boolean) {
    await this.pool.query(
      "INSERT INTO notification_preferences(user_id,email_enabled) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET email_enabled=$2",
      [user.id, enabled],
    );
  }
  async settings() {
    return {
      ...(
        await this.pool.query(
          "SELECT email_enabled,reminders_enabled,reminder_hours FROM notification_settings",
        )
      ).rows[0],
      types: (
        await this.pool.query("SELECT * FROM notification_types ORDER BY kind")
      ).rows,
      delivery: (
        await this.pool.query(
          "SELECT state,provider_status,count(*)::integer AS count FROM notification_email_queue GROUP BY state,provider_status",
        )
      ).rows,
    };
  }
  async saveSettings(
    user: User,
    input: {
      email_enabled: boolean;
      reminders_enabled: boolean;
      reminder_hours: number;
    },
  ) {
    await transaction(this.pool, async (c) => {
      await c.query(
        "UPDATE notification_settings SET email_enabled=$1,reminders_enabled=$2,reminder_hours=$3",
        [input.email_enabled, input.reminders_enabled, input.reminder_hours],
      );
      await c.query(
        "INSERT INTO notification_admin_audit(user_id,action) VALUES($1,$2)",
        [user.id, "notification.settings.updated"],
      );
    });
  }
  async saveType(user: User, kind: string, title: string, email: boolean) {
    await transaction(this.pool, async (c) => {
      await c.query(
        "UPDATE notification_types SET title=$2,email_enabled=CASE WHEN critical THEN true ELSE $3 END WHERE kind=$1",
        [kind, title, email],
      );
      await c.query(
        "INSERT INTO notification_admin_audit(user_id,action) VALUES($1,$2)",
        [user.id, "notification.template.updated"],
      );
    });
  }
  async deliverOne(delivery: EmailDelivery, origin: string) {
    if (!delivery.configured) return;
    return transaction(this.pool, async (c) => {
      const row = (
        await c.query(`SELECT q.*,COALESCE(t.title,n.title) AS title,n.reference,n.target,n.user_id,n.resolved_at,n.kind,n.created_at,t.critical,t.email_enabled AS type_enabled,u.email,u.active,u.role,u.display_name, e.audience,e.owner_id,COALESCE(a.display_name,'Power Zone') AS actor,
    COALESCE(p.email_enabled,true) AS opted_in,s.email_enabled AS enabled FROM notification_email_queue q JOIN notifications n ON n.id=q.id JOIN notification_events e ON e.source_key=split_part(split_part(n.source_key,'/reminder',1),'/escalation',1) JOIN notification_types t ON t.kind=n.kind JOIN users u ON u.id=n.user_id LEFT JOIN users a ON a.id=n.actor_id LEFT JOIN notification_preferences p ON p.user_id=u.id CROSS JOIN notification_settings s WHERE q.state='queued' AND q.next_attempt_at<=now() ORDER BY q.next_attempt_at FOR UPDATE OF q SKIP LOCKED LIMIT 1`)
      ).rows[0];
      if (!row) return;
      if (!row.enabled) return;
      const authorized =
        (row.audience === "management" &&
          ["Admin", "Management"].includes(row.role)) ||
        (row.audience === "owner" &&
          row.owner_id === row.user_id &&
          ["Admin", "Management", "Coordinator"].includes(row.role)) ||
        (row.audience === "security" && row.owner_id === row.user_id) ||
        row.audience === row.role ||
        (row.kind === "Escalation" &&
          ["Admin", "Management"].includes(row.role));
      if (
        !authorized ||
        !row.active ||
        (!row.opted_in && !row.critical) ||
        !row.type_enabled ||
        row.resolved_at
      ) {
        await c.query(
          "UPDATE notification_email_queue SET state='cancelled' WHERE id=$1",
          [row.id],
        );
        return;
      }
      try {
        const provider = await delivery.send(
          notificationMessage(
            row.email,
            row.title,
            row.reference,
            row.actor,
            `${origin}/dashboard#notification=${row.id}`,
            row.created_at,
          ),
          row.id,
        );
        await c.query(
          "UPDATE notification_email_queue SET state='sent',provider_id=$2,delivered_at=now(),attempts=attempts+1,last_error=NULL WHERE id=$1",
          [row.id, provider],
        );
      } catch {
        await c.query(
          "UPDATE notification_email_queue SET attempts=attempts+1,state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'queued' END,next_attempt_at=now()+interval '1 minute'*power(2,attempts),last_error='Provider delivery failed' WHERE id=$1",
          [row.id],
        );
      }
    });
  }
}
