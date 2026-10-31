import {closureEmailIdentity} from './closure-identity.js';
import {OperationsIncidentProjector} from './operations-incidents.js';
import {OperationsNotificationProjector,operationsNotificationRecipientAllowed} from './operations-projector.js';
import {notificationRecipientAllowed} from './recipient.js';
import {quotationApprovalAttachments} from './quotation-attachment.js';
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
      // Another live/draining instance will finish the same projection; do not queue
      // a duplicate sweep or tie up a database connection waiting for it.
      const lock=await c.query("SELECT pg_try_advisory_xact_lock(742019032) AS acquired");
      if(!lock.rows[0].acquired)return;
      // Limit the sweep's working memory independently of foreground reads.
      await c.query("SET LOCAL work_mem='512kB'");
      const operationsClock=new Date().toISOString();
      await new OperationsNotificationProjector().sync(c,operationsClock);
      await new OperationsIncidentProjector().sync(c,operationsClock);
      // Evaluate current authorization once, retaining only reference metadata.
      await c.query(`CREATE TEMP TABLE notification_sync_events ON COMMIT DROP AS
       SELECT source_key,entity_key,kind,reference,actor_id,created_at,owner_id,audience,target,actionable
       FROM notification_events WHERE kind<>'Stock shortage'`);
      await c.query('CREATE INDEX ON notification_sync_events(source_key)');
      await c.query('CREATE INDEX ON notification_sync_events(entity_key,created_at)');
      await c.query(`WITH eligible_events AS MATERIALIZED (
   SELECT e.* FROM notification_sync_events e CROSS JOIN notification_settings s WHERE e.kind<>'Stock shortage' AND e.created_at>=s.activated_at
   ) INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at)
   SELECT gen_random_uuid(),u.id,e.source_key,e.entity_key,e.kind,
    CASE WHEN e.kind IN('Submitted','Approval requested') THEN 'Quotation approval required' WHEN e.kind='Approved' THEN 'Quotation approved' WHEN e.kind='Changes requested' THEN 'Revision requested' ELSE e.kind END,
    e.reference,e.actor_id,e.target,e.actionable,e.created_at
   FROM eligible_events e CROSS JOIN notification_settings s JOIN users u ON u.active AND (
    (e.audience='management' AND u.role IN('Admin','Management')) OR
    (e.audience='owner' AND u.id=e.owner_id AND u.role IN('Admin','Management','Coordinator')) OR (e.audience IN('security','assigned') AND u.id=e.owner_id) OR u.role=e.audience)
   WHERE e.kind<>'Stock shortage' AND e.created_at>=s.activated_at AND (u.id<>e.actor_id OR e.kind='Security')
   AND NOT EXISTS(SELECT 1 FROM notifications existing WHERE existing.user_id=u.id AND existing.source_key=e.source_key)
   ON CONFLICT(user_id,source_key) DO NOTHING`);
      // Evaluate the expensive live event view once for both resolution paths.
      // Read-state, audience, deadline and immutable source semantics are unchanged.
      await c.query(`WITH current_events AS MATERIALIZED (
   SELECT source_key,entity_key,created_at FROM notification_sync_events
   ) UPDATE notifications n SET resolved_at=now() WHERE n.resolved_at IS NULL AND (
   ((n.source_key LIKE 'operations-notice:%' OR n.source_key LIKE 'handoff:%') AND NOT EXISTS(SELECT 1 FROM current_events e WHERE e.source_key=n.source_key))
   OR (n.actionable AND (
    NOT EXISTS(SELECT 1 FROM current_events e WHERE e.source_key=split_part(split_part(n.source_key,'/reminder',1),'/escalation',1)) OR (n.source_key NOT LIKE 'operations-notice:%' AND EXISTS(SELECT 1 FROM current_events e WHERE e.entity_key=n.entity_key AND e.created_at>n.created_at))
    OR (n.kind='Revision requested' AND EXISTS(SELECT 1 FROM quotation_revision_links l WHERE l.request_id::text=n.target->>'request_id'))
    OR (n.kind='Work assigned' AND EXISTS(SELECT 1 FROM boq_draft_finalizations f WHERE f.draft_id::text=n.target->>'draft_id')))))`);
      await c.query(`INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at,parent_id)
   SELECT gen_random_uuid(),n.user_id,n.source_key||'/reminder',n.entity_key,'Reminder','Action overdue',n.reference,NULL,n.target,true,now(),n.id
   FROM notifications n CROSS JOIN notification_settings s WHERE n.source_key NOT LIKE 'operations-notice:%' AND s.reminders_enabled AND n.actionable AND n.resolved_at IS NULL AND n.parent_id IS NULL AND n.created_at<now()-make_interval(hours=>s.reminder_hours) AND NOT EXISTS(SELECT 1 FROM notifications existing WHERE existing.user_id=n.user_id AND existing.source_key=n.source_key||'/reminder') ON CONFLICT DO NOTHING`);
      await c.query(`INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at,parent_id)
   SELECT gen_random_uuid(),u.id,n.source_key||'/escalation',n.entity_key,'Escalation','Overdue work requires attention',n.reference,NULL,n.target,true,now(),n.id
   FROM notifications n CROSS JOIN notification_settings s JOIN users u ON u.active AND u.role IN('Admin','Management')
   WHERE n.source_key NOT LIKE 'operations-notice:%' AND s.reminders_enabled AND n.actionable AND n.resolved_at IS NULL AND n.parent_id IS NULL AND n.created_at<now()-make_interval(hours=>s.reminder_hours*2) AND n.user_id<>u.id AND NOT EXISTS(SELECT 1 FROM notifications existing WHERE existing.user_id=u.id AND existing.source_key=n.source_key||'/escalation') ON CONFLICT DO NOTHING`);
      await c.query(
        `UPDATE notifications n SET resolved_at=now() FROM notifications p WHERE n.parent_id=p.id AND p.resolved_at IS NOT NULL AND n.resolved_at IS NULL`,
      );
      await c.query(
        `UPDATE notification_email_queue q SET state='cancelled' FROM notifications n WHERE n.id=q.id AND (n.resolved_at IS NOT NULL OR n.kind='Stock shortage') AND q.state='queued'`,
      );
      await c.query(`INSERT INTO notification_email_queue(id) SELECT n.id FROM notifications n JOIN notification_settings s ON s.email_enabled
   JOIN notification_types t ON t.kind=n.kind AND t.email_enabled LEFT JOIN notification_preferences p ON p.user_id=n.user_id
   WHERE (t.critical OR COALESCE(p.email_enabled,true)) AND n.resolved_at IS NULL AND n.kind NOT IN('PO received','Stock shortage') AND NOT EXISTS(SELECT 1 FROM notification_email_queue existing WHERE existing.id=n.id) ON CONFLICT DO NOTHING`);
    });
  }
  async list(user: User, id?: string, cursor?: { time: string; id: string }) {
    // Empty/new inboxes must not plan or execute the cross-department event view.
    if(!(await this.pool.query("SELECT 1 FROM notifications WHERE user_id=$1 AND kind<>'Stock shortage' AND ($2::uuid IS NULL OR id=$2) LIMIT 1",[user.id,id??null])).rowCount)return [];
    return (
      await this.pool.query(
        `WITH candidates AS MATERIALIZED (SELECT * FROM notifications WHERE user_id=$1 AND kind<>'Stock shortage' AND ($3::uuid IS NULL OR id=$3)), inbox_events AS MATERIALIZED (SELECT source_key,audience,owner_id FROM notification_events e WHERE e.source_key IN(SELECT split_part(split_part(source_key,'/reminder',1),'/escalation',1) FROM candidates) AND ( $2 IN('Admin','Management') OR (e.audience='owner' AND e.owner_id=$1 AND $2='Coordinator') OR (e.audience IN('security','assigned') AND e.owner_id=$1) OR e.audience=$2)), inbox AS (SELECT COUNT(*) FILTER(WHERE n.read_at IS NULL AND n.resolved_at IS NULL) OVER()::integer AS unread_count,n.id,n.kind,COALESCE(t.title,n.title) AS title,n.reference,n.target,n.actionable,n.created_at,n.read_at,n.resolved_at,COALESCE(u.display_name,'Power Zone') AS actor FROM candidates n JOIN inbox_events e ON e.source_key=split_part(split_part(n.source_key,'/reminder',1),'/escalation',1) LEFT JOIN notification_types t ON t.kind=n.kind LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=$1 AND n.kind<>'Stock shortage' AND ($3::uuid IS NULL OR n.id=$3) AND ((e.audience='management' AND $2 IN('Admin','Management')) OR (e.audience='owner' AND e.owner_id=$1 AND $2 IN('Admin','Management','Coordinator')) OR (e.audience IN('security','assigned') AND e.owner_id=$1) OR e.audience=$2 OR (n.kind='Escalation' AND $2 IN('Admin','Management'))) ) SELECT * FROM inbox WHERE ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT 100`,
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
      "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND read_at IS NULL AND ($2::uuid IS NULL OR id=$2)",
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
        await this.pool.query("SELECT kind,title,critical,CASE WHEN kind='Stock shortage' THEN false ELSE email_enabled END AS email_enabled FROM notification_types ORDER BY kind")
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
        [kind, title, kind==='Stock shortage'?false:email],
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
      if(!(await c.query("SELECT 1 FROM notification_email_queue q WHERE q.state='queued' AND q.next_attempt_at<=now() AND EXISTS(SELECT 1 FROM notification_settings WHERE email_enabled) LIMIT 1")).rowCount)return;
      const row = (
        await c.query(`WITH candidate AS MATERIALIZED (
     SELECT * FROM notification_email_queue WHERE state='queued' AND next_attempt_at<=now()
     AND EXISTS(SELECT 1 FROM notification_settings WHERE email_enabled)
     ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) SELECT q.*,COALESCE(t.title,n.title) AS title,n.reference,n.target,n.user_id,n.resolved_at,n.kind,n.created_at,t.critical,t.email_enabled AS type_enabled,u.email,u.active,u.role,u.display_name, e.audience,e.owner_id,e.source_key AS event_source_key,e.kind AS event_kind,COALESCE(a.display_name,'Power Zone') AS actor,
    COALESCE(p.email_enabled,true) AS opted_in,s.email_enabled AS enabled FROM candidate q JOIN notifications n ON n.id=q.id LEFT JOIN notification_events e ON e.source_key=split_part(split_part(n.source_key,'/reminder',1),'/escalation',1) JOIN notification_types t ON t.kind=n.kind JOIN users u ON u.id=n.user_id LEFT JOIN users a ON a.id=n.actor_id LEFT JOIN notification_preferences p ON p.user_id=u.id CROSS JOIN notification_settings s`)
      ).rows[0];
      if (!row) return;
      if (!row.enabled) return;
      const authorized = !!row.event_source_key && notificationRecipientAllowed(row) &&
        (!row.event_source_key.startsWith('operations-notice:') || await operationsNotificationRecipientAllowed(c,row.event_source_key,row.user_id));
      if (
        row.kind==='Stock shortage' ||
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
        const attachments=await quotationApprovalAttachments(c,row);
        const closureIdentity=await closureEmailIdentity(c,row);
        const message=notificationMessage(
            row.email,
            row.title,
            closureIdentity?.reference??row.reference,
            row.actor,
            `${origin}/dashboard#notification=${row.id}`,
            row.created_at,
            closureIdentity?.details,
          );
        if(attachments.length)message.attachments=attachments;
        const provider = await delivery.send(message,row.id);
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
