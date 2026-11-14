import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {GatePassRepository} from '../server/inventory/gate-passes.js';
import {MaterialDraftRepository} from '../server/inventory/material-drafts.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {testDatabase} from './database.js';

test('historical Noorkot dispatches and the separate Cat 6 opening do not block Inventory', async () => {
  const db = await testDatabase();
  try {
    const {pool} = db;
    const fixture = await materialStockFixture(pool);
    const warehouse = 'Lahore warehouse';
    const siteId = 'registered-UBL:SOLAR:349';
    const draft = randomUUID(), dispatch = randomUUID();
    const snapshot = {
      historical: true, siteId, warehouse,
      sites: [{siteId, siteName: 'Noorkot', ipo: 'CHP-349', installation: true}],
      lines: [{itemId: 'CH-CBL-DC-6MM/1C-R/PK', out: '165', description: 'DC cable'}],
    };
    await pool.query('INSERT INTO inventory_material_drafts(id,created_by) VALUES($1,$2)', [draft,fixture.owner]);
    await pool.query(`INSERT INTO inventory_material_draft_versions
      (draft_id,version,snapshot,request_key,request_fingerprint,created_by) VALUES($1,1,$2,$3,$4,$5)`,
    [draft,snapshot,randomUUID(),fixture.stockSha,fixture.owner]);
    await pool.query(`INSERT INTO inventory_material_dispatches
      (id,number,draft_id,draft_version,source_sha256,warehouse,snapshot,request_key,request_fingerprint,created_by)
      VALUES($1,'CPZ-DO-816',$2,1,$3,$4,$5,$6,$3,$7)`,
    [dispatch,draft,fixture.stockSha,warehouse,snapshot,randomUUID(),fixture.owner]);
    await pool.query(`INSERT INTO inventory_warehouse_source_balances(source_sha256,ledger_key,payload)
      VALUES($1,'rehearsal-cat6',$2)`, [fixture.stockSha,{
      origin:'owner-confirmed historical issue', itemId:'CH-CBL-CAT6', description:'Cat 6', warehouse, unit:'m',
    }]);
    const catalogue = await new MaterialDraftRepository(pool).catalogue(fixture.owner);
    assert.ok(catalogue.catalogue.some(item => item.itemId === 'CH-CBL-CAT6'));
    const gate = await new GatePassRepository(pool).list(fixture.owner);
    assert.ok(gate.records.some(record => record.id === dispatch));
    const projected = (await pool.query('SELECT snapshot FROM inventory_material_dispatches_active WHERE id=$1',[dispatch])).rows[0].snapshot;
    assert.deepEqual(projected.lines[0].sites,[siteId]);
    const original = (await pool.query('SELECT snapshot FROM inventory_material_dispatches WHERE id=$1',[dispatch])).rows[0].snapshot;
    assert.deepEqual(original,snapshot);
  } finally {
    await db.close();
  }
});
