import type { Pool } from "pg";
import { sha256Hex, type ObjectStore } from "./r2-store.js";

// Copies stored files from PostgreSQL to an object store (Cloudflare R2).
// Step 1 of the R2 rollout: the database copy stays the source of truth and
// is never changed or deleted here. Each copy is read back and checked by
// sha256 before it is recorded in document_object_copies, so a recorded row
// always means "R2 holds exactly these bytes".

export interface FileSource {
  table: string;
  /** Primary key column (cast to text). */
  key: string;
  /** bytea column holding the file. */
  column: string;
  /** R2 folder. */
  folder: string;
  created?: string;
  media?: string;
  name?: string;
  /** Added to the object name when a row has more than one file. */
  suffix?: string;
}

export const fileSources: readonly FileSource[] = [
  { table: "operations_board_files", key: "id", column: "content", folder: "qc-evidence", created: "created_at", media: "media_type", name: "filename" },
  { table: "project_workflow_files", key: "id", column: "content", folder: "workflow-files", created: "created_at", media: "mime", name: "filename" },
  { table: "notification_email_attachments", key: "notification_id", column: "content", folder: "quotation-emails", created: "created_at", media: "mime", name: "filename" },
  { table: "inventory_report_files", key: "id", column: "content", folder: "inventory-reports", created: "created_at", media: "media_type", name: "filename" },
  { table: "survey_uploads", key: "id", column: "content", folder: "survey-uploads", created: "created_at", media: "mime", name: "filename" },
  { table: "inventory_material_evidence", key: "id", column: "content", folder: "inventory-evidence", created: "created_at", media: "media_type", name: "original_name" },
  { table: "job_closure_evidence", key: "id", column: "content", folder: "closure-evidence", created: "created_at", media: "media_type", name: "filename" },
  { table: "customer_po_documents", key: "id", column: "content", folder: "customer-po", created: "created_at", media: "mime", name: "filename" },
  { table: "framework_reference_attachments", key: "id", column: "content", folder: "framework-references", created: "created_at", media: "mime", name: "filename" },
  { table: "ubl_workflow_attachments", key: "id", column: "content", folder: "ubl/workflow-attachments", created: "created_at", media: "mime", name: "filename" },
  { table: "ubl_workflow_sources", key: "sha256", column: "content", folder: "ubl/workflow-sources", created: "created_at", name: "filename" },
  { table: "ubl_source_documents", key: "configuration_id", column: "content", folder: "ubl/source-documents", name: "filename" },
  { table: "ubl_survey_review_packages", key: "id", column: "xlsx", folder: "ubl/survey-packages", created: "created_at", suffix: "-xlsx" },
  { table: "ubl_survey_review_packages", key: "id", column: "report_pdf", folder: "ubl/survey-packages", created: "created_at", suffix: "-report" },
];

const extensions: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const types = Object.fromEntries(
  Object.entries(extensions).map(([type, ext]) => [ext, type]),
);

export function fileType(source: FileSource, media?: string | null, name?: string | null) {
  if (source.column === "xlsx") return { ext: "xlsx", type: types.xlsx! };
  if (source.column === "report_pdf") return { ext: "pdf", type: "application/pdf" };
  const fromMedia = media ? extensions[media.toLowerCase()] : undefined;
  if (fromMedia) return { ext: fromMedia, type: media!.toLowerCase() };
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(name ?? "")?.[1]?.toLowerCase();
  if (fromName) return { ext: fromName, type: types[fromName] ?? "application/octet-stream" };
  return { ext: "bin", type: "application/octet-stream" };
}

const safeId = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);

/** e.g. qc-evidence/2026/11/9f2c...e1.jpg — fixed by the row, so retries reuse it. */
export function objectKey(source: FileSource, id: string, created: Date | null | undefined, ext: string) {
  const name = `${safeId(id)}${source.suffix ?? ""}.${ext}`;
  if (!created) return `${source.folder}/${name}`;
  const year = created.getUTCFullYear();
  const month = String(created.getUTCMonth() + 1).padStart(2, "0");
  return `${source.folder}/${year}/${month}/${name}`;
}

const pendingWhere = (s: FileSource) =>
  `t.${s.column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_object_copies c WHERE c.source_table='${s.table}' AND c.source_column='${s.column}' AND c.source_id=t.${s.key}::text)`;

/** Files not yet copied, per table. octet_length on bytea reads only the stored size. */
export async function pendingSummary(pool: Pool) {
  const rows: { table: string; column: string; files: number; bytes: number }[] = [];
  for (const s of fileSources) {
    const r = (
      await pool.query(
        `SELECT count(*)::int AS files, coalesce(sum(octet_length(t.${s.column})),0)::bigint AS bytes FROM ${s.table} t WHERE ${pendingWhere(s)}`,
      )
    ).rows[0];
    rows.push({ table: s.table, column: s.column, files: r.files, bytes: Number(r.bytes) });
  }
  return rows;
}

