import {lockActiveActor} from '../auth/actor-lock.js';
import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { STATUS_LABELS, type RequestStatus } from "./schema.js";
import { boughtByBuyer, computeSupply, fixed, isMiscItem, lastRates, num, PROCUREMENT_ITEMS, rateMaster, sameUnit, toDay } from "./supply.js";

type Db = Pool | PoolClient;
const READ_ROLES = new Set(["Admin", "Management", "Inventory"]);
const NEW_NUMBER = "'PR-' || to_char(now(),'YY') || '-' || lpad(nextval('purchase_request_number')::text,3,'0')";
const NOT_FOR_BUYER = "Batteries, BMS and inverters are not bought through Procurement.";

export interface Me { role: string; displayName: string; buyer: boolean; approver: boolean; operationsBoard?:boolean }
/** Who sees purchase prices (Moaz, 24 Oct 2026): the buyer, the approver, Admin, Management and Accounts. Never Store. */
const PRICE_ROLES = new Set(["Admin", "Management", "Accounts"]);
export const seesPrices = (me: Me) => me.buyer || me.approver || PRICE_ROLES.has(me.role);

export class ProcurementRepository {
  constructor(private pool: Pool) {}

  // ----- access -----
  async me(actor: string, c: Db = this.pool): Promise<Me> {
    const u = (await c.query("SELECT role, display_name FROM users WHERE id=$1 AND active", [actor])).rows[0];
    if (!u) throw new HttpError(403, "Your account is not active.");
    const caps = new Set((await c.query("SELECT capability FROM procurement_access WHERE user_id=$1", [actor])).rows.map((r) => r.capability as string));
    const operationsBoard=u.role==='Operations'&&(await c.query('SELECT 1 FROM operations_board_access WHERE user_id=$1',[actor])).rowCount!==0;
    return { role: u.role, displayName: u.display_name, buyer: caps.has("buyer"), approver: caps.has("approver"),operationsBoard };
  }
  private async inventoryDispatcher(actor:string,c:Db=this.pool){
    if(!(await c.query("SELECT 1 FROM inventory_material_access WHERE user_id=$1 AND capability='dispatcher' LIMIT 1",[actor])).rowCount)
      throw new HttpError(403,"Inventory dispatcher access is required. Storekeepers can print approved documents and upload signed copies.");
  }
  private async legacyStockWrite(c:Db){
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.warehouse.governance',0))");
    if((await c.query('SELECT 1 FROM inventory_warehouse_authority_current LIMIT 1')).rowCount)
      throw new HttpError(409,'Select the warehouse and final stock ID. Global counts and receipts cannot change reconciled warehouse stock.');
  }
  private async reader(actor: string, c: Db = this.pool) {
    const me = await this.me(actor, c);
    if(me.role==="Inventory")await this.inventoryDispatcher(actor,c);
    if (!me.buyer && !me.approver && !READ_ROLES.has(me.role)) throw new HttpError(403, "Procurement is not part of your workspace.");
    return me;
  }
  /** Purchase prices and totals: see seesPrices. Store (Shaigan) and everyone else are refused. */
  private async priceReader(actor: string, c: Db = this.pool) {
    const me = await this.me(actor, c);
    if (!seesPrices(me)) throw new HttpError(403, me.role === "Inventory" ? "Purchase prices are not part of the Store workspace." : "Purchase prices are not part of your workspace.");
    return me;
  }
  private async buyer(actor: string, c: Db) {
    const me = await this.me(actor, c);
    if (!me.buyer) throw new HttpError(403, "Only the Procurement buyer can do this.");
    return me;
  }
  private async approver(actor: string, c: Db) {
    const me = await this.me(actor, c);
    if (!me.approver) throw new HttpError(403, "Only Abu Bakar can approve purchase requests.");
    return me;
  }
  private async event(c: PoolClient, id: string, actor: string, kind: string, from: string | null, to: string | null, note = "", changes: unknown = {}) {
    await c.query(
      "INSERT INTO purchase_request_events(request_id,kind,from_status,to_status,note,changes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, kind, from, to, note, JSON.stringify(changes), actor],
    );
    await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `procurement.${kind}:${id}`]);
  }
  /** What Store has received so far against each request line, keyed "requestId|itemKey". */
  private async receivedByLine(c: Db, ids: string[]) {
    return new Map((await c.query(
      "SELECT request_id, item_key, sum(quantity) AS qty FROM stock_on_hand_entries WHERE kind='receipt' AND request_id = ANY($1) GROUP BY 1,2",
      [ids],
    )).rows.map((r) => [`${r.request_id}|${r.item_key}`, num(r.qty)]));
  }

  // ----- what is coming, what is in stock -----
  async overview(actor: string) {
    const me = await this.reader(actor);
    const prices = seesPrices(me);
    const { watchNeeds: _sites, ...supply } = await computeSupply(this.pool, this.pool);
    return { me, ...supply, requests: prices ? await this.requestRows(this.pool, this.seesDirect(me)) : [] };
  }

  /**
   * Store's page (Shaigan, 21 Oct 2026): every item to count with its current level, and the ordered
   * purchases waiting to be received, with quantities and vendors but no prices.
   */
  async storeView(actor: string) {
    const me = await this.me(actor);
    if (me.role !== "Inventory" && !["Admin", "Management"].includes(me.role)) throw new HttpError(403, "This page belongs to Store.");
    if(me.role==="Inventory")await this.inventoryDispatcher(actor);
    const { inventory } = await computeSupply(this.pool, this.pool);
    const ordered = (await this.pool.query(
      `SELECT r.id, r.number, r.title, r.order_reference, r.ordered_at, r.delivery_to, r.needed_by, r.vendor, r.expected_on, u.display_name AS ordered_by
       FROM purchase_requests r LEFT JOIN users u ON u.id=r.ordered_by WHERE r.status='ordered' ORDER BY r.ordered_at`,
    )).rows;
    const lines = ordered.length ? (await this.pool.query(
      `SELECT l.request_id, l.item_key, l.quantity, l.unit, q.vendor FROM purchase_request_lines l LEFT JOIN purchase_quotes q ON q.id=l.chosen_quote_id
       WHERE l.request_id = ANY($1) ORDER BY l.item_key`,
      [ordered.map((o) => o.id)],
    )).rows : [];
    const names = await rateMaster(this.pool, [...new Set(lines.map((l) => l.item_key as string))]);
    const got = await this.receivedByLine(this.pool, ordered.map((o) => o.id as string));
    return {
      items: inventory.map((i) => ({ itemKey: i.itemKey, name: i.name, unit: i.unit, inRateMaster: i.inRateMaster, misc: i.misc, inStock: i.inStock, counted: i.counted, lastCountAt: i.lastCountAt, stockUnit: i.stockUnit }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      toReceive: ordered.map((o) => ({
        id: o.id as string, number: o.number as string, title: o.title as string, orderReference: o.order_reference as string, orderedAt: o.ordered_at as string,
        orderedBy: (o.ordered_by ?? null) as string | null, deliveryTo: o.delivery_to as string, neededBy: o.needed_by ? toDay(o.needed_by) : null,
        expectedOn: o.expected_on ? toDay(o.expected_on) : null,
        lines: lines.filter((l) => l.request_id === o.id).map((l) => {
          const received = got.get(`${o.id}|${l.item_key}`) ?? 0;
          return {
            itemKey: l.item_key as string, name: names.get(l.item_key)?.name ?? l.item_key, quantity: fixed(num(l.quantity)),
            received: fixed(received), due: fixed(Math.max(0, num(l.quantity) - received)), unit: l.unit as string, vendor: (l.vendor || o.vendor || "") as string,
          };
        }),
      })),
    };
  }

  async searchItems(actor: string, q: string) {
    const me = await this.reader(actor);
    const text = `%${q.trim().toLowerCase()}%`;
    return (await this.pool.query(
      `SELECT m.key, m.display_name, m.unit,
        (SELECT rate FROM rate_versions v WHERE v.key=m.key AND v.status='Active' ORDER BY version DESC LIMIT 1) AS rate
       FROM ${PROCUREMENT_ITEMS} m WHERE lower(m.key) LIKE $1 OR lower(m.display_name) LIKE $1 ORDER BY m.display_name LIMIT 40`,
      [text],
    )).rows
      .map((r) => ({ itemKey: r.key as string, name: (r.display_name || r.key) as string, unit: r.unit as string, misc: isMiscItem(r.key), ...(seesPrices(me) ? { rate: r.rate == null ? null : fixed(num(r.rate)) } : {}) }))
      .filter((i) => !me.buyer || boughtByBuyer(i.itemKey, i.name))
      .slice(0, 25);
  }

  async setCount(actor: string, input: { itemKey: string; quantity: string; unit: string; note: string }) {
    return transaction(this.pool, async (c) => {
      await lockActiveActor(c,actor);
      const me = await this.me(actor, c);
      // Store keeps the counts; the Procurement buyer reads them but cannot change them (Moaz, 21 Oct 2026).
      if (me.role !== "Inventory") throw new HttpError(403, "Only Store can enter stock counts.");
      await this.inventoryDispatcher(actor,c);await this.legacyStockWrite(c);
      const item = (await c.query(`SELECT unit FROM ${PROCUREMENT_ITEMS} i WHERE key=$1`, [input.itemKey])).rows[0];
      if (!item) throw new HttpError(400, "That item is not in the rate master or the misc items list.");
      await c.query(
        "INSERT INTO stock_on_hand_entries(item_key,kind,quantity,unit,note,created_by) VALUES($1,'count',$2,$3,$4,$5)",
        [input.itemKey, input.quantity, input.unit || item.unit, input.note, actor],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `procurement.count:${input.itemKey}`]);
    });
  }

  // ----- purchase requests -----
  /** Abu Bakar's own inverter, battery and BMS orders stay out of the buyer's list (Moaz, 24 Oct 2026). */
  private seesDirect(me: Me) { return me.approver || PRICE_ROLES.has(me.role); }
  private async requestRows(c: Db, direct = true) {
    return (await c.query(
      `SELECT r.*, u.display_name AS created_by_name,
        (SELECT count(*) FROM purchase_request_lines l WHERE l.request_id=r.id)::int AS line_count,
        (SELECT COALESCE(sum(l.quantity*q.rate),0) FROM purchase_request_lines l JOIN purchase_quotes q ON q.id=l.chosen_quote_id WHERE l.request_id=r.id) AS total,
        (SELECT string_agg(DISTINCT q.vendor, ', ') FROM purchase_request_lines l JOIN purchase_quotes q ON q.id=l.chosen_quote_id WHERE l.request_id=r.id) AS vendors
       FROM purchase_requests r JOIN users u ON u.id=r.created_by WHERE $1 OR r.kind<>'direct' ORDER BY r.updated_at DESC LIMIT 500`,
      [direct],
    )).rows.map((r) => ({
      id: r.id as string, number: r.number as string, title: r.title as string, status: r.status as RequestStatus, statusLabel: STATUS_LABELS[r.status as RequestStatus],
      lines: r.line_count as number, total: fixed(num(r.total)), selfApproved: r.self_approved === true, vendors: (r.vendors ?? "") as string, createdBy: r.created_by_name as string,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string, submittedAt: r.submitted_at as string | null, decidedAt: r.decided_at as string | null,
      orderedAt: r.ordered_at as string | null, receivedAt: r.received_at as string | null, neededBy: r.needed_by ? toDay(r.needed_by) : null,
    }));
  }
  async listRequests(actor: string) {
    const me = await this.priceReader(actor);
    return this.requestRows(this.pool, this.seesDirect(me));
  }

  async getRequest(actor: string, id: string, c: Db = this.pool) {
    const me = await this.priceReader(actor, c);
    const r = (await c.query(
      `SELECT r.*, cu.display_name AS created_by_name, du.display_name AS decided_by_name, ou.display_name AS ordered_by_name, ru.display_name AS received_by_name
       FROM purchase_requests r JOIN users cu ON cu.id=r.created_by LEFT JOIN users du ON du.id=r.decided_by
       LEFT JOIN users ou ON ou.id=r.ordered_by LEFT JOIN users ru ON ru.id=r.received_by WHERE r.id=$1`,
      [id],
    )).rows[0];
    if (!r) throw new HttpError(404, "Purchase request not found.");
    const lineRows = (await c.query("SELECT * FROM purchase_request_lines WHERE request_id=$1 ORDER BY created_at, item_key", [id])).rows;
    const quotes = (await c.query(
      "SELECT q.* FROM purchase_quotes q JOIN purchase_request_lines l ON l.id=q.line_id WHERE l.request_id=$1 ORDER BY q.rate, q.created_at",
      [id],
    )).rows;
    const keys = lineRows.map((l) => l.item_key as string);
    const master = await rateMaster(c, keys);
    const live = r.status === "draft" ? await lastRates(c, keys) : null;
    const got = await this.receivedByLine(c, [id]);
    let atChosen = 0, lastComparable = 0, chosenComparable = 0, firstPurchases = 0;
    const lines = lineRows.map((l) => {
      const qs = quotes.filter((q) => q.line_id === l.id).map((q) => ({ id: q.id as string, vendor: q.vendor as string, rate: fixed(num(q.rate)), note: q.note as string, createdAt: q.created_at as string }));
      const chosen = qs.find((q) => q.id === l.chosen_quote_id) ?? null;
      const best = qs[0] ?? null;
      const last = live ? live(l.item_key) : l.last_rate == null ? null : { rate: num(l.last_rate), unit: l.last_rate_unit as string, source: l.last_rate_source as string };
      const comparable = Boolean(last && sameUnit(last.unit, l.unit));
      const qty = num(l.quantity), total = chosen ? qty * Number(chosen.rate) : 0;
      atChosen += total;
      if (chosen && comparable && last) { lastComparable += qty * last.rate; chosenComparable += total; }
      if (!last || !comparable) firstPurchases++;
      return {
        id: l.id as string, itemKey: l.item_key as string, name: master.get(l.item_key)?.name ?? l.item_key, masterUnit: master.get(l.item_key)?.unit ?? null,
        quantity: fixed(qty), received: fixed(got.get(`${id}|${l.item_key}`) ?? 0), unit: l.unit as string, note: l.note as string, quotes: qs, chosenQuoteId: (l.chosen_quote_id ?? null) as string | null,
        chosen, best, lastRate: last ? { rate: fixed(last.rate), unit: last.unit, source: last.source, comparable } : null,
        difference: chosen && comparable && last ? fixed(Number(chosen.rate) - last.rate) : null, lineTotal: fixed(total),
      };
    });
    const events = (await c.query(
      "SELECT e.*, u.display_name AS actor FROM purchase_request_events e JOIN users u ON u.id=e.created_by WHERE e.request_id=$1 ORDER BY e.created_at DESC",
      [id],
    )).rows.map((e) => ({ id: e.id as string, kind: e.kind as string, fromStatus: e.from_status as string | null, toStatus: e.to_status as string | null, note: e.note as string, actor: e.actor as string, at: e.created_at as string }));
    const status = r.status as RequestStatus;
    return {
      id: r.id as string, number: r.number as string, title: r.title as string, purpose: r.purpose as string, neededBy: r.needed_by ? toDay(r.needed_by) : null,
      deliveryTo: r.delivery_to as string, paymentTerms: r.payment_terms as string, status, statusLabel: STATUS_LABELS[status],
      createdBy: r.created_by_name as string, createdAt: r.created_at as string, submittedAt: r.submitted_at as string | null,
      decidedBy: (r.decided_by_name ?? null) as string | null, decidedAt: r.decided_at as string | null, decisionNote: r.decision_note as string,
      orderedBy: (r.ordered_by_name ?? null) as string | null, orderedAt: r.ordered_at as string | null, orderReference: r.order_reference as string,
      receivedBy: (r.received_by_name ?? null) as string | null, receivedAt: r.received_at as string | null, selfApproved: r.self_approved === true,
      lines, events,
      totals: { atChosen: fixed(atChosen), lastComparable: fixed(lastComparable), chosenComparable: fixed(chosenComparable), saving: fixed(lastComparable - chosenComparable), firstPurchases },
      can: {
        edit: me.buyer && status === "draft",
        submit: me.buyer && status === "draft",
        decide: me.approver && status === "pending_approval",
        selfApprove: me.buyer && (status === "pending_approval" || (status === "draft" && lines.length > 0 && lines.every((l) => l.chosen))),
        order: me.buyer && status === "approved",
        receive: me.role === "Inventory" && status === "ordered",
        cancel: me.buyer && ["draft", "pending_approval", "approved"].includes(status),
      },
    };
  }

  private async lock(c: PoolClient, id: string) {
    const r = (await c.query("SELECT id, status FROM purchase_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!r) throw new HttpError(404, "Purchase request not found.");
    return r.status as RequestStatus;
  }
  private async draft(c: PoolClient, actor: string, id: string) {
    await this.buyer(actor, c);
    const status = await this.lock(c, id);
    if (status !== "draft") throw new HttpError(422, "Only a draft request can be changed. Ask Abu Bakar to send it back if it needs changes.");
  }
  private async touch(c: PoolClient, id: string) { await c.query("UPDATE purchase_requests SET updated_at=now() WHERE id=$1", [id]); }
  /** The lowest quotation becomes the chosen one unless the buyer has picked another (24 Oct 2026: also when a lower one arrives later). */
  private async chooseLowestIfNone(c: PoolClient, lineId: string) {
    await c.query(
      `UPDATE purchase_request_lines l SET chosen_quote_id=(SELECT id FROM purchase_quotes q WHERE q.line_id=l.id ORDER BY q.rate, q.created_at LIMIT 1)
       WHERE l.id=$1 AND NOT (l.chosen_by_buyer AND l.chosen_quote_id IS NOT NULL)`,
      [lineId],
    );
  }

  async createRequest(actor: string, input: { title: string; purpose: string; neededBy: string | null; deliveryTo: string; paymentTerms: string }) {
    return transaction(this.pool, async (c) => {
      await this.buyer(actor, c);
      const id = (await c.query(
        `INSERT INTO purchase_requests(number,title,purpose,needed_by,delivery_to,payment_terms,created_by) VALUES(${NEW_NUMBER},$1,$2,$3,$4,$5,$6) RETURNING id`,
        [input.title, input.purpose, input.neededBy, input.deliveryTo || "Power Zone Store", input.paymentTerms, actor],
      )).rows[0].id as string;
      await this.event(c, id, actor, "created", null, "draft");
      return this.getRequest(actor, id, c);
    });
  }

  /** A draft with every item the inventory status says to buy, at the quantities it says. */
  async createFromToBuy(actor: string) {
    return transaction(this.pool, async (c) => {
      await this.buyer(actor, c);
      const { inventory } = await computeSupply(this.pool, c);
      const lines = inventory.filter((i) => i.inRateMaster && i.boughtByBuyer && Number(i.toBuy) > 0);
      if (!lines.length) throw new HttpError(422, "Nothing to buy: stock and orders already cover every coming site.");
      const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date());
      const id = (await c.query(
        `INSERT INTO purchase_requests(number,title,purpose,created_by) VALUES(${NEW_NUMBER},$1,$2,$3) RETURNING id`,
        [`Restock ${day}`, "Items to buy for received and upcoming POs, from the inventory status.", actor],
      )).rows[0].id as string;
      for (const l of lines) {
        const note = [Number(l.receivedNeed) > 0 ? `${l.receivedNeed} for received POs` : "", Number(l.upcomingNeed) > 0 ? `${l.upcomingNeed} for upcoming POs` : ""].filter(Boolean).join(", ");
        await c.query("INSERT INTO purchase_request_lines(request_id,item_key,quantity,unit,note) VALUES($1,$2,$3,$4,$5)", [id, l.itemKey, l.toBuy, l.unit, note]);
      }
      await this.event(c, id, actor, "created", null, "draft", "From the inventory status", { lines: lines.length });
      return this.getRequest(actor, id, c);
    });
  }

  async updateRequest(actor: string, id: string, input: Partial<{ title: string; purpose: string; neededBy: string | null; deliveryTo: string; paymentTerms: string }>) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      const map: Record<string, string> = { title: "title", purpose: "purpose", neededBy: "needed_by", deliveryTo: "delivery_to", paymentTerms: "payment_terms" };
      const sets: string[] = [], values: unknown[] = [id];
      for (const [k, col] of Object.entries(map)) {
        const v = (input as Record<string, unknown>)[k];
        if (v !== undefined) { values.push(v); sets.push(`${col}=$${values.length}`); }
      }
      if (sets.length) await c.query(`UPDATE purchase_requests SET ${sets.join(", ")}, updated_at=now() WHERE id=$1`, values);
      return this.getRequest(actor, id, c);
    });
  }

  async addLine(actor: string, id: string, input: { itemKey: string; quantity: string; unit: string; note: string }) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      const item = (await c.query(`SELECT unit, display_name FROM ${PROCUREMENT_ITEMS} i WHERE key=$1`, [input.itemKey])).rows[0];
      if (!item) throw new HttpError(400, "Choose an item from the rate master or the misc items list.");
      if (!boughtByBuyer(input.itemKey, item.display_name ?? "")) throw new HttpError(422, NOT_FOR_BUYER);
      const dup = (await c.query("SELECT 1 FROM purchase_request_lines WHERE request_id=$1 AND item_key=$2", [id, input.itemKey])).rowCount;
      if (dup) throw new HttpError(409, "That item is already on this request. Change its quantity instead.");
      await c.query("INSERT INTO purchase_request_lines(request_id,item_key,quantity,unit,note) VALUES($1,$2,$3,$4,$5)", [id, input.itemKey, input.quantity, input.unit || item.unit, input.note]);
      await this.touch(c, id);
      return this.getRequest(actor, id, c);
    });
  }
  async updateLine(actor: string, id: string, lineId: string, input: { quantity?: string; unit?: string; note?: string }) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      const r = await c.query(
        "UPDATE purchase_request_lines SET quantity=COALESCE($3,quantity), unit=COALESCE($4,unit), note=COALESCE($5,note) WHERE id=$2 AND request_id=$1",
        [id, lineId, input.quantity ?? null, input.unit ?? null, input.note ?? null],
      );
      if (!r.rowCount) throw new HttpError(404, "Line not found.");
      await this.touch(c, id);
      return this.getRequest(actor, id, c);
    });
  }
  async removeLine(actor: string, id: string, lineId: string) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      await c.query("UPDATE purchase_request_lines SET chosen_quote_id=NULL WHERE id=$2 AND request_id=$1", [id, lineId]);
      const r = await c.query("DELETE FROM purchase_request_lines WHERE id=$2 AND request_id=$1", [id, lineId]);
      if (!r.rowCount) throw new HttpError(404, "Line not found.");
      await this.touch(c, id);
      return this.getRequest(actor, id, c);
    });
  }
  async addQuote(actor: string, id: string, lineId: string, input: { vendor: string; rate: string; note: string }) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      const line = (await c.query("SELECT 1 FROM purchase_request_lines WHERE id=$2 AND request_id=$1", [id, lineId])).rowCount;
      if (!line) throw new HttpError(404, "Line not found.");
      await c.query("INSERT INTO purchase_quotes(line_id,vendor,rate,note,created_by) VALUES($1,$2,$3,$4,$5)", [lineId, input.vendor, input.rate, input.note, actor]);
      await this.chooseLowestIfNone(c, lineId);
      await this.touch(c, id);
      return this.getRequest(actor, id, c);
    });
  }
  /**
   * One vendor's quotation for many items at once, typed in a grid or read from the vendor's filled RFQ Excel
   * (Moaz, 24 Oct 2026). A vendor's earlier rate on the same item is replaced, and stays chosen if it was.
   */
  async importQuotes(actor: string, id: string, input: { vendor: string; lines: { lineId: string; rate: string; note: string }[] }) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      const mine = new Set((await c.query("SELECT id FROM purchase_request_lines WHERE request_id=$1", [id])).rows.map((r) => r.id as string));
      const seen = new Set<string>();
      for (const l of input.lines) {
        if (!mine.has(l.lineId)) throw new HttpError(400, "A quoted item is not on this request.");
        if (seen.has(l.lineId)) throw new HttpError(400, "An item is quoted twice.");
        seen.add(l.lineId);
        const old = (await c.query(
          "SELECT q.id, l.chosen_quote_id=q.id AS chosen FROM purchase_quotes q JOIN purchase_request_lines l ON l.id=q.line_id WHERE q.line_id=$1 AND lower(btrim(q.vendor))=lower(btrim($2))",
          [l.lineId, input.vendor],
        )).rows;
        for (const q of old) {
          await c.query("UPDATE purchase_request_lines SET chosen_quote_id=NULL WHERE id=$1 AND chosen_quote_id=$2", [l.lineId, q.id]);
          await c.query("DELETE FROM purchase_quotes WHERE id=$1", [q.id]);
        }
        const q = (await c.query("INSERT INTO purchase_quotes(line_id,vendor,rate,note,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id", [l.lineId, input.vendor, l.rate, l.note, actor])).rows[0];
        if (old.some((x) => x.chosen)) await c.query("UPDATE purchase_request_lines SET chosen_quote_id=$2 WHERE id=$1", [l.lineId, q.id]);
        await this.chooseLowestIfNone(c, l.lineId);
      }
      await c.query(
        `UPDATE purchase_rfq_vendors v SET replied_at=COALESCE(v.replied_at, now()) FROM purchase_rfqs r
         WHERE r.id=v.rfq_id AND r.request_id=$1 AND lower(btrim(v.vendor))=lower(btrim($2))`,
        [id, input.vendor],
      );
      await this.touch(c, id);
      return this.getRequest(actor, id, c);
    });
  }
  async removeQuote(actor: string, id: string, quoteId: string) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      const q = (await c.query("SELECT q.line_id FROM purchase_quotes q JOIN purchase_request_lines l ON l.id=q.line_id WHERE q.id=$2 AND l.request_id=$1", [id, quoteId])).rows[0];
      if (!q) throw new HttpError(404, "Quotation not found.");
      await c.query("UPDATE purchase_request_lines SET chosen_quote_id=NULL, chosen_by_buyer=false WHERE id=$1 AND chosen_quote_id=$2", [q.line_id, quoteId]);
      await c.query("DELETE FROM purchase_quotes WHERE id=$1", [quoteId]);
      await this.chooseLowestIfNone(c, q.line_id);
      await this.touch(c, id);
      return this.getRequest(actor, id, c);
    });
  }
  async chooseQuote(actor: string, id: string, lineId: string, quoteId: string) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      const ok = (await c.query("SELECT 1 FROM purchase_quotes WHERE id=$2 AND line_id=$1", [lineId, quoteId])).rowCount;
      if (!ok) throw new HttpError(404, "Quotation not found on that line.");
      await c.query("UPDATE purchase_request_lines SET chosen_quote_id=$3, chosen_by_buyer=true WHERE id=$2 AND request_id=$1", [id, lineId, quoteId]);
      await this.touch(c, id);
      return this.getRequest(actor, id, c);
    });
  }

  async submit(actor: string, id: string) {
    return transaction(this.pool, async (c) => {
      await this.draft(c, actor, id);
      const lines = (await c.query("SELECT id, item_key, chosen_quote_id FROM purchase_request_lines WHERE request_id=$1", [id])).rows;
      if (!lines.length) throw new HttpError(422, "Add at least one item before sending the request.");
      const missing = lines.filter((l) => !l.chosen_quote_id).map((l) => l.item_key);
      if (missing.length) throw new HttpError(422, `Add a quotation for: ${missing.join(", ")}.`);
      await this.freezeRates(c, lines);
      await c.query("UPDATE purchase_requests SET status='pending_approval', submitted_at=now(), updated_at=now() WHERE id=$1", [id]);
      await this.event(c, id, actor, "submitted", "draft", "pending_approval");
      return this.getRequest(actor, id, c);
    });
  }
  /** Freeze the last buying rate the approver compares against. */
  private async freezeRates(c: PoolClient, lines: { id: string; item_key: string }[]) {
    const last = await lastRates(c, lines.map((l) => l.item_key));
    for (const l of lines) {
      const r = last(l.item_key);
      await c.query("UPDATE purchase_request_lines SET last_rate=$2, last_rate_unit=$3, last_rate_source=$4 WHERE id=$1", [l.id, r?.rate ?? null, r?.unit ?? "", r?.source ?? ""]);
    }
  }

  /**
   * The buyer approves a request himself (Moaz, 26 Oct 2026), from a draft or while it waits for Abu Bakar. It is
   * marked self-approved and kept in the history, and every approver and everyone Admin marks "notify" is told.
   */
  async selfApprove(actor: string, id: string, input: { note: string }) {
    return transaction(this.pool, async (c) => {
      const me = await this.buyer(actor, c);
      const status = await this.lock(c, id);
      if (status !== "draft" && status !== "pending_approval") throw new HttpError(422, "Only a draft or a request waiting for approval can be approved.");
      if (status === "draft") {
        const lines = (await c.query("SELECT id, item_key, chosen_quote_id FROM purchase_request_lines WHERE request_id=$1", [id])).rows;
        if (!lines.length) throw new HttpError(422, "Add at least one item before approving the request.");
        const missing = lines.filter((l) => !l.chosen_quote_id).map((l) => l.item_key);
        if (missing.length) throw new HttpError(422, `Add a quotation for: ${missing.join(", ")}.`);
        await this.freezeRates(c, lines);
        await c.query("UPDATE purchase_requests SET submitted_at=now() WHERE id=$1", [id]);
      }
      await c.query(
        "UPDATE purchase_requests SET status='approved', self_approved=true, decided_by=$2, decided_at=now(), decision_note=$3, updated_at=now() WHERE id=$1",
        [id, actor, input.note],
      );
      await this.event(c, id, actor, "self_approved", status, "approved", input.note);
      const r = await this.getRequest(actor, id, c);
      const reference = `${r.number} · ${r.title}: PKR ${Number(r.totals.atChosen).toLocaleString("en-US", { maximumFractionDigits: 0 })} for ${r.lines.length} item${r.lines.length === 1 ? "" : "s"}, self-approved by ${me.displayName}${input.note ? ` · ${input.note}` : ""}`.slice(0, 500);
      const people = (await c.query(
        "SELECT DISTINCT a.user_id FROM procurement_access a JOIN users u ON u.id=a.user_id AND u.active WHERE a.capability IN ('approver','notify') AND a.user_id<>$1",
        [actor],
      )).rows;
      for (const p of people) {
        const n = (await c.query(
          "INSERT INTO procurement_notices(kind,user_id,request_id,reference) VALUES('self_approved',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING id, created_at",
          [p.user_id, id, reference],
        )).rows[0];
        if (n)
          await c.query(
            `INSERT INTO notifications(id,user_id,source_key,entity_key,kind,title,reference,actor_id,target,actionable,created_at)
             VALUES(gen_random_uuid(),$1,$2,$3,'Purchase self-approved','Purchase self-approved by the buyer',$4,NULL,$5,false,$6) ON CONFLICT DO NOTHING`,
            [p.user_id, `procurement-notice:${n.id}`, `purchase-request:${id}`, reference, JSON.stringify({ target: "purchase-approvals", requestId: id }), n.created_at],
          );
      }
      return r;
    });
  }

  async decide(actor: string, id: string, input: { decision: "approve" | "send_back" | "reject"; note: string }) {
    return transaction(this.pool, async (c) => {
      await this.approver(actor, c);
      const status = await this.lock(c, id);
      if (status !== "pending_approval") throw new HttpError(422, "This request is not waiting for approval.");
      // Nobody decides a request they created or sent for approval, whatever their role (Moaz, 24 Oct 2026).
      const own = (await c.query(
        "SELECT 1 FROM purchase_requests WHERE id=$1 AND created_by=$2 UNION SELECT 1 FROM purchase_request_events WHERE request_id=$1 AND kind='submitted' AND created_by=$2",
        [id, actor],
      )).rowCount;
      if (own) throw new HttpError(403, "You cannot decide a request you created or sent for approval.");
      if (input.decision !== "approve" && !input.note.trim()) throw new HttpError(422, "Write a note for Hamza: what needs to change, or why it is rejected.");
      const to = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "draft";
      await c.query("UPDATE purchase_requests SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4, updated_at=now() WHERE id=$1", [id, to, actor, input.note]);
      await this.event(c, id, actor, input.decision === "send_back" ? "sent_back" : input.decision === "approve" ? "approved" : "rejected", status, to, input.note);
      return this.getRequest(actor, id, c);
    });
  }

  async markOrdered(actor: string, id: string, input: { orderReference: string }) {
    return transaction(this.pool, async (c) => {
      await this.buyer(actor, c);
      const status = await this.lock(c, id);
      if (status !== "approved") throw new HttpError(422, "Only an approved request can be ordered.");
      await c.query("UPDATE purchase_requests SET status='ordered', ordered_by=$2, ordered_at=now(), order_reference=$3, updated_at=now() WHERE id=$1", [id, actor, input.orderReference]);
      await this.event(c, id, actor, "ordered", status, "ordered", input.orderReference);
      return this.getRequest(actor, id, c);
    });
  }

  /**
   * Store (Shaigan) records what arrived, item by item; the buyer does not (Moaz, 24 Oct 2026).
   * Anything short stays on order until it arrives; the request closes when every item is in.
   */
  async markReceived(actor: string, id: string, input: { lines: { itemKey: string; quantity: string }[]; note: string }) {
    return transaction(this.pool, async (c) => {
      await lockActiveActor(c,actor);
      const me = await this.me(actor, c);
      if (me.role !== "Inventory") throw new HttpError(403, "Only Store can receive material.");
      await this.inventoryDispatcher(actor,c);await this.legacyStockWrite(c);
      const status = await this.lock(c, id);
      if (status !== "ordered") throw new HttpError(422, "Only an ordered request can be received.");
      const lines = (await c.query("SELECT item_key, quantity, unit FROM purchase_request_lines WHERE request_id=$1", [id])).rows;
      const got = await this.receivedByLine(c, [id]);
      const arriving = new Map<string, number>();
      for (const x of input.lines) arriving.set(x.itemKey, (arriving.get(x.itemKey) ?? 0) + num(x.quantity));
      const arrived: { itemKey: string; quantity: string }[] = [];
      for (const [key, qty] of arriving) {
        if (qty <= 0) continue;
        const l = lines.find((y) => y.item_key === key);
        if (!l) throw new HttpError(400, "That item is not on this order.");
        const due = num(l.quantity) - (got.get(`${id}|${key}`) ?? 0);
        if (qty > due + 1e-9) {
          const name = (await rateMaster(c, [key])).get(key)?.name ?? key;
          throw new HttpError(422, `${name}: only ${fixed(Math.max(0, due))} ${l.unit} is still due on this order. Record anything extra in a stock count.`);
        }
        await c.query(
          "INSERT INTO stock_on_hand_entries(item_key,kind,quantity,unit,request_id,note,created_by) VALUES($1,'receipt',$2,$3,$4,$5,$6)",
          [key, qty, l.unit, id, input.note, actor],
        );
        arrived.push({ itemKey: key, quantity: fixed(qty) });
      }
      if (!arrived.length) throw new HttpError(422, "Enter the quantity that arrived for at least one item.");
      const after = await this.receivedByLine(c, [id]);
      const complete = lines.every((l) => (after.get(`${id}|${l.item_key}`) ?? 0) >= num(l.quantity) - 1e-9);
      if (complete) await c.query("UPDATE purchase_requests SET status='received', received_by=$2, received_at=now(), updated_at=now() WHERE id=$1", [id, actor]);
      else await c.query("UPDATE purchase_requests SET updated_at=now() WHERE id=$1", [id]);
      await this.event(c, id, actor, complete ? "received" : "part_received", status, complete ? "received" : "ordered", input.note, { arrived });
      return { id, status: complete ? ("received" as const) : ("ordered" as const), arrived: arrived.length };
    });
  }

  async cancel(actor: string, id: string, input: { note: string }) {
    return transaction(this.pool, async (c) => {
      await this.buyer(actor, c);
      const status = await this.lock(c, id);
      if (!["draft", "pending_approval", "approved"].includes(status)) throw new HttpError(422, "This request can no longer be cancelled.");
      await c.query("UPDATE purchase_requests SET status='cancelled', updated_at=now() WHERE id=$1", [id]);
      await this.event(c, id, actor, "cancelled", status, "cancelled", input.note);
      return this.getRequest(actor, id, c);
    });
  }
}
