// Standing access change (owner rule, 27 Nov 2026): returned material enters stock only after the
// Inventory head approves the counted, signed Return IGP. Owner confirmation, 27 Nov 2026: Shaiggan
// is the Inventory head.
// What it does: gives one Inventory user the 'head' grant for every warehouse where they are
// already the dispatcher (migration 316). Without a head grant, counted returns wait and nobody can
// approve them. No stock, DO or document record is written; the grant is listed in audit_log.
//
// Run in Render -> web service -> Shell. --as is an active Admin/Management user's email, --user the
// Inventory head's email:
//   node dist/server/maintenance/grant-inventory-head.js --as "<admin email>" --user "<email>"           dry run
//   node dist/server/maintenance/grant-inventory-head.js --as "<admin email>" --user "<email>" --apply   grants it
import { readConfig } from "../config.js";
import { createPool } from "../db/pool.js";

const args = process.argv.slice(2), apply = args.includes("--apply");
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? String(args[i + 1] ?? "").trim() : ""; };
const pool = createPool(readConfig(process.env));
try {
  const actor = (await pool.query("SELECT id FROM users WHERE active AND role IN('Admin','Management') AND lower(email)=lower($1)", [value("--as")])).rows[0];
  const head = (await pool.query("SELECT id,display_name FROM users WHERE active AND role='Inventory' AND lower(email)=lower($1)", [value("--user")])).rows[0];
  const people = (await pool.query(`SELECT u.display_name,u.email,string_agg(a.warehouse||' ('||a.capability||')',', ' ORDER BY a.warehouse,a.capability) grants
    FROM users u LEFT JOIN inventory_material_access a ON a.user_id=u.id WHERE u.active AND u.role='Inventory' GROUP BY u.id ORDER BY u.display_name`)).rows;
  console.log("Active Inventory users and their warehouse grants:");
  for (const p of people) console.log(`  ${p.display_name} <${p.email}>: ${p.grants ?? "none"}`);
  if (!actor || !head) {
    console.log('\nAdd --as "<active Admin/Management email>" and --user "<Inventory head email>" (copy the email exactly).');
    process.exitCode = 1;
  } else {
    const warehouses = (await pool.query("SELECT warehouse FROM inventory_material_access WHERE user_id=$1 AND capability='dispatcher' AND warehouse NOT IN(SELECT warehouse FROM inventory_material_access WHERE user_id=$1 AND capability='head') ORDER BY warehouse", [head.id])).rows.map(r => r.warehouse as string);
    console.log(`\n${head.display_name}: head grant ${apply ? "added" : "would be added"} for ${warehouses.length ? warehouses.join(", ") : "no new warehouse (already head, or not a dispatcher anywhere)"}.`);
    if (apply && warehouses.length) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const warehouse of warehouses) await client.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,$2,'head',$3)", [head.id, warehouse, actor.id]);
        await client.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor.id, `inventory.head.granted:${head.id}:${warehouses.join("|")}`]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }
    if (!apply) console.log("Dry run: nothing changed. Add --apply to grant it.");
  }
} finally {
  await pool.end();
}
