import type { Pool, PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { warehousePositions } from "../inventory/warehouse-ledger.js";
import { reviewedWarehouseReference, reviewedWarehouses } from "../inventory/warehouse-reference.js";
import { boughtByBuyer, PROCUREMENT_ITEMS } from "./supply.js";
import { receivedIpoReservations } from "./ipo-reservations.js";
import { sameUnit } from "../../shared/stock-units.js";

type Db = Pool | PoolClient;

export async function procurementWarehouseStock(db: Db, includeReservations = true) {
  const warehouses = await reviewedWarehouses(db);
  const reference = await reviewedWarehouseReference(db);
  const authorityRows = await db.query<{ warehouse: string; source_sha256: string }>(
      "SELECT warehouse,source_sha256 FROM inventory_warehouse_authority_current",
  );
  const catalogueRows = await db.query<{ item_id: string; category: string | null; item_key: string | null; name: string | null; unit: string | null }>(`
      WITH purchase_items AS MATERIALIZED (SELECT key,display_name,unit FROM ${PROCUREMENT_ITEMS} items)
      SELECT c.item_id,f.category,
        coalesce(direct.key,linked.key) item_key,
        CASE WHEN direct.key IS NULL THEN linked.display_name ELSE direct.display_name END name,
        CASE WHEN direct.key IS NULL THEN linked.unit ELSE direct.unit END unit
      FROM inventory_catalogue_final_current c
      JOIN inventory_final_stock_ids f ON f.item_id=c.item_id
      LEFT JOIN purchase_items direct ON direct.key=c.item_id
      LEFT JOIN purchase_items linked ON direct.key IS NULL AND linked.key=c.rate_key
      WHERE c.payload->>'finalStockId'='true'`);
  const minimumRows = await db.query<{ warehouse: string; item_id: string; unit: string; minimum: string }>(`
      SELECT DISTINCT ON (warehouse,item_id,unit) warehouse,item_id,unit,minimum::text
      FROM inventory_minimum_stock_versions ORDER BY warehouse,item_id,unit,version DESC`);
  const authority = new Map(authorityRows.rows.map(row => [row.warehouse, row.source_sha256]));
  const catalogue = new Map(catalogueRows.rows.map(row => [row.item_id, row]));
  const countsByPurchaseItem = new Map<string, number>();
  for (const { item_key } of catalogueRows.rows) {
    if (item_key) countsByPurchaseItem.set(item_key, (countsByPurchaseItem.get(item_key) ?? 0) + 1);
  }
  const minimums = new Map(minimumRows.rows.map(row => [JSON.stringify([row.warehouse, row.item_id, row.unit]), row.minimum]));
  const sources = new Map(warehouses.map(warehouse => [warehouse, authority.get(warehouse) ?? reference]));
  const positions = [];
  for (const source of new Set(sources.values())) {
    if (source) positions.push(...await warehousePositions(db, source));
  }
  const rows = positions.flatMap(position => {
    const { warehouse, itemId, unit, description } = position.baseline;
    if (!sources.has(warehouse) || sources.get(warehouse) !== position.sourceSha256) return [];
    const item = catalogue.get(itemId);
    const purchaseItem = item?.item_key && countsByPurchaseItem.get(item.item_key) === 1 && item.unit && sameUnit(unit, item.unit) && boughtByBuyer(item.item_key, item.name ?? "")
      ? { itemKey: item.item_key, unit: item.unit }
      : null;
    return [{
      warehouse, itemId, unit, description,
      category: item?.category ?? null,
      onHand: position.currentClosing,
      minimum: minimums.get(JSON.stringify([warehouse, itemId, unit])) ?? null,
      referenceOnly: !authority.has(warehouse),
      purchaseItem,
    }];
  });
  const identities = new Map<string, { itemId: string; unit: string; purchaseKey: string | null }>();
  for (const row of rows) {
    identities.set(JSON.stringify([row.itemId, row.unit]), {
      itemId: row.itemId, unit: row.unit, purchaseKey: catalogue.get(row.itemId)?.item_key ?? null,
    });
  }
  const reservations = includeReservations ? await receivedIpoReservations(db, [...identities.values()]) : [];
  const purchases = includeReservations ? (await db.query<{
    reference: string; request_number: string; warehouse: string; item_key: string; unit: string;
    expected: string | null; supplier: string | null; quantity: string;
  }>(`
    WITH receipts AS (
      SELECT request_id,item_key,sum(quantity) quantity FROM stock_on_hand_entries
      WHERE kind='receipt' AND request_id IS NOT NULL GROUP BY request_id,item_key
    )
    SELECT r.order_reference reference,r.number request_number,r.delivery_to warehouse,
      l.item_key,l.unit,to_char(r.expected_on,'YYYY-MM-DD') expected,q.vendor supplier,
      (l.quantity-coalesce(g.quantity,0))::text quantity
    FROM purchase_requests r JOIN purchase_request_lines l ON l.request_id=r.id
    LEFT JOIN purchase_quotes q ON q.id=l.chosen_quote_id
    LEFT JOIN receipts g ON g.request_id=l.request_id AND g.item_key=l.item_key
    WHERE r.status='ordered' AND l.quantity>coalesce(g.quantity,0)
    ORDER BY r.expected_on NULLS LAST,r.number,l.item_key`)).rows : [];
  const stockLink = (warehouse: string, itemId: string, unit: string) => {
    const matches = rows.filter(row => row.warehouse === warehouse && row.itemId === itemId && sameUnit(row.unit, unit));
    const exact = matches.filter(row => row.unit === unit);
    const candidates = exact.length ? exact : matches;
    return candidates.length === 1 ? candidates[0] : null;
  };
  const byStock = new Map<typeof rows[number], typeof reservations>();
  const unlinkedReservations: typeof reservations = [];
  for (const reservation of reservations) {
    const row = reservation.warehouse && reservation.itemId && stockLink(reservation.warehouse, reservation.itemId, reservation.unit);
    if (row) byStock.set(row, [...(byStock.get(row) ?? []), reservation]);
    else if (reservation.warehouse) unlinkedReservations.push(reservation);
  }
  const incomingByStock = new Map<typeof rows[number], typeof purchases>();
  const unlinkedIncoming: typeof purchases = [];
  for (const purchase of purchases) {
    const row = rows.find(row => purchase.warehouse === row.warehouse &&
      purchase.item_key === row.purchaseItem?.itemKey && sameUnit(purchase.unit, row.unit) &&
      stockLink(row.warehouse, row.itemId, purchase.unit) === row);
    if (row) incomingByStock.set(row, [...(incomingByStock.get(row) ?? []), purchase]);
    else unlinkedIncoming.push(purchase);
  }
  return {
    warehouses,
    reservations,
    unlinkedReservations,
    unlinkedIncoming,
    rows: rows.map(row => {
      const reserved = (byStock.get(row) ?? []).reduce((total, reservation) => total.plus(reservation.quantity), new Decimal(0));
      return { ...row, reserved: reserved.toString(), incoming: incomingByStock.get(row) ?? [], reservationDetails: byStock.get(row) ?? [],
        afterReservations: row.onHand == null ? null : new Decimal(row.onHand).minus(reserved).toString() };
    }),
  };
}
