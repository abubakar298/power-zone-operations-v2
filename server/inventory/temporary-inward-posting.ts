import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { sameUnit } from '../../shared/stock-units.js';
import { lockActiveActor } from '../auth/actor-lock.js';
import { transaction } from '../db/transaction.js';
import { HttpError } from '../http/errors.js';
import { lockWarehouseAuthority, requireWarehouseAccess } from './warehouse-access.js';
import { nextWarehouseClosing, warehousePosition } from './warehouse-ledger.js';
import { warehouseLedgerKey } from './warehouse-source.js';

type Db = Pool | PoolClient;
type SavedLine = { itemId: string; description: string; quantity: string; unit: string; remarks: string };
type SavedInward = {
  id: string; version: number; type: string; number: string; date: string;
  warehouse: string; party: string; sourceReference: string; actualReference: string;
  detailsConfirmed: boolean; lines: SavedLine[];
};

const postInput = z.object({
  version: z.number().int().positive(),
  source: z.string().regex(/^[a-f0-9]{64}$/),
  authorityVersion: z.number().int().positive(),
  revisions: z.record(z.string(), z.number().int().nonnegative().nullable()),
  confirmZeroOpening: z.boolean(),
}).strict();

async function readInward(db: Db, actor: string, id: string, lock = false) {
  const row = (await db.query('SELECT snapshot FROM inventory_temporary_documents WHERE id=$1' +
    (lock ? ' FOR UPDATE' : ''), [id])).rows[0];
  if (!row) throw new HttpError(404, 'Saved inward not found.');
  const doc = row.snapshot as SavedInward;
  await requireWarehouseAccess(actor, doc.warehouse, db);
  if (doc.type !== 'IGP') throw new HttpError(422, 'Only a saved purchase inward can be posted here.');
  const prior = (await db.query('SELECT snapshot FROM inventory_temporary_inward_postings WHERE document_id=$1', [id])).rows[0];
  return { doc, posted: prior?.snapshot };
}

async function activeAuthority(db: Db, warehouse: string) {
  const row = (await db.query(
    'SELECT source_sha256,version,state FROM inventory_warehouse_authority_current WHERE warehouse=$1', [warehouse],
  )).rows[0];
  if (row?.state !== 'active') throw new HttpError(409, 'Verify and activate this warehouse stock register before posting.');
  return { source: row.source_sha256 as string, authorityVersion: row.version as number };
}

function inwardReference(doc: SavedInward) {
  if (doc.detailsConfirmed) throw new HttpError(409, 'This inward already has confirmed final details. Check its final receipt.');
  const reference = doc.actualReference.trim() || doc.sourceReference.trim();
  if (!reference || !doc.party.trim()) throw new HttpError(422, 'Save the supplier and receiving or PO reference before posting.');
  return reference;
}

async function prepare(db: Db, doc: SavedInward, source: string, lock = false) {
  const date = (await db.query("SELECT (now() AT TIME ZONE 'Asia/Karachi')::date::text AS today")).rows[0].today;
  const receivedOn = new Date(doc.date + 'T00:00:00Z');
  if (!Number.isFinite(receivedOn.getTime()) || receivedOn.toISOString().slice(0, 10) !== doc.date)
    throw new HttpError(422, 'Save a valid receipt date before posting.');
  if (doc.date > date) throw new HttpError(422, 'The receipt date cannot be in the future.');
  const lines = doc.lines.filter(line => Object.values(line).some(value => value.trim()));
  if (!lines.length) throw new HttpError(422, 'Save at least one received item before posting.');
  const seen = new Set<string>();
  const prepared = [];
  // A fixed item order keeps multi-line posting locks consistent across receipts.
  for (const line of lines.sort((a, b) => a.itemId.trim().localeCompare(b.itemId.trim()))) {
    const itemId = line.itemId.trim();
    if (!itemId || !line.unit.trim() || !/^\d{1,14}(?:\.\d{1,6})?$/.test(line.quantity) ||
        !new Decimal(line.quantity).gt(0)) throw new HttpError(422, 'Each received line needs an item ID, unit and positive quantity.');
    if (seen.has(itemId)) throw new HttpError(422, 'Combine repeated quantities for each item into one inward line.');
    seen.add(itemId);
    if (sameUnit(line.unit, 'No.') && !new Decimal(line.quantity).isInteger())
      throw new HttpError(422, 'Enter a whole quantity for items received by the piece.');
    const master = (await db.query('SELECT payload FROM inventory_catalogue_final_current WHERE item_id=$1', [itemId])).rows[0]?.payload;
    if (!master) throw new HttpError(422, `Select the registered item ID for ${itemId}.`);
    const balances = (await db.query(`SELECT ledger_key,payload FROM inventory_warehouse_source_balances
      WHERE source_sha256=$1 AND payload->>'warehouse'=$2 AND lower(btrim(payload->>'itemId'))=lower($3)`,
      [source, doc.warehouse, itemId])).rows;
    const matching = balances.filter(row => row.payload.itemId === itemId && sameUnit(row.payload.unit, line.unit));
    if (matching.length > 1 || (balances.length && !matching.length))
      throw new HttpError(409, `Review the stock unit and item ID for ${itemId} before posting.`);
    const masterUnits: string[] = master.stockUnits?.length ? master.stockUnits : [master.unit].filter(Boolean);
    const unit = matching[0]?.payload.unit as string | undefined
      ?? masterUnits.find(candidate => sameUnit(candidate, line.unit));
    if (!unit) throw new HttpError(422, `Use the unit recorded for ${itemId} in the item database.`);
    const key = warehouseLedgerKey(itemId, doc.warehouse, unit);
    const position = await warehousePosition(db, source, key, lock);
    if (position && (position.currentClosing === null || position.baseline.reviewPending))
      throw new HttpError(409, `Verify the existing warehouse balance for ${itemId} before posting.`);
    if (!position && (await db.query(`SELECT 1 FROM inventory_warehouse_source_events
        WHERE source_sha256=$1 AND payload->>'warehouse'=$2
        AND lower(btrim(payload->>'itemId'))=lower($3) LIMIT 1`, [source, doc.warehouse, itemId])).rowCount)
      throw new HttpError(409, `Review the historical stock movements for ${itemId} before creating a balance.`);
    const quantity = new Decimal(line.quantity).toString();
    const before = position?.currentClosing ?? '0';
    prepared.push({
      itemId, unit, quantity, key, before, after: nextWarehouseClosing(before, quantity, 1)!,
      description: position?.baseline.description ?? master.stockDescription ?? master.technicalDescription ?? line.description,
      revision: position?.ledgerRevision ?? null,
    });
  }
  return prepared;
}

