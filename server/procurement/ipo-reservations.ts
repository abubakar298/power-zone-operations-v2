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
    WITH pending_issuances AS MATERIALIZED (
      SELECT o.id,o.ipo_id,w.expected_delivery
      FROM operations_boq_issuances o
      LEFT JOIN site_workflow w ON w.issuance_id=o.id
      WHERE w.delivered_on IS NULL AND coalesce(w.stage,'')<>'closed'
        AND NOT EXISTS(SELECT 1 FROM archived_sample_ipos a WHERE a.ipo_id=o.ipo_id AND a.restored_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM test_workflow_archives a WHERE a.records->'localPreviewDocumentIds' ? o.ipo_id::text
          OR a.records->'localPreviewDocumentIds' ? o.id::text)
    ), latest_board AS MATERIALIZED (
      SELECT DISTINCT ON (site_id) site_id,snapshot FROM operations_board_versions ORDER BY site_id,version DESC
    ), current_board AS MATERIALIZED (
      SELECT site_id,snapshot,snapshot#>>'{origin,ipoId}' ipo_id,
        snapshot#>>'{origin,operationsIssuanceId}' issuance_id
      FROM latest_board WHERE (snapshot->>'superseded') IS DISTINCT FROM 'true'
    ), board_links AS (
      SELECT o.id,b.site_id
      FROM pending_issuances o JOIN current_board b ON b.ipo_id=o.ipo_id::text AND b.issuance_id=o.id::text
      UNION
      SELECT o.id,b.site_id
      FROM pending_issuances o JOIN inventory_material_source_links m ON m.ipo_id=o.ipo_id
      JOIN current_board b ON b.site_id=m.board_site_id
    ), exact_board AS (
      SELECT id,min(site_id) site_id FROM board_links GROUP BY id HAVING count(*)=1
    ), item_demand AS (
      SELECT l.issuance_id,l.item_key,l.unit,sum(l.quantity)::text quantity
      FROM operations_stock_demand l JOIN pending_issuances o ON o.id=l.issuance_id
      GROUP BY l.issuance_id,l.item_key,l.unit
    )
    SELECT i.id ipo_id,i.number,i.snapshot->>'siteName' site,i.snapshot#>>'{customer,name}' customer,
      l.item_key,l.unit,l.quantity,to_char(o.expected_delivery,'YYYY-MM-DD') expected_date,
      board.site_id board_id,board.snapshot board
    FROM pending_issuances o JOIN internal_purchase_orders i ON i.id=o.ipo_id
    JOIN item_demand l ON l.issuance_id=o.id
    LEFT JOIN exact_board link ON link.id=o.id
    LEFT JOIN current_board board ON board.site_id=link.site_id
    WHERE coalesce(board.snapshot->>'cancelled','false')<>'true'
      AND coalesce(board.snapshot->>'stage','received') NOT IN ('delivered','completed')
    ORDER BY i.number,l.item_key,l.unit`)).rows.filter(line =>
      !SERVICE_LINE.test(line.item_key) && line.unit.trim().toUpperCase() !== "LS",
    );

  const ipoIds = [...new Set(demand.map(line => line.ipo_id))];
  const posted = ipoIds.length ? (await db.query<{ ipo_id: string; item_id: string; unit: string; quantity: string; shared: boolean }>(`
    SELECT site.ipo_id,l.item_id,l.unit,sum(m.out_delta)::text quantity,
      cardinality(allocated.site_ids)>1 AS shared
    FROM inventory_warehouse_operational_movements m
    JOIN inventory_material_dispatches_active d ON d.id=m.dispatch_id
    JOIN inventory_material_dispatch_lines_active l ON l.dispatch_id=d.id AND l.line_key=m.line_key
    LEFT JOIN LATERAL (
      SELECT line->'sites' sites FROM jsonb_array_elements(d.snapshot->'lines') line
      WHERE line->>'key'=l.line_key::text
    ) detail ON true
    CROSS JOIN LATERAL (
      SELECT array_agg(DISTINCT s->>'siteId') site_ids FROM jsonb_array_elements(d.snapshot->'sites') s
      WHERE s->>'siteId' IS NOT NULL AND
        (coalesce(jsonb_array_length(detail.sites),0)=0 OR detail.sites ? (s->>'siteId'))
    ) allocated
    CROSS JOIN LATERAL unnest(allocated.site_ids) site(ipo_id)
    WHERE m.kind='dispatch-out' AND site.ipo_id=ANY($1::text[])
    GROUP BY 1,2,3,5`, [ipoIds])).rows : [];
  const remainingPosted = posted.filter(out => !out.shared).map(out => ({ ...out, remaining: new Decimal(out.quantity) }));
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
      sharedDispatchPending: posted.some(out => out.shared && out.ipo_id === line.ipo_id && out.item_id === itemId && sameUnit(out.unit, line.unit)),
      expectedUseDate: plannedInventoryDelivery(board) ?? plannedInventoryInstallation(board) ??
        (plannedDate.success ? plannedDate.data : line.expected_date),
    }];
  });
}
