import { Decimal } from "decimal.js";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { sameUnit } from "../../shared/stock-units.js";
import { ipoReservationWarehouses } from "../../shared/procurement-warehouse.js";
import { plannedInventoryDelivery, plannedInventoryInstallation } from "../operations-board/batch-delivery.js";
import { SERVICE_LINE } from "./supply.js";

type Db = Pool | PoolClient;
type Demand = {
  ipo_id: string; number: string; site: string | null; customer: string | null;
  item_key: string; unit: string; quantity: string; expected_date: string | null;
  board_id: string | null; board: Record<string, unknown> | null;
};
type StockIdentity = { itemId: string; unit: string; purchaseKey: string | null };

export async function receivedIpoReservations(db: Db, stock: StockIdentity[]) {
  const demand = (await db.query<Demand>(`
    WITH latest_board AS (
      SELECT DISTINCT ON (site_id) site_id,snapshot FROM operations_board_versions ORDER BY site_id,version DESC
    )
    SELECT i.id ipo_id,i.number,i.snapshot->>'siteName' site,i.snapshot#>>'{customer,name}' customer,
      l.item_key,l.unit,sum(l.quantity)::text quantity,to_char(w.expected_delivery,'YYYY-MM-DD') expected_date,
      board.site_id board_id,board.snapshot board
    FROM operations_boq_issuances o JOIN internal_purchase_orders i ON i.id=o.ipo_id
    JOIN operations_stock_demand l ON l.issuance_id=o.id
    LEFT JOIN site_workflow w ON w.issuance_id=o.id
    LEFT JOIN LATERAL (
      SELECT matched.site_id,matched.snapshot FROM (
      SELECT b.site_id,b.snapshot,count(*) OVER () AS matches FROM latest_board b
      WHERE (b.snapshot->>'superseded') IS DISTINCT FROM 'true'
        AND ((b.snapshot#>>'{origin,ipoId}'=i.id::text AND b.snapshot#>>'{origin,operationsIssuanceId}'=o.id::text)
          OR EXISTS (SELECT 1 FROM inventory_material_source_links m WHERE m.ipo_id=i.id AND m.board_site_id=b.site_id))
      ) matched WHERE matched.matches=1
    ) board ON true
    WHERE w.delivered_on IS NULL AND coalesce(w.stage,'')<>'closed'
      AND coalesce(board.snapshot->>'cancelled','false')<>'true'
      AND coalesce(board.snapshot->>'stage','received') NOT IN ('delivered','completed')
      AND NOT EXISTS(SELECT 1 FROM archived_sample_ipos a WHERE a.ipo_id=i.id AND a.restored_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM test_workflow_archives a WHERE a.records->'localPreviewDocumentIds' ? i.id::text
        OR a.records->'localPreviewDocumentIds' ? o.id::text)
    GROUP BY i.id,l.item_key,l.unit,w.expected_delivery,board.site_id,board.snapshot
    ORDER BY i.number,l.item_key,l.unit`)).rows.filter(line =>
      !SERVICE_LINE.test(line.item_key) && line.unit.trim().toUpperCase() !== "LS",
    );

  const ipoIds = [...new Set(demand.map(line => line.ipo_id))];
  const posted = ipoIds.length ? (await db.query<{ ipo_id: string; item_id: string; unit: string; quantity: string }>(`
    SELECT d.snapshot#>>'{sites,0,siteId}' ipo_id,l.item_id,l.unit,sum(m.out_delta)::text quantity
    FROM inventory_warehouse_operational_movements m
    JOIN inventory_material_dispatches_active d ON d.id=m.dispatch_id
    JOIN inventory_material_dispatch_lines_active l ON l.dispatch_id=d.id AND l.line_key=m.line_key
    WHERE m.kind='dispatch-out' AND jsonb_array_length(d.snapshot->'sites')=1
      AND d.snapshot#>>'{sites,0,siteId}'=ANY($1::text[])
    GROUP BY 1,2,3`, [ipoIds])).rows : [];
  const remainingPosted = posted.map(out => ({ ...out, remaining: new Decimal(out.quantity) }));
  const warehouseSchema = z.enum(ipoReservationWarehouses);
  const dateSchema = z.iso.date();
  return demand.flatMap(line => {
    const matching = stock.filter(item =>
      (item.itemId === line.item_key || item.purchaseKey === line.item_key) && sameUnit(item.unit, line.unit),
    );
    const exact = matching.filter(item => item.itemId === line.item_key);
    const candidates = exact.length ? exact : matching;
    const itemIds = new Set(candidates.map(candidate => candidate.itemId));
    const itemId = itemIds.size === 1 ? candidates[0].itemId : null;
    let quantity = new Decimal(line.quantity);
    if (itemId) for (const out of remainingPosted) {
      if (out.ipo_id !== line.ipo_id || out.item_id !== itemId || !sameUnit(out.unit, line.unit)) continue;
      const used = Decimal.min(quantity, out.remaining);
      quantity = quantity.minus(used);
      out.remaining = out.remaining.minus(used);
    }
    if (quantity.lte(0)) return [];
    const board = { ...line.board, id: line.board_id };
    const assigned = warehouseSchema.safeParse(line.board?.procurementWarehouse);
    const plannedDate = dateSchema.safeParse(line.board?.dispatchDate);
    return [{
      ipoId: line.ipo_id, ipoNumber: line.number, customer: line.customer, site: line.site,
      warehouse: assigned.success ? assigned.data : null,
      itemId, itemKey: line.item_key, unit: line.unit,
      quantity: quantity.toString(),
      expectedUseDate: plannedInventoryDelivery(board) ?? plannedInventoryInstallation(board) ??
        (plannedDate.success ? plannedDate.data : line.expected_date),
    }];
  });
}
