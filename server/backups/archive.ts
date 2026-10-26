import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, appendFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import type { Pool } from "pg";
import { migrate } from "../db/migrate.js";
import { createHash } from "node:crypto";
const magic = Buffer.from("PZBACK01");
const omitted = new Set([
  "backup_devices",
  "auth_sessions",
  "auth_rate_limits",
  "account_tokens",
  "email_outbox",
]);
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
function key(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      passphrase,
      salt,
      32,
      { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 },
      (err, value) => (err ? reject(err) : resolve(value)),
    ),
  );
}
export async function exportBackup(pool: Pool, passphrase: string) {
  const client = await pool.connect();
  // A checked-out pg client does not forward idle errors to the pool. Keep
  // a listener while encryption/file I/O runs, and abort rather than crash.
  const controller = new AbortController();
  let connectionError: Error | undefined;
  const onConnectionError = (error: Error) => {
    connectionError = error;
    controller.abort(error);
  };
  client.on("error", onConnectionError);
  const directory = await mkdtemp(join(tmpdir(), "pz-backup-"));
  const path = join(directory, "archive.pzb");
  let locked = false;
  try {
    locked = (
      await client.query("SELECT pg_try_advisory_lock(742019099) AS locked")
    ).rows[0].locked;
    if (!locked) throw new Error("A backup is already being prepared.");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='60s'");
    const tables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename as string);
    const migrations = (
      await client.query(
        "SELECT name,checksum FROM schema_migrations ORDER BY name",
      )
    ).rows;
    const sequences: {
      name: string;
      last_value: string;
      is_called: boolean;
    }[] = [];
    for (const { sequencename } of (
      await client.query(
        "SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
      )
    ).rows) {
      const value = (
        await client.query(
          `SELECT last_value::text,is_called FROM public.${quote(sequencename)}`,
        )
      ).rows[0];
      sequences.push({ name: sequencename, ...value });
    }
    const createdAt = new Date().toISOString();
    const salt = randomBytes(16),
      iv = randomBytes(12),
      header = Buffer.concat([magic, salt, iv]);
    const cipher = createCipheriv(
      "aes-256-gcm",
      await key(passphrase, salt),
      iv,
    );
    cipher.setAAD(header);
    let bytes = 0;
    async function* records() {
      yield JSON.stringify({
        format: "power-zone-database-v1",
        createdAt,
        tables,
        migrations,
        sequences,
        omitted: [...omitted],
      }) + "\n";
      for (const table of tables) {
        if (omitted.has(table)) continue;
        await client.query(
          `DECLARE backup_rows NO SCROLL CURSOR FOR SELECT * FROM public.${quote(table)}`,
        );
        while (true) {
          // Avoid constructing another huge JSON value inside PostgreSQL for
          // historical archives. Stream existing JSON fields unchanged instead.
          const batch = await client.query({text:"FETCH 1 FROM backup_rows",rowMode:'array',types:{
            // Keep SQL textual values verbatim: in particular microsecond
            // timestamps, big integers and numerics must not pass through Date
            // or Number. Restore casts them through the original column type.
            getTypeParser(){return (value:string)=>value;},
          }});
          if (!batch.rowCount) break;
          const chunks=[`{"table":${JSON.stringify(table)},"row":{`];
          for(const [index,field] of batch.fields.entries()){
            const value=batch.rows[0][index];
            const raw=value===null?'null':field.dataTypeID===114||field.dataTypeID===3802
              ? value : JSON.stringify(Buffer.isBuffer(value)?'\\x'+value.toString('hex'):value);
            chunks.push(`${index?',':''}${JSON.stringify(field.name)}:`,raw);
          }
          chunks.push('}}\n');
          for(const chunk of chunks){
            bytes += Buffer.byteLength(chunk);
            if(bytes>512*1024*1024)throw new Error("Backup exceeds the supported archive size.");
            yield chunk;
          }
        }
        await client.query("CLOSE backup_rows");
      }
    }
    const output = createWriteStream(path, { mode: 0o600 });
    output.write(header);
    await pipeline(Readable.from(records()), createGzip(), cipher, output, {
      signal: controller.signal,
    });
    await appendFile(path, cipher.getAuthTag());
    await client.query("COMMIT");
    return {
      path,
      createdAt,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock(742019099)")
        .catch(() => {});
    client.release(connectionError);
    client.removeListener("error", onConnectionError);
  }
}
export async function decodeBackup(path: string, passphrase: string) {
  const bytes = await readFile(path);
  if (bytes.length < 52 || !bytes.subarray(0, 8).equals(magic))
    throw new Error("Invalid backup format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await key(passphrase, bytes.subarray(8, 24)),
    bytes.subarray(24, 36),
  );
  decipher.setAAD(bytes.subarray(0, 36));
  decipher.setAuthTag(bytes.subarray(-16));
  const compressed = Buffer.concat([
    decipher.update(bytes.subarray(36, -16)),
    decipher.final(),
  ]);
  return gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 })
    .toString("utf8")
    .trimEnd()
    .split("\n");
}
// Operator-only recovery: deliberately no HTTP restore endpoint.
export async function restoreBackup(
  pool: Pool,
  path: string,
  passphrase: string,
  migrationDirectory = resolve("migrations"),
) {
  const lines = await decodeBackup(path, passphrase);
  const metadata = JSON.parse(lines[0]);
  if (metadata.format !== "power-zone-database-v1")
    throw new Error("Unsupported backup.");
  const files = (await readdir(migrationDirectory))
    .filter((f) => /^\d+_[a-z_]+\.sql$/.test(f))
    .sort();
  const expected = [];
  for (const name of files)
    expected.push({
      name,
      checksum: createHash("sha256")
        .update(await readFile(join(migrationDirectory, name)))
        .digest("hex"),
    });
  if (JSON.stringify(expected) !== JSON.stringify(metadata.migrations))
    throw new Error(
      "Restore requires the exact matching migration files from the backup release.",
    );
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(742019099)");
    const existing = await client.query(
      "SELECT 1 FROM pg_tables WHERE schemaname='public'",
    );
    if (existing.rowCount)
      throw new Error("Restore target must be a separate empty database.");
    await migrate(pool, migrationDirectory);
    await client.query("BEGIN");
    const tables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename as string);
    if (JSON.stringify(tables) !== JSON.stringify(metadata.tables))
      throw new Error("Backup schema does not match.");
    const fks = (
      await client.query(
        "SELECT conrelid::regclass::text AS relation,conname,condeferrable,condeferred FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace",
      )
    ).rows;
    for (const fk of fks)
      await client.query(
        `ALTER TABLE ${fk.relation} ALTER CONSTRAINT ${quote(fk.conname)} DEFERRABLE INITIALLY DEFERRED`,
      );
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(
      `TRUNCATE ${tables.map((t) => "public." + quote(t)).join(",")}`,
    );
    for (const line of lines.slice(1)) {
      // Keep the original JSON text for PostgreSQL numeric/bigint precision.
      const record = JSON.parse(line),
        table = record.table;
      if (!tables.includes(table) || omitted.has(table))
        throw new Error("Invalid table in backup.");
      const marker = line.indexOf(',"row":');
      if (marker < 0) throw new Error("Invalid backup record.");
      await client.query(
        `INSERT INTO public.${quote(table)} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::public.${quote(table)},$1::jsonb)`,
        [line.slice(marker + 7, -1)],
      );
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    for (const fk of fks)
      await client.query(
        `ALTER TABLE ${fk.relation} ALTER CONSTRAINT ${quote(fk.conname)} ${fk.condeferrable ? "DEFERRABLE" : "NOT DEFERRABLE"} ${fk.condeferred ? "INITIALLY DEFERRED" : "INITIALLY IMMEDIATE"}`,
      );
    const available = (
      await client.query(
        "SELECT sequencename FROM pg_sequences WHERE schemaname='public'",
      )
    ).rows.map((r) => r.sequencename);
    for (const sequence of metadata.sequences) {
      if (
        !available.includes(sequence.name) ||
        !/^\d+$/.test(sequence.last_value) ||
        typeof sequence.is_called !== "boolean"
      )
        throw new Error("Invalid backup sequence.");
      await client.query("SELECT setval($1::regclass,$2::bigint,$3)", [
        `public.${quote(sequence.name)}`,
        sequence.last_value,
        sequence.is_called,
      ]);
    }
    await client.query("COMMIT");
    return { createdAt: metadata.createdAt, tables: tables.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(742019099)").catch(() => {});
    client.release();
  }
}
export { createReadStream };
