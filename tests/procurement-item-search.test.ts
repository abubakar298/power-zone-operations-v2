import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { ProcurementRepository } from "../server/procurement/repository.js";

// Moaz (buyer) could not find Pakistan cables: the item search read only the price list, whose names
// carry no brand and no stock ID. It now also matches the Item ID Database and returns the linked price-list item.
test("Buyer item search also finds items by their Item ID Database ID or description", async () => {
  const db = await testDatabase();
  try {
    const buyer = randomUUID(), store = randomUUID();
    await db.pool.query("INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,'Buyer','x','Operations'),($3,$4,'Store','x','Inventory')",
      [buyer, `${buyer}@example.test`, store, `${store}@example.test`]);
    await db.pool.query("INSERT INTO procurement_access(user_id,capability,granted_reason) VALUES($1,'buyer','test')", [buyer]);
    await db.pool.query("INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by) VALUES($1,'Lahore warehouse','dispatcher',$2)", [store, buyer]);
    const repo = new ProcurementRepository(db.pool);
    const cable = "25mm² 4C AC Cable";
    const keys = async (who: string, q: string) => (await repo.searchItems(who, q)).map((i) => i.itemKey);

    // Already worked: the price-list name.
    assert.ok((await keys(buyer, "25mm")).includes(cable));
    // New: the brand in the Item ID Database description, and the stock ID itself.
    assert.ok((await keys(buyer, "pakistan")).includes(cable), "brand name finds the cable");
    assert.ok((await keys(buyer, "CH-CBL-AC-25MM/4C-PK")).includes(cable), "stock ID finds the cable");
    assert.ok((await keys(store, "pakistan")).includes(cable), "Store's search finds it too");
    // Each item appears once, and the buyer rule (no inverters, batteries or BMS) still applies.
    const hits = await keys(buyer, "pakistan");
    assert.equal(new Set(hits).size, hits.length);
    assert.ok((await repo.searchItems(buyer, "battery")).every((i) => !/bat|bms|inverter/i.test(i.itemKey + i.name)));
  } finally {
    await db.close();
  }
});
