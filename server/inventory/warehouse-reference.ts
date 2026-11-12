import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;
const latestSource = `SELECT source_sha256 FROM inventory_warehouse_sources
  ORDER BY (coalesce(metadata->>'canonicalIds','') ~ '^[1-9][0-9]*$') DESC, created_at DESC, source_sha256 LIMIT 1`;

export async function reviewedWarehouseReference(db: Db) {
  return (await db.query<{ source_sha256: string }>(latestSource)).rows[0]?.source_sha256;
}

export async function reviewedWarehouses(db: Db) {
  const { rows } = await db.query<{ warehouse: string }>(`
    SELECT DISTINCT payload->>'warehouse' AS warehouse
    FROM inventory_warehouse_source_balances
    WHERE source_sha256=(${latestSource}) AND NULLIF(payload->>'warehouse','') IS NOT NULL
    ORDER BY warehouse`);
  return rows.map(row => row.warehouse);
}
