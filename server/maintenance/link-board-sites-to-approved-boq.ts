// One-time catch-up (user request and go-ahead, 26 Nov 2026).
// What it fixes: orders placed on the Operations board by the 25 Nov freed-slot catch-up
// (place-freed-slot-board-sites.ts) got a board site but no Inventory link to their approved IPO/BOQ, so Inventory
// shows "Approved BOQ link required" and hides Open materials. Reported for CHP-163 · 41/250 (OPF Housing Society)
// and several other sites (user, 26 Nov 2026).
// The sync now links the sites it places (live-ipo-sync.ts, linkPlacedSites); this links the ones already placed.
// Records affected: live IPO board sites (not cancelled or completed) with no Inventory material source link.
// It runs the normal sync for those IPOs, which keeps their board sites and adds the link through the same checks as a
// normal IPO handoff. No stock, DO, document or money record is written.
// It also lists every batch site Inventory currently shows as "Approved BOQ link required" (the same list as the
// screen), before and after, so sites with another cause are not missed. Those are reported only, never changed.
//
// Run in Render -> web service -> Shell. --as is an active Admin/Management user's name or email (email when two
// accounts share a name), needed to read the batch list:
//   node dist/server/maintenance/link-board-sites-to-approved-boq.js --as "Name"           dry run: lists, changes nothing
//   node dist/server/maintenance/link-board-sites-to-approved-boq.js --apply --as "Name"   links them
import { readConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { OperationsLiveIpoSync } from "../operations-board/live-ipo-sync.js";
import { MaterialDraftRepository } from "../inventory/material-drafts.js";

const args = process.argv.slice(2), apply = args.includes("--apply"), asIndex = args.indexOf("--as");
const asName = asIndex >= 0 ? String(args[asIndex + 1] ?? "").trim() : "";
const pool = createPool(readConfig(process.env));
try {
  const actor = (await pool.query("SELECT id,display_name FROM users WHERE active AND role IN('Admin','Management') AND (display_name=$1 OR lower(email)=lower($1))", [asName])).rows;
  if (actor.length !== 1) {
    const names = (await pool.query("SELECT display_name,email,role FROM users WHERE active AND role IN('Admin','Management') ORDER BY role,display_name")).rows;
    console.log(`Add --as "<name or email>" with one of these active Admin/Management users (copy it exactly; use the email if two share a name):`);
    names.forEach(r => console.log(`  ${r.display_name}   ${r.email}   (${r.role})`));
    throw new Error(`No single active Admin/Management user with name or email "${asName}" (found ${actor.length}). Nothing was changed.`);
  }
  const blocked = async () => (await new MaterialDraftRepository(pool).intake(actor[0].id)).operationsBatches
    .flatMap(batch => batch.stops.filter(stop => stop.status === "approved-boq-required").map(stop => ({ batch: batch.number, ...stop })));

  const missing = (await pool.query(`SELECT b.site_id, b.snapshot->>'ipo' AS label, b.snapshot->>'name' AS name, b.snapshot->>'stage' AS stage,
      b.snapshot->'origin'->>'ipoId' AS ipo_id
    FROM (SELECT DISTINCT ON (site_id) site_id, snapshot FROM operations_board_versions ORDER BY site_id, version DESC) b
    WHERE b.snapshot->'origin'->>'kind' = 'live-ipo-handoff'
      AND coalesce(b.snapshot->>'cancelled', 'false') <> 'true'
      AND coalesce(b.snapshot->>'completed', 'false') <> 'true'
      AND NOT EXISTS (SELECT 1 FROM inventory_material_source_links l WHERE l.board_site_id = b.site_id OR l.ipo_id::text = b.snapshot->'origin'->>'ipoId')
    ORDER BY b.snapshot->>'ipo'`)).rows;
  const before = await blocked();
  console.log(`Batch sites Inventory shows as "Approved BOQ link required": ${before.length}`);
  before.forEach((s, n) => console.log(`${n + 1}. ${s.batch} · ${s.ipo} · ${s.name}${missing.some(m => m.site_id === s.boardSiteId) ? "  -> this script links it" : "  -> other cause, review by hand"}`));
  console.log(`\nBoard sites placed from an IPO handoff but without an Inventory link (this script links these): ${missing.length}`);
  missing.forEach((r, n) => console.log(`${n + 1}. ${r.label} · ${r.name} · stage ${r.stage}`));

  if (!apply) { console.log("\nDry run: nothing changed. Add --apply to link them."); }
  else if (missing.length) {
    const result = await new OperationsLiveIpoSync(pool).sync(actor[0].id, { ipoIds: [...new Set(missing.map(r => String(r.ipo_id)))] });
    const label = (siteId: string) => { const r = missing.find(m => m.site_id === siteId); return r ? `${r.label} · ${r.name}` : siteId; };
    const count = (status: string) => result.inventoryLinks.filter(l => l.status === status).length;
    console.log(`\nAs ${actor[0].display_name}: ${count("linked")} linked, ${count("retained")} already linked, ${count("held")} not linked.`);
    for (const l of result.inventoryLinks.filter(l => l.status === "held")) console.log(`Not linked ${label(l.boardSiteId)}: ${l.reason}`);
    if (result.created.length) console.log(`Note: the sync also placed ${result.created.length} new board site(s).`);
    for (const h of result.held) console.log(`Board sync held ${h.ipoId}: ${h.reason}`);
    const after = await blocked();
    console.log(`\nStill "Approved BOQ link required" after linking: ${after.length}`);
    after.forEach((s, n) => console.log(`${n + 1}. ${s.batch} · ${s.ipo} · ${s.name}`));
  }
} finally { await pool.end(); }
