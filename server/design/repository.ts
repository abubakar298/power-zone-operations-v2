import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { designDraftSchema, designSubmissionSchema } from "./schema.js";
export class DesignRepository {
  constructor(private pool: Pool) {}
  async access(c: Pool | PoolClient, actor: string) {
    const u = (
      await c.query(
        "SELECT id,active,role,display_name FROM users WHERE id=$1 FOR SHARE",
        [actor],
      )
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Your access has ended.");
    if (!["Design", "Admin", "Management"].includes(u.role))
      throw new HttpError(403, "Design access required.");
    return u;
  }
  async attachment(actor: string, id: string) {
    const u = await this.access(this.pool, actor);
    const row = (
      await this.pool.query(
        "SELECT a.* FROM survey_uploads a WHERE a.id=$1 AND (a.owner_id=$2 OR ($3 AND EXISTS(SELECT 1 FROM design_surveys d WHERE d.inputs->'uploadIds' ? a.id::text)))",
        [id, actor, u.role !== "Design"],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Survey attachment not found.");
    return row;
  }
  async list(actor: string) {
    const u = await this.access(this.pool, actor);
    return (
      await this.pool.query(
        `SELECT d.*,h.draft_id,h.created_at AS sent_at,h.assigned_to,v.display_name AS assigned_name,o.display_name AS designer,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename)) FROM survey_uploads a WHERE d.inputs->'uploadIds' ? a.id::text),'[]'::jsonb) AS attachments
      FROM design_surveys d JOIN users o ON o.id=d.owner_id LEFT JOIN design_survey_handoffs h ON h.survey_id=d.id LEFT JOIN users v ON v.id=h.assigned_to WHERE ($2 OR d.owner_id=$1) ORDER BY d.updated_at DESC LIMIT 500`,
        [actor, u.role !== "Design"],
      )
    ).rows;
  }
  async references(actor: string) {
    await this.access(this.pool, actor);
    const customers = (
      await this.pool.query(
        "SELECT id,name,short_code FROM customers WHERE status='Active' ORDER BY name",
      )
    ).rows;
    const inverters = (
      await this.pool.query(
        "SELECT configuration,quantity FROM inverter_configurations ORDER BY total_kw,configuration",
      )
    ).rows;
    const coordinators = (
      await this.pool.query(
        "SELECT id,display_name FROM users WHERE active AND role='Coordinator' ORDER BY display_name",
      )
    ).rows;
    return { customers, inverters, coordinators };
  }
  async uploads(c: PoolClient, actor: string, ids: string[]) {
    if (new Set(ids).size !== ids.length)
      throw new HttpError(400, "Duplicate attachment.");
    const n = (
      await c.query(
        "SELECT count(*)::int AS n FROM survey_uploads WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND mime IN('application/pdf','image/png','image/jpeg')",
        [ids, actor],
      )
    ).rows[0].n;
    if (n !== ids.length)
      throw new HttpError(
        403,
        "Attach your own PDF, PNG or JPEG survey forms.",
      );
  }
  async save(
    actor: string,
    id: string | undefined,
    version: number,
    raw: unknown,
  ) {
    const inputs = designDraftSchema.parse(raw);
    return transaction(this.pool, async (c) => {
      const u = await this.access(c, actor);
      await this.uploads(c, actor, inputs.uploadIds);
      if (id) {
        const row = (
          await c.query("SELECT * FROM design_surveys WHERE id=$1 FOR UPDATE", [
            id,
          ])
        ).rows[0];
        if (!row || (u.role === "Design" && row.owner_id !== actor))
          throw new HttpError(404, "Survey not found.");
        if (row.owner_id !== actor)
          throw new HttpError(403, "Only the survey preparer can edit it.");
        if (
          row.version !== version ||
          (
            await c.query(
              "SELECT 1 FROM design_survey_handoffs WHERE survey_id=$1",
              [id],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "Survey changed or was sent. Reload it before continuing.",
          );
        return (
          await c.query(
            "UPDATE design_surveys SET inputs=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id, inputs],
          )
        ).rows[0];
      }
      if (version !== 0)
        throw new HttpError(409, "Start a new survey with version zero.");
      return (
        await c.query(
          "INSERT INTO design_surveys(id,owner_id,inputs) VALUES($1,$2,$3) RETURNING *",
          [randomUUID(), actor, inputs],
        )
      ).rows[0];
    });
  }
  async send(actor: string, id: string, version: number, coordinator: string) {
    return transaction(this.pool, async (c) => {
      await this.access(c, actor);
      const row = (
        await c.query(
          "SELECT * FROM design_surveys WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id, actor],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, "Survey not found.");
      const existing = (
        await c.query(
          "SELECT * FROM design_survey_handoffs WHERE survey_id=$1",
          [id],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.assigned_to !== coordinator ||
          existing.form_version !== version
        )
          throw new HttpError(
            409,
            "Survey was already sent with different details.",
          );
        return existing;
      }
      if (row.version !== version)
        throw new HttpError(409, "Survey changed. Reload before sending.");
      const parsed = designSubmissionSchema.safeParse(row.inputs);
      if (!parsed.success)
        throw new HttpError(400, parsed.error.issues[0].message);
      const inputs = parsed.data;
      await this.uploads(c, actor, inputs.uploadIds);
      const customer = (
        await c.query(
          "SELECT 1 FROM customers WHERE id=$1 AND status='Active'",
          [inputs.customerId],
        )
      ).rowCount;
      if (!customer) throw new HttpError(400, "Select an active customer.");
      const inverter = (
        await c.query(
          "SELECT quantity FROM inverter_configurations WHERE configuration=$1",
          [inputs.inverter],
        )
      ).rows[0];
      if (!inverter)
        throw new HttpError(400, "Select a supported inverter configuration.");
      const rules = (
        await c.query(
          "SELECT DISTINCT ON(key) key,value FROM rule_versions WHERE key IN('engineering-6','engineering-8') ORDER BY key,version DESC",
        )
      ).rows;
      const rule = (key: number) =>
        rules.find((r) => r.key === `engineering-${key}`)?.value;
      if (
        !rule(6) ||
        !rule(8) ||
        new Decimal(rule(6)).lte(0) ||
        new Decimal(rule(8)).lte(0)
      )
        throw new HttpError(422, "Battery rules are not configured.");
      if (
        !new Decimal(inputs.batteryKwh).div(rule(6)).isInteger() ||
        new Decimal(inputs.batteryKwh).gt(
          new Decimal(rule(8)).mul(inverter.quantity),
        )
      )
        throw new HttpError(
          400,
          "Battery capacity must follow the configured module size and inverter limit.",
        );
      const target = (
        await c.query(
          "SELECT display_name FROM users WHERE id=$1 AND active AND role='Coordinator' FOR SHARE",
          [coordinator],
        )
      ).rows[0];
      if (!target) throw new HttpError(400, "Choose an active coordinator.");
      const draft = randomUUID(),
        handoff = randomUUID();
      const { notes, ...survey } = inputs;
      await c.query(
        "INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,$3)",
        [
          draft,
          coordinator,
          {
            ...survey,
            sourceMode: "Survey",
            brands: {},
            preparedBy: target.display_name,
            ocrText: "",
            ocrReviewed: false,
          },
        ],
      );
      const sent = (
        await c.query(
          "INSERT INTO design_survey_handoffs(id,survey_id,form_version,draft_id,assigned_to,created_by,inputs) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [handoff, id, version, draft, coordinator, actor, inputs],
        )
      ).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        actor,
        `design.survey.sent:${id}:${draft}`,
      ]);
      return sent;
    });
  }
}