export async function previewTemporaryInward(db: Pool, actor: string, id: string) {
  const { doc, posted } = await readInward(db, actor, id);
  if (posted) return { posted };
  const reference = inwardReference(doc);
  const authority = await activeAuthority(db, doc.warehouse);
  const lines = await prepare(db, doc, authority.source);
  return { ...authority, version: doc.version, reference, lines };
}

export async function postTemporaryInward(pool: Pool, actor: string, id: string, value: unknown) {
  const parsed = postInput.safeParse(value);
  if (!parsed.success) throw new HttpError(422, 'Review the current warehouse balance before posting.');
  const input = parsed.data;
  return transaction(pool, async db => {
    await lockActiveActor(db, actor);
    const { doc, posted } = await readInward(db, actor, id, true);
    if (posted) return posted;
    if (doc.version !== input.version) throw new HttpError(409, 'This inward changed. Reopen the stock preview.');
    const reference = inwardReference(doc);
    await lockWarehouseAuthority(db, doc.warehouse, input.source, input.authorityVersion);
    const duplicate = await db.query(`SELECT 1 FROM inventory_temporary_inward_postings
       WHERE warehouse=$1 AND lower(btrim(external_reference))=lower($2)
      UNION ALL SELECT 1 FROM inventory_material_purchase_receipts p JOIN purchase_requests r ON r.id=p.request_id
       WHERE p.warehouse=$1 AND (lower(btrim(r.number))=lower($2) OR lower(btrim(p.number))=lower($2)) LIMIT 1`,
    [doc.warehouse, reference]);
    if (duplicate.rowCount) throw new HttpError(409, 'This receiving reference is already posted for this warehouse.');
    const lines = await prepare(db, doc, input.source, true);
    if (lines.some(line => input.revisions[line.key] !== line.revision))
      throw new HttpError(409, 'The warehouse balance changed. Reopen the stock preview.');
    if (lines.some(line => line.revision === null)) {
      const { role } = (await db.query('SELECT role FROM users WHERE id=$1', [actor])).rows[0];
      if (!['Admin', 'Management'].includes(role))
        throw new HttpError(403, 'Management must confirm the opening quantity for an item without a warehouse balance.');
      if (!input.confirmZeroOpening)
        throw new HttpError(422, 'Confirm there was zero stock before this receipt for each item without a balance.');
    }
    const result = {
      number: doc.number, warehouse: doc.warehouse, receivedOn: doc.date, reference,
      lines: lines.map(({ itemId, quantity, unit, before, after }) => ({ itemId, quantity, unit, before, after })),
    };
    await db.query(`INSERT INTO inventory_temporary_inward_postings
      (document_id,document_version,warehouse,external_reference,snapshot,posted_by) VALUES($1,$2,$3,$4,$5,$6)`,
    [id, doc.version, doc.warehouse, reference, result, actor]);
    for (const line of lines) {
      if (line.revision === null) {
        const baseline = {
          key: line.key, warehouse: doc.warehouse, itemId: line.itemId, unit: line.unit, description: line.description,
          opening: '0', closing: '0', calculatedClosing: '0', in: '0', out: '0', eventIn: '0', eventOut: '0',
          openingStatus: 'Management confirmed zero before receipt', review: doc.number,
          origin: 'temporary-inward-opening', recordedBy: actor, receivedOn: doc.date,
        };
        await db.query('INSERT INTO inventory_warehouse_source_balances(source_sha256,ledger_key,payload) VALUES($1,$2,$3)',
          [input.source, line.key, baseline]);
      }
      await db.query(`INSERT INTO inventory_warehouse_operational_movements
        (id,source_sha256,ledger_key,ledger_revision,kind,temporary_inward_id,in_delta,out_delta,closing_before,closing_after,created_by)
        VALUES($1,$2,$3,$4,'temporary-inward',$5,$6,0,$7,$8,$9)`,
      [randomUUID(), input.source, line.key, (line.revision ?? 0) + 1, id, line.quantity, line.before, line.after, actor]);
    }
    await db.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)', [actor, `inventory.temporary-inward.posted:${id}`]);
    return result;
  });
}
