import type { Pool, PoolClient } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { transaction } from "../db/transaction.js";
import { MastersRepository } from "../masters/repository.js";
import { calculate } from "./engine.js";
import { surveySchema, type Survey, type SurveyDraft } from "./schema.js";
import { HttpError } from "../http/errors.js";
function fingerprint(value: unknown) {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value)))))
    .digest("hex");
}
export class BoqRepository {
  constructor(private pool: Pool) {}
  async drafts(owner: string) {
    return (
      await this.pool.query(
        "SELECT id,inputs,version,updated_at FROM survey_drafts WHERE owner_id=$1 AND id NOT IN (SELECT draft_id FROM boqs) ORDER BY updated_at DESC LIMIT 100",
        [owner],
      )
    ).rows;
  }
  async draft(
    owner: string,
    id: string | undefined,
    version: number,
    inputs: SurveyDraft,
  ) {
    return transaction(this.pool, async (c) => {
      await this.actor(c, owner);
      await this.uploads(c, owner, inputs.uploadIds);
      if (id) {
        const row = (
          await c.query(
            "UPDATE survey_drafts SET inputs=$1,version=version+1,updated_at=now() WHERE id=$2 AND owner_id=$3 AND version=$4 AND id NOT IN (SELECT draft_id FROM boqs) RETURNING id,version",
            [inputs, id, owner, version],
          )
        ).rows[0];
        if (!row)
          throw new HttpError(
            409,
            "This draft changed or was saved. Reload the latest draft.",
          );
        return row;
      }
      const next = randomUUID();
      await c.query(
        "INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,$3)",
        [next, owner, inputs],
      );
      return { id: next, version: 1 };
    });
  }
  async preview(s: Survey) {
    const result = calculate(s, await new MastersRepository(this.pool).list());
    return { snapshot: result, fingerprint: fingerprint(result) };
  }
  private async actor(c: PoolClient, id: string) {
    const u = (
      await c.query("SELECT active FROM users WHERE id=$1 FOR SHARE", [id])
    ).rows[0];
    if (!u?.active) throw new HttpError(401, "Your access has ended.");
  }
  private async uploads(c: PoolClient, owner: string, ids: string[]) {
    if (!ids.length) return;
    if (new Set(ids).size !== ids.length)
      throw new HttpError(400, "Duplicate attachment.");
    const n = (
      await c.query(
        "SELECT count(*) FROM survey_uploads WHERE id=ANY($1::uuid[]) AND owner_id=$2",
        [ids, owner],
      )
    ).rows[0].count;
    if (Number(n) !== ids.length)
      throw new HttpError(403, "One or more attachments are unavailable.");
  }
  async save(owner: string, id: string, version: number, expected: string) {
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(742019002)");
      await this.actor(c, owner);
      const d = (
        await c.query(
          "SELECT * FROM survey_drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id, owner],
        )
      ).rows[0];
      if (!d) throw new HttpError(404, "Draft not found.");
      const existing = (
        await c.query(
          "SELECT r.* FROM boqs b JOIN boq_revisions r ON r.boq_id=b.id WHERE b.draft_id=$1 AND r.revision=0",
          [id],
        )
      ).rows[0];
      if (existing) return existing;
      if (d.version !== version)
        throw new HttpError(409, "This draft changed. Review it again.");
      const parsed = surveySchema.safeParse(d.inputs);
      if (!parsed.success)
        throw new HttpError(
          400,
          "Complete the survey fields before saving a BOQ.",
        );
      const s = parsed.data;
      if (s.uploadIds.length && !s.ocrReviewed)
        throw new HttpError(
          400,
          "Review uploaded source information before saving.",
        );
      await this.uploads(c, owner, s.uploadIds);
      // Read all masters on the transaction connection while the master-write lock is held.
      const snapshot = calculate(
        s,
        await new MastersRepository(c, true).list(),
      );
      if (fingerprint(snapshot) !== expected)
        throw new HttpError(
          409,
          "Reference data changed after your preview. Recalculate and review before saving.",
        );
      if (
        (
          await c.query(
            "SELECT id FROM sites WHERE customer_id=$1 AND lower(code)=lower($2)",
            [s.customerId, s.siteCode],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "This customer already has a site with this code. New BOQ requires a new site; choose a new code.",
        );
      const site = (
        await c.query("SELECT COALESCE(max(id),0)+1 AS id FROM sites")
      ).rows[0].id;
      await c.query(
        "INSERT INTO sites(id,customer_id,name,code,location,status) VALUES($1,$2,$3,$4,$5,'Active')",
        [site, s.customerId, s.siteName, s.siteCode, s.location],
      );
      const sequence = 1,
        boq = randomUUID(),
        revision = randomUUID(),
        number = `${snapshot.customer.shortCode}-${s.siteCode}-${String(sequence).padStart(3, "0")}-R0`;
      await c.query(
        "INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [boq, id, site, s.customerId, sequence, owner],
      );
      const saved = (
        await c.query(
          "INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by) VALUES($1,$2,0,$3,$4,$5) RETURNING *",
          [revision, boq, number, snapshot, owner],
        )
      ).rows[0];
      for (const upload of s.uploadIds)
        await c.query(
          "INSERT INTO boq_uploads(revision_id,upload_id) VALUES($1,$2)",
          [revision, upload],
        );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
        owner,
        `boq.${number}.created`,
      ]);
      return saved;
    });
  }
  async list() {
    return (
      await this.pool.query(
        "SELECT r.id,r.number,r.created_at,r.snapshot->'customer'->>'name' AS customer,r.snapshot->'survey'->>'siteName' AS site,r.snapshot->>'total' AS total FROM boq_revisions r ORDER BY created_at DESC LIMIT 200",
      )
    ).rows;
  }
  async get(id: string) {
    const r = (
      await this.pool.query("SELECT * FROM boq_revisions WHERE id=$1", [id])
    ).rows[0];
    if (!r) throw new HttpError(404, "BOQ not found.");
    return r;
  }
  async upload(owner: string, name: string, mime: string, bytes: Buffer) {
    return transaction(this.pool, async (c) => {
      await this.actor(c, owner);
      const quota = (
        await c.query(
          "SELECT count(*) FROM survey_uploads WHERE owner_id=$1 AND created_at>now()-interval '1 hour'",
          [owner],
        )
      ).rows[0].count;
      if (Number(quota) >= 20)
        throw new HttpError(429, "Upload limit reached. Try again later.");
      const id = randomUUID();
      await c.query(
        "INSERT INTO survey_uploads(id,owner_id,filename,mime,size,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          owner,
          name,
          mime,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          bytes,
        ],
      );
      return { id, filename: name, mime, size: bytes.length };
    });
  }
  async attachment(owner: string, id: string) {
    const r = (
      await this.pool.query(
        "SELECT * FROM survey_uploads WHERE id=$1 AND (owner_id=$2 OR EXISTS(SELECT 1 FROM boq_uploads WHERE upload_id=$1))",
        [id, owner],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "Attachment not found.");
    return r;
  }
}
