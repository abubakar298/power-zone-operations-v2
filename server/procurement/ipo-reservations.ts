import { Decimal } from "decimal.js";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { sameUnit } from "../../shared/stock-units.js";
import { ipoReservationWarehouses } from "../../shared/procurement-warehouse.js";
import { plannedInventoryDelivery, plannedInventoryInstallation } from "../operations-board/batch-delivery.js";
import { localPreviewDocumentIdCtes } from "../maintenance/archived-documents.js";
import { SERVICE_LINE } from "./supply.js";

type Db = Pool | PoolClient;
type Demand = {
  ipo_id: string; issuance_id: string; number: string; site: string | null; customer: string | null;
  item_key: string; unit: string; quantity: string; expected_date: string | null;
};
type Board = {
  site_id: string; ipo_id: string | null; issuance_id: string | null; linked_ipo_id: string | null;
  stage: string | null; cancelled: string | null; plan: Record<string, unknown>;
};
type StockIdentity = { itemId: string; unit: string; purchaseKey: string | null };

export async function receivedIpoReservations(db: Db, stock: StockIdentity[]) {
  const demand = (await db.query<Demand>(`
    WITH ${localPreviewDocumentIdCtes}
    SELECT i.id ipo_id,o.id issuance_id,i.number,i.snapshot->>'siteName' site,
      i.snapshot#>>'{customer,name}' customer,l.item_key,l.unit,l.quantity,
      to_char(w.expected_delivery,'YYYY-MM-DD') expected_date
    FROM operations_boq_issuances o
    JOIN internal_purchase_orders i ON i.id=o.ipo_id
    LEFT JOIN site_workflow w ON w.issuance_id=o.id
    JOIN (
      SELECT issuance_id,item_key,unit,sum(quantity)::text quantity FROM operations_stock_demand
      GROUP BY issuance_id,item_key,unit
    ) l ON l.issuance_id=o.id
    WHERE w.delivered_on IS NULL AND coalesce(w.stage,'')<>'closed'
      AND NOT EXISTS(SELECT 1 FROM archived_sample_ipos a WHERE a.ipo_id=o.ipo_id AND a.restored_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM archived_preview_ids a WHERE a.id=o.ipo_id::text)
      AND NOT EXISTS(SELECT 1 FROM archived_preview_ids a WHERE a.id=o.id::text)
    ORDER BY i.number,l.item_key,l.unit`)).rows.filter(line =>
      !SERVICE_LINE.test(line.item_key) && line.unit.trim().toUpperCase() !== "LS",
    );
  if (!demand.length) return [];

  const issuanceByIpo = new Map(demand.map(line => [line.ipo_id, line.issuance_id]));
  const ipoIds = [...issuanceByIpo.keys()];
  const boards = (await db.query<Board>(`
    WITH current_versions AS MATERIALIZED (
      SELECT DISTINCT ON (site_id) site_id,version FROM operations_board_versions ORDER BY site_id,version DESC
    )
    SELECT b.site_id,b.snapshot#>>'{origin,ipoId}' ipo_id,
      b.snapshot#>>'{origin,operationsIssuanceId}' issuance_id,m.ipo_id linked_ipo_id,
      b.snapshot->>'stage' stage,b.snapshot->>'cancelled' cancelled,
      jsonb_build_object('procurementWarehouse',b.snapshot->'procurementWarehouse',
        'installation',b.snapshot->'installation','installationPlanDate',b.snapshot->'installationPlanDate',
        'dispatchDate',b.snapshot->'dispatchDate','planningBatches',b.snapshot->'planningBatches') plan
    FROM current_versions v JOIN operations_board_versions b USING(site_id,version)
    LEFT JOIN inventory_material_source_links m ON m.board_site_id=b.site_id
    WHERE (b.snapshot->>'superseded') IS DISTINCT FROM 'true'
      AND (b.snapshot#>>'{origin,ipoId}'=ANY($1::text[]) OR m.ipo_id=ANY($2::uuid[]))`, [ipoIds, ipoIds])).rows;
  const boardByIssuance = new Map<string, Board | null>();
  for (const board of boards) {
    const linked = board.linked_ipo_id ? issuanceByIpo.get(board.linked_ipo_id) : undefined;
    const fromOrigin = board.ipo_id ? issuanceByIpo.get(board.ipo_id) : undefined;
    const matches = new Set([linked, fromOrigin === board.issuance_id ? fromOrigin : undefined]);
    for (const issuance of matches) {
      if (issuance) boardByIssuance.set(issuance, boardByIssuance.has(issuance) ? null : board);
    }
  }
  const activeDemand = demand.filter(line => {
    const board = boardByIssuance.get(line.issuance_id);
    return board?.cancelled !== "true" && board?.stage !== "delivered" && board?.stage !== "completed";
  });

  const activeIpos = [...new Set(activeDemand.map(line => line.ipo_id))];
  const posted = activeIpos.length ? (await db.query<{ ipo_id: string; item_id: string; unit: string; quantity: string; shared: boolean }>(`
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
    GROUP BY 1,2,3,5`, [activeIpos])).rows : [];
  const remainingPosted = posted.filter(out => !out.shared).map(out => ({ ...out, remaining: new Decimal(out.quantity) }));
  const warehouseSchema = z.enum(ipoReservationWarehouses);
  const dateSchema = z.iso.date();
  return activeDemand.flatMap(line => {
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
    const matchedBoard = boardByIssuance.get(line.issuance_id);
    const board = { ...matchedBoard?.plan, id: matchedBoard?.site_id };
    const assigned = warehouseSchema.safeParse(matchedBoard?.plan.procurementWarehouse);
    const plannedDate = dateSchema.safeParse(matchedBoard?.plan.dispatchDate);
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
