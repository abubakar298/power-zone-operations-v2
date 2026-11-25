// One-time catch-up (user request and go-ahead, 25 Nov 2026).
// What it fixes: shared UPS orders placed in a freed slot (cancelled site, migration 309) on 24-25 Nov were held back
// from the Operations board, because the board saw the cancelled site with the same "IPO · order" label as a possible
// duplicate. The matcher is fixed in live-ipo-sync.ts (boardCandidates); this places the orders that were already held.
// Records affected: issued shared UPS IPOs that were handed to Operations but have no Operations board site yet.
// It only adds board sites through the normal sync (OperationsLiveIpoSync); it changes or deletes nothing else.
//
// Run in Render -> web service -> Shell:
//   node dist/server/maintenance/place-freed-slot-board-sites.js                     dry run: lists what would be placed
//   node dist/server/maintenance/place-freed-slot-board-sites.js --apply --as "Name"  places them, as that Admin/Management user
import { readConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { OperationsLiveIpoSync } from "../operations-board/live-ipo-sync.js";
import { upsKeys } from "../project-workflow/order-slots.js";

const args = process.argv.slice(2), apply = args.includes("--apply"), asIndex = args.indexOf("--as");
const asName = asIndex >= 0 ? String(args[asIndex + 1] ?? "").trim() : "";
const pool = createPool(readConfig(process.env));
try {
  const missing = (await pool.query(`SELECT i.id,i.number,i.snapshot#>>'{input,orderNumber}' AS ord,i.snapshot->>'siteName' AS site,i.created_at
    FROM internal_purchase_orders i
    WHERE i.snapshot->'approvedCommercialSource'->>'key'=ANY($1::text[])
     AND EXISTS(SELECT 1 FROM operations_boq_issuances o WHERE o.ipo_id=i.id)
     AND NOT EXISTS(SELECT 1 FROM operations_board_versions v WHERE v.snapshot->'origin'->>'ipoId'=i.id::text)
     AND NOT EXISTS(SELECT 1 FROM inventory_material_source_links l WHERE l.ipo_id=i.id)
    ORDER BY i.created_at`, [upsKeys])).rows;
  console.log(`${missing.length} handed-over shared UPS order(s) without an Operations board site:`);
  missing.forEach((r, n) => console.log(`${n + 1}. ${r.number} · Order ${r.ord} · ${r.site} · issued ${r.created_at.toISOString().slice(0, 10)}`));
  if (!apply) { console.log("\nDry run: nothing changed. Add --apply --as \"<Admin or Management name>\" to place them."); }
  else if (missing.length) {
    const actor = (await pool.query("SELECT id,display_name FROM users WHERE active AND role IN('Admin','Management') AND display_name=$1", [asName])).rows;
    if (actor.length !== 1) throw new Error(`Expected one active Admin/Management user named "${asName}", found ${actor.length}.`);
    const result = await new OperationsLiveIpoSync(pool).sync(actor[0].id, { ipoIds: missing.map(r => String(r.id)) });
    console.log(`\nPlaced as ${actor[0].display_name}: ${result.created.length} created, ${result.retained.length} already there, ${result.held.length} still held.`);
    for (const h of result.held) console.log(`Held ${missing.find(r => String(r.id) === h.ipoId)?.number ?? h.ipoId}: ${h.reason}`);
  }
} finally { await pool.end(); }
