import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MaterialDraftRepository } from '../server/inventory/material-drafts.js';
import { MaterialStockRepository } from '../server/inventory/material-stock.js';
import { postTemporaryInward, previewTemporaryInward } from '../server/inventory/temporary-inward-posting.js';
import { stockLedger } from '../server/inventory/stock-ledger.js';
import { warehousePosition } from '../server/inventory/warehouse-ledger.js';
import { warehouseLedgerKey } from '../server/inventory/warehouse-source.js';
import { testDatabase } from './database.js';

test('a saved inward credits verified new stock once and keeps the item available to Inventory', async () => {
  const db = await testDatabase();
  try {
    const { pool } = db;
    const owner = randomUUID(), dispatcher = randomUUID(), outsider = randomUUID();
    for (const [id, role] of [[owner, 'Management'], [dispatcher, 'Inventory'], [outsider, 'Accounts']])
      await pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',
        [id, id + '@inward.example.test', role, role, 'test']);
    const warehouse = 'Karachi warehouse', source = 'a'.repeat(64);
    await pool.query(`INSERT INTO inventory_material_access(user_id,warehouse,capability,granted_by)
      VALUES($1,$2,'dispatcher',$3)`, [dispatcher, warehouse, owner]);
    await pool.query(`INSERT INTO inventory_warehouse_sources(source_sha256,catalogue_sha256,metadata,content_fingerprint,created_by)
      VALUES($1,$1,'{"canonicalIds":1}',$1,$2)`, [source, owner]);
    await pool.query('INSERT INTO inventory_warehouse_source_balances(source_sha256,ledger_key,payload) VALUES($1,$2,$3)',
      [source, warehouseLedgerKey('EXISTING', warehouse, 'No.'), {
        itemId: 'EXISTING', warehouse, unit: 'No.', description: 'Reviewed item',
        opening: '10', calculatedClosing: '10', eventIn: '0', eventOut: '0',
      }]);
    await pool.query(`INSERT INTO inventory_warehouse_authority_versions
      (warehouse,version,source_sha256,state,reason,request_key,request_fingerprint,created_by)
      VALUES($1,1,$2,'active','Test reviewed source',$3,$2,$4)`, [warehouse, source, randomUUID(), owner]);
    const itemId = 'J635-TEST';
    await pool.query('INSERT INTO inventory_catalogue_versions(item_id,version,payload,rate_key) VALUES($1,1,$2,NULL)',
      [itemId, { itemId, unit: 'No.', technicalDescription: '635 W test panel' }]);
    const repo = new MaterialDraftRepository(pool);
    const input = {
      requestKey: randomUUID(), id: '', version: 0, type: 'IGP', date: '2025-11-04',
      warehouse, party: 'Test supplier', sourceReference: 'TEST-PO-128',
      actualReference: '', notes: '', detailsConfirmed: false,
      lines: [{ itemId, description: '', quantity: '144', unit: 'pcs', remarks: '' }],
    };
    const saved = await repo.saveTemporaryDocument(owner, input);
    await assert.rejects(previewTemporaryInward(pool, outsider, saved.id), /assigned Inventory dispatcher/);
    const preview = await previewTemporaryInward(pool, owner, saved.id);
    assert.ok('lines' in preview && preview.lines);
    const command = {
      version: preview.version, source, authorityVersion: 1,
      revisions: Object.fromEntries(preview.lines.map(line => [line.key, line.revision])),
      confirmZeroOpening: true,
    };
    await assert.rejects(postTemporaryInward(pool, dispatcher, saved.id, command), /Management must confirm/);
    await assert.rejects(postTemporaryInward(pool, owner, saved.id, { ...command, confirmZeroOpening: false }), /Confirm there was zero/);
    await assert.rejects(postTemporaryInward(pool, owner, saved.id, { ...command, version: 2 }), /inward changed/);

    const posted = await postTemporaryInward(pool, owner, saved.id, command);
    assert.deepEqual(await postTemporaryInward(pool, owner, saved.id, command), posted);
    const duplicate = await repo.saveTemporaryDocument(owner, { ...input, requestKey: randomUUID(), sourceReference: 'test-po-128' });
    await assert.rejects(postTemporaryInward(pool, owner, duplicate.id, command), /already posted/);
    await assert.rejects(repo.saveTemporaryDocument(owner, { ...input, id: saved.id, version: 1, requestKey: randomUUID() }), /details are locked/);

    const key = warehouseLedgerKey(itemId, warehouse, 'No.');
    const position = await warehousePosition(pool, source, key);
    assert.equal(position?.currentClosing, '144');
    assert.equal(position?.operationalIn, '144');
    assert.equal(position?.ledgerRevision, 1);
    assert.ok((await repo.catalogue(dispatcher)).catalogue.some(item => item.itemId === itemId));
    const stock = await new MaterialStockRepository(pool).positions(dispatcher, warehouse);
    assert.equal(stock.positions.find(item => item.itemId === itemId)?.currentClosing, '144');
    const ledger = await stockLedger(pool, dispatcher, { warehouse, itemId });
    assert.equal(ledger.total, 1);
    assert.equal(ledger.events[0].reference, saved.number);
    assert.equal(ledger.events[0].date, input.date);
  } finally {
    await db.close();
  }
});
