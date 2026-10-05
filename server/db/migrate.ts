import type { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export async function migrate(pool: Pool, directory = resolve('migrations')) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(742019001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(directory)).filter(f => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
    const applied = await client.query<{name: string; checksum: string}>('SELECT name, checksum FROM schema_migrations');
    for (const previous of applied.rows) {
      if (!files.includes(previous.name)) throw new Error(`Applied migration is missing: ${previous.name}`);
    }
    for (const name of files) {
      const sql = await readFile(resolve(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.rows.find(r => r.name === name);
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration was changed: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(742019001)');
    client.release();
  }
}
