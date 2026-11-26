// One-time catch-up (user request and go-ahead, 26 Nov 2026).
// What it fixes: orders placed on the Operations board by the 25 Nov freed-slot catch-up
// (place-freed-slot-board-sites.ts) got a board site but no Inventory link to their approved IPO/BOQ, so Inventory
// shows "Approved BOQ link required" and hides Open materials (reported for CHP-163 · 41/250, OPF Housing Society).
// The sync now links the sites it places (live-ipo-sync.ts, linkPlacedSites); this links the ones already placed.
// Records affected: live IPO board sites (not cancelled or completed) with no Inventory material source link.
// It runs the normal sync for those IPOs, which keeps their board sites and adds the link through the same checks as a
// normal IPO handoff. No stock, DO, document or money record is written.
//
// Run in Render -> web service -> Shell:
//   node dist/server/maintenance/link-board-sites-to-approved-boq.js                     dry run: lists what would be linked
//   node dist/server/maintenance/link-board-sites-to-approved-boq.js --apply --as "Name"  links them, as that Admin/Management user
import { readConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { OperationsLiveIpoSync } from "../operations-board/live-ipo-sync.js";

const args = process.argv.slice(2), apply = args.includes("--apply"), asIndex = args.indexOf("--as");
const asName = asIndex >= 0 ? String(args[asIndex + 1] ?? "").trim() : "";
const pool = createPool(readConfig(process.env));
try {
  const missing = (await pool.query(`SELECT b.site_id, b.snapshot->>'ipo' AS label, b.snapshot->>'name' AS name, b.snapshot->>'stage' AS stage,
      b.snapshot->'origin'->>'ipoId' AS ipo_id
    FROM (SELECT DISTINCT ON (site_id) site_id, snapshot FROM operations_board_versions ORDER BY site_id, version DESC) b
    WHERE b.snapshot->'origin'->>'kind' = 'live-ipo-handoff'
      AND coalesce(b.snapshot->>'cancelled', 'false') <> 'true'
      AND coalesce(b.snapshot->>'completed', 'false') <> 'true'
      AND NOT EXISTS (SELECT 1 FROM inventory_material_source_links l WHERE l.board_site_id = b.site_id OR l.ipo_id::text = b.snapshot->'origin'->>'ipoId')
    ORDER BY b.snapshot->>'ipo'`)).rows;
  console.log(`${missing.length} Operations board site(s) without an Inventory link to their approved BOQ:`);
  missing.forEach((r, n) => console.log(`${n + 1}. ${r.label} · ${r.name} · stage ${r.stage}`));
  if (!apply) { console.log("\nDry run: nothing changed. Add --apply --as \"<Admin or Management name>\" to link them."); }
  else if (missing.length) {
    const actor = (await pool.query("SELECT id,display_name FROM users WHERE active AND role IN('Admin','Management') AND display_name=$1", [asName])).rows;
    if (actor.length !== 1) throw new Error(`Expected one active Admin/Management user named "${asName}", found ${actor.length}.`);
    const result = await new OperationsLiveIpoSync(pool).sync(actor[0].id, { ipoIds: [...new Set(missing.map(r => String(r.ipo_id)))] });
    const label = (siteId: string) => { const r = missing.find(m => m.site_id === siteId); return r ? `${r.label} · ${r.name}` : siteId; };
    const count = (status: string) => result.inventoryLinks.filter(l => l.status === status).length;
    console.log(`\nAs ${actor[0].display_name}: ${count("linked")} linked, ${count("retained")} already linked, ${count("held")} not linked.`);
    for (const l of result.inventoryLinks.filter(l => l.status === "held")) console.log(`Not linked ${label(l.boardSiteId)}: ${l.reason}`);
    if (result.created.length) console.log(`Note: the sync also placed ${result.created.length} new board site(s).`);
    for (const h of result.held) console.log(`Board sync held ${h.ipoId}: ${h.reason}`);
  }
} finally { await pool.end(); }
