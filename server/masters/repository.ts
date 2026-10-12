import { importCustomers, customerImportSchema } from "./customer-import.js";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/transaction.js";
import { HttpError } from "../http/errors.js";
import { canWriteMaster } from "./permissions.js";

export class MastersRepository {
  constructor(
    private pool: Pool | PoolClient,
    private serial = false,
  ) {}
  async customerImport(
    actor: string,
    input: unknown,
    expected?: string,
    confirmedBackup?: boolean,
  ) {
    const parsed = customerImportSchema.safeParse(input);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Check the six customer fields; phone numbers must be text.",
      );
    return importCustomers(
      this.pool as Pool,
      actor,
      parsed.data,
      expected,
      confirmedBackup,
    );
  }
  async list() {
    const queries = [
      "SELECT * FROM customers ORDER BY id",
      "SELECT s.*,c.name AS customer_name FROM sites s JOIN customers c ON c.id=s.customer_id ORDER BY s.id",
      "SELECT * FROM brands ORDER BY id",
      "SELECT DISTINCT ON(r.key) r.*,i.unit,i.item_group FROM rate_versions r JOIN item_master i ON i.key=r.key ORDER BY r.key,r.version DESC",
      "SELECT DISTINCT ON(key) * FROM rule_versions ORDER BY key,version DESC",
      `SELECT DISTINCT ON(i.key) i.key,i.unit,i.display_name,i.item_group,s.specification AS approved_specification,
    s.status,s.notes,s.version FROM item_master i JOIN item_spec_versions s ON s.key=i.key ORDER BY i.key,s.version DESC`,
      "SELECT * FROM inverter_configurations ORDER BY total_kw,configuration",
      "SELECT * FROM costing_classifications",
      "SELECT * FROM master_imports",
      "SELECT * FROM inventory_catalogue_current ORDER BY item_id",
      "SELECT * FROM engineering_profiles_current ORDER BY key",
      "SELECT * FROM inventory_item_aliases ORDER BY alias",
    ];
    const results = [];
    if (this.serial) {
      for (const sql of queries) results.push(await this.pool.query(sql));
    } else
      results.push(
        ...(await Promise.all(queries.map((sql) => this.pool.query(sql)))),
      );
    const [
      customers,
      sites,
      brands,
      rates,
      rules,
      items,
      inverters,
      classifications,
      imports, catalogue, engineeringProfiles, itemAliases,
    ] = results;
    return {
      customers: customers.rows,
      sites: sites.rows,
      brands: brands.rows,
      rates: rates.rows.map(r=>({...r,pt_item_ids:catalogue.rows.filter(i=>i.rate_key===r.key).map(i=>i.item_id).join(" · ")})),
      rules: rules.rows,
      items: items.rows,
      inverters: inverters.rows,
      classifications: classifications.rows,
      imports: imports.rows,
      catalogue: catalogue.rows,
      engineeringProfiles: engineeringProfiles.rows,
      itemAliases: itemAliases.rows,
    };
  }
  private async resolveRateKey(key: string, pool: Pool | PoolClient = this.pool) {
    const row = (await pool.query(`SELECT rate_key FROM inventory_catalogue_current WHERE item_id=$1 UNION ALL SELECT c.rate_key FROM inventory_item_aliases a JOIN inventory_catalogue_current c ON c.item_id=a.item_id WHERE a.alias=$1 LIMIT 1`, [key])).rows[0];
    return row?.rate_key || key;
  }
  async save(
    actor: string,
    kind: "customers" | "sites" | "brands" | "rates" | "rules" | "items",
    id: string,
    version: number,
    values: Record<string, unknown>,
  ) {
    try {
      return await transaction(this.pool as Pool, async (c) => {
        // Serializes writes, allocates stable customer IDs and avoids version races across processes.
        await c.query("SELECT pg_advisory_xact_lock(742019002)");
        if (kind === "rates") id = await this.resolveRateKey(id, c);
        const user = (
          await c.query("SELECT active,role FROM users WHERE id=$1 FOR SHARE", [
            actor,
          ])
        ).rows[0];
        if (!user?.active || !canWriteMaster(user.role, kind, id))
          throw new HttpError(
            403,
            "You do not have permission to change this master record.",
          );
        let nextId = id;
        if (kind === "rates" || kind === "rules" || kind === "items") {
          const table =
            kind === "rates"
              ? "rate_versions"
              : kind === "rules"
                ? "rule_versions"
                : "item_spec_versions";
          const old = (
            await c.query(
              `SELECT * FROM ${table} WHERE key=$1 ORDER BY version DESC LIMIT 1`,
              [id],
            )
          ).rows[0];
          if (!old) throw new HttpError(404, "Master record not found.");
          if (old.version !== version)
            throw new HttpError(
              409,
              "This record changed. Refresh and review the latest version.",
            );
          if (kind === "rates")
            await c.query(
              "INSERT INTO rate_versions(key,version,rate,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6)",
              [
                id,
                version + 1,
                values.rate,
                values.status,
                values.notes,
                actor,
              ],
            );
          else if (kind === "rules")
            await c.query(
              "INSERT INTO rule_versions(key,version,rule_group,setting,value,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                id,
                version + 1,
                old.rule_group,
                old.setting,
                values.value,
                values.notes,
                actor,
              ],
            );
          else
            await c.query(
              "INSERT INTO item_spec_versions(key,version,specification,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6)",
              [
                id,
                version + 1,
                values.approved_specification || null,
                values.status,
                values.notes,
                actor,
              ],
            );
        } else if (kind === "customers" && id === "new") {
          nextId = String(
            (
              await c.query(
                "SELECT COALESCE(max(id),-1)+1 AS id FROM customers",
              )
            ).rows[0].id,
          );
          await c.query(
            "INSERT INTO customers(id,name,short_code,contact_person,phone,email,address,status,notes,city,province) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [
              nextId,
              values.name,
              values.short_code,
              values.contact_person,
              values.phone,
              values.email,
              values.address,
              values.status,
              values.notes,
              values.city ?? "",
              values.province ?? "",
            ],
          );
        } else {
          const columns =
            kind === "customers"
              ? [
                  ...(values.city !== undefined ? ["city"] : []),
                  ...(values.province !== undefined ? ["province"] : []),
                  "name",
                  "short_code",
                  "contact_person",
                  "phone",
                  "email",
                  "address",
                  "status",
                  "notes",
                ]
              : kind === "sites"
                ? ["name", "code", "location", "status"]
                : ["status", "notes"];
          const result = await c.query(
            `UPDATE ${kind} SET ${columns.map((col, i) => `${col}=$${i + 1}`).join(",")},version=version+1 WHERE id=$${columns.length + 1} AND version=$${columns.length + 2} RETURNING id`,
            [...columns.map((col) => values[col]), id, version],
          );
          if (!result.rowCount)
            throw new HttpError(
              409,
              "This record changed or no longer exists. Refresh and review the latest version.",
            );
        }
        await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [
          actor,
          `master.${kind}.${nextId}.${id === "new" ? "created" : "updated"}`,
        ]);
        return { id: nextId };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "23505"
      )
        throw new HttpError(
          409,
          "That customer short code already exists. Use a unique code.",
        );
      throw error;
    }
  }
  async history(kind: "rates" | "rules" | "items", key: string) {
    if (kind === "rates") key = await this.resolveRateKey(key);
    const table =
      kind === "rates"
        ? "rate_versions"
        : kind === "rules"
          ? "rule_versions"
          : "item_spec_versions";
    return (
      await this.pool.query(
        `SELECT * FROM ${table} WHERE key=$1 ORDER BY version DESC`,
        [key],
      )
    ).rows;
  }
}