export interface CopyOptions {
  /** Most files copied in this call. */
  limit: number;
  /** Only rows created in the last N days (rows without a date are skipped). Omit for all rows. */
  recentDays?: number;
  /** Skip rows that failed recently (key "table:column:id"). */
  skip?: (id: string) => boolean;
  log?: (line: Record<string, unknown>) => void;
}

export interface CopyResult {
  copied: number;
  bytes: number;
  failed: { id: string; table: string; reason: string }[];
}

export async function copyPending(pool: Pool, store: ObjectStore, options: CopyOptions): Promise<CopyResult> {
  const result: CopyResult = { copied: 0, bytes: 0, failed: [] };
  for (const s of fileSources) {
    if (result.copied + result.failed.length >= options.limit) break;
    if (options.recentDays !== undefined && !s.created) continue;
    const params: unknown[] = [];
    let where = pendingWhere(s);
    if (options.recentDays !== undefined) {
      params.push(options.recentDays);
      where += ` AND t.${s.created} >= now() - make_interval(days => $1)`;
    }
    const candidates = (
      await pool.query(
        `SELECT t.${s.key}::text AS id${s.created ? `, t.${s.created} AS created` : ""}${s.media ? `, t.${s.media} AS media` : ""}${s.name ? `, t.${s.name} AS name` : ""}
         FROM ${s.table} t WHERE ${where}
         ORDER BY ${s.created ? `t.${s.created} DESC, ` : ""}t.${s.key}::text LIMIT 500`,
        params,
      )
    ).rows as { id: string; created?: Date; media?: string; name?: string }[];
    for (const row of candidates) {
      if (result.copied + result.failed.length >= options.limit) break;
      const ref = `${s.table}:${s.column}:${row.id}`;
      if (options.skip?.(ref)) continue;
      try {
        const bytes = await copyOne(pool, store, s, row);
        if (bytes === undefined) continue;
        result.copied++;
        result.bytes += bytes;
        options.log?.({ event: "document_storage.copied", table: s.table, column: s.column, id: row.id, bytes });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        result.failed.push({ id: ref, table: s.table, reason });
        options.log?.({ event: "document_storage.copy_failed", table: s.table, column: s.column, id: row.id, reason });
      }
    }
  }
  return result;
}

async function copyOne(
  pool: Pool,
  store: ObjectStore,
  s: FileSource,
  row: { id: string; created?: Date; media?: string; name?: string },
) {
  const found = (
    await pool.query(`SELECT t.${s.column} AS content FROM ${s.table} t WHERE t.${s.key}::text=$1`, [row.id])
  ).rows[0];
  const content: Buffer | null | undefined = found?.content;
  if (!content || content.length === 0) return undefined;
  const hash = sha256Hex(content);
  const { ext, type } = fileType(s, row.media, row.name);
  const key = objectKey(s, row.id, row.created ? new Date(row.created) : undefined, ext);
  await store.put(key, content, type);
  // Read back and compare: also covers "exists" (an earlier run uploaded it
  // but stopped before recording) and proves downloads from R2 work.
  const back = await store.get(key);
  if (!back) throw new Error("R2 copy missing after upload");
  if (sha256Hex(back) !== hash) throw new Error("R2 copy does not match the database file");
  await pool.query(
    `INSERT INTO document_object_copies(source_table,source_column,source_id,object_key,sha256,size)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [s.table, s.column, row.id, key, hash, content.length],
  );
  return content.length;
}

/**
 * Background copier for new uploads (Option 1): uploads save to the database
 * exactly as before, and this copies them to R2 shortly after. A failed row
 * waits before it is tried again, so an R2 outage never blocks uploads.
 */
export function newUploadCopier(
  pool: Pool,
  store: ObjectStore,
  log: (line: Record<string, unknown>) => void,
  now: () => number = Date.now,
) {
  const retryAt = new Map<string, number>();
  const failures = new Map<string, number>();
  let running = false;
  return async function tick() {
    if (running) return undefined;
    running = true;
    try {
      const result = await copyPending(pool, store, {
        limit: 5,
        recentDays: 7,
        skip: (id) => (retryAt.get(id) ?? 0) > now(),
        log,
      });
      for (const f of result.failed) {
        const count = (failures.get(f.id) ?? 0) + 1;
        failures.set(f.id, count);
        // 1, 2, 4 ... minutes, at most one hour.
        retryAt.set(f.id, now() + Math.min(60, 2 ** (count - 1)) * 60000);
      }
      return result;
    } catch (error) {
      log({ event: "document_storage.copy_interrupted", reason: error instanceof Error ? error.message : "Unknown error" });
      return undefined;
    } finally {
      running = false;
    }
  };
}
