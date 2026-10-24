import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
import { transaction } from "../db/transaction.js";
import { fixed, num } from "./supply.js";

type Db = Pool | PoolClient;
/** Who may open a site's misc items BOQ. It never appears on BOQs, quotations, costing or customer documents. */
const READ_ROLES = new Set(["Design", "Admin", "Management", "Inventory"]);
/** Design fills it with the survey report; Admin can correct it. */
const EDIT_ROLES = new Set(["Design", "Admin"]);
const NEW_KEY = "'MSC-' || lpad(nextval('misc_item_number')::text,3,'0')";

interface Who { role: string; buyer: boolean }
export interface MiscOption { key: string; label: string; pvKw: number; inverterKw: number; batteryKwh: number; items: { itemKey: string; quantity: string }[] }
export interface MiscLine { itemKey: string; name: string; unit: string; quantity: string }

/** The option nearest to what the survey recorded: PV from panels × wattage, the inverter size, the battery kWh. */
export function suggestOption(options: MiscOption[], survey: any) {
  if (!survey) return null;
  const pv = (num(survey.panelQty) * num(survey.panelWattage)) / 1000;
  const sizes = String(survey.inverter ?? "").match(/\d+(\.\d+)?/g);
  const inverter = sizes ? Number(sizes[sizes.length - 1]) : NaN;
  const battery = num(survey.batteryKwh);
  if (!pv && !Number.isFinite(inverter) && !battery) return null;
  const gap = (o: MiscOption) => Math.abs(o.pvKw - pv) + (Number.isFinite(inverter) ? Math.abs(o.inverterKw - inverter) : 0) + Math.abs(o.batteryKwh - battery);
  const best = [...options].sort((a, b) => gap(a) - gap(b))[0];
  if (!best) return null;
  return {
    optionKey: best.key, exact: gap(best) < 1e-9,
    survey: `${fixed(pv)} kW PV · ${Number.isFinite(inverter) ? `${fixed(inverter)} kW` : "?"} inverter · ${fixed(battery)} kWh battery`,
  };
}

/**
 * Misc items BOQ (Moaz, 24 Oct 2026). Design fills it per site with the survey report, starting from one of the four
 * system sizes in "BOQ(20or25-20-30&30or35-30-40).xlsx" and adding items on the spot. Procurement (Hamza) buys the
 * items and Store (Shaigan) sends them to site. Only Design, the buyer, Store, Admin and Management can open it.
 */
export class MiscItemsRepository {
  constructor(private pool: Pool) {}

  private async who(actor: string, c: Db = this.pool): Promise<Who> {
    const u = (await c.query("SELECT role FROM users WHERE id=$1 AND active", [actor])).rows[0];
    if (!u) throw new HttpError(403, "Your account is not active.");
    const buyer = Boolean((await c.query("SELECT 1 FROM procurement_access WHERE user_id=$1 AND capability='buyer'", [actor])).rowCount);
    return { role: u.role, buyer };
  }
  private async reader(actor: string, c: Db = this.pool) {
    const w = await this.who(actor, c);
    if (!w.buyer && !READ_ROLES.has(w.role)) throw new HttpError(403, "The misc items BOQ is not part of your workspace.");
    return w;
  }

  private async options(c: Db) {
    const rows = (await c.query("SELECT key, label, pv_kw, inverter_kw, battery_kwh FROM misc_boq_options WHERE active ORDER BY sort")).rows;
    const items = (await c.query("SELECT option_key, item_key, quantity FROM misc_boq_option_items i JOIN misc_items m ON m.key=i.item_key WHERE m.active ORDER BY m.sort")).rows;
    return rows.map((o): MiscOption => ({
      key: o.key, label: o.label, pvKw: num(o.pv_kw), inverterKw: num(o.inverter_kw), batteryKwh: num(o.battery_kwh),
      items: items.filter((i) => i.option_key === o.key).map((i) => ({ itemKey: i.item_key as string, quantity: fixed(num(i.quantity)) })),
    }));
  }

  /** The misc items list and the four options, for Design's form and Hamza's list. */
  async catalogue(actor: string) {
    const w = await this.reader(actor);
    const items = (await this.pool.query("SELECT key, name, unit, active, sort FROM misc_items ORDER BY sort, key")).rows
      .map((i) => ({ itemKey: i.key as string, name: i.name as string, unit: i.unit as string, active: i.active as boolean }));
    return { items, options: await this.options(this.pool), can: { addItem: w.buyer || EDIT_ROLES.has(w.role), editItems: w.buyer || w.role === "Admin" } };
  }

  async site(actor: string, recordId: string, c: Db = this.pool) {
    const w = await this.reader(actor, c);
    const r = (await c.query(
      `SELECT r.id, r.site_name, r.site_code, r.stage, r.data->'surveyInputs' AS survey, cu.name AS customer
       FROM project_workflow_records r LEFT JOIN customers cu ON cu.id=r.customer_id WHERE r.id=$1`,
      [recordId],
    )).rows[0];
    if (!r) throw new HttpError(404, "Site not found.");
    const b = (await c.query(
      `SELECT b.*, o.label AS option_label, uu.display_name AS updated_by_name, su.display_name AS sent_by_name
       FROM site_misc_boqs b LEFT JOIN misc_boq_options o ON o.key=b.option_key JOIN users uu ON uu.id=b.updated_by
       LEFT JOIN users su ON su.id=b.sent_by WHERE b.record_id=$1`,
      [recordId],
    )).rows[0];
    const lines: MiscLine[] = b ? (await c.query(
      "SELECT l.item_key, m.name, m.unit, l.quantity FROM site_misc_boq_lines l JOIN misc_items m ON m.key=l.item_key WHERE l.record_id=$1 ORDER BY m.sort, m.key",
      [recordId],
    )).rows.map((l) => ({ itemKey: l.item_key, name: l.name, unit: l.unit, quantity: fixed(num(l.quantity)) })) : [];
    const events = b ? (await c.query(
      "SELECT e.kind, e.version, e.note, e.created_at, u.display_name AS actor FROM site_misc_boq_events e JOIN users u ON u.id=e.created_by WHERE e.record_id=$1 ORDER BY e.created_at DESC",
      [recordId],
    )).rows.map((e) => ({ kind: e.kind as string, version: e.version as number, note: e.note as string, actor: e.actor as string, at: e.created_at as string })) : [];
    const sent = Boolean(b?.sent_at);
    return {
      recordId: r.id as string, siteName: r.site_name as string, siteCode: r.site_code as string, customer: (r.customer ?? null) as string | null, stage: r.stage as string,
      boq: b ? {
        optionKey: (b.option_key ?? null) as string | null, optionLabel: (b.option_label ?? null) as string | null, version: b.version as number, note: b.note as string,
        updatedBy: b.updated_by_name as string, updatedAt: b.updated_at as string,
        sentBy: (b.sent_by_name ?? null) as string | null, sentAt: (b.sent_at ?? null) as string | null, sentNote: b.sent_note as string, lines,
      } : null,
      suggestion: suggestOption(await this.options(c), r.survey),
      events,
      can: { edit: EDIT_ROLES.has(w.role) && !sent && r.stage !== "declined", send: w.role === "Inventory" && Boolean(b) && !sent },
    };
  }

  async save(actor: string, recordId: string, input: { version: number | null; optionKey: string | null; lines: { itemKey: string; quantity: string }[]; note: string }) {
    return transaction(this.pool, async (c) => {
      const w = await this.who(actor, c);
      if (!EDIT_ROLES.has(w.role)) throw new HttpError(403, "Only Design can fill the misc items BOQ.");
      const r = (await c.query("SELECT stage FROM project_workflow_records WHERE id=$1 FOR UPDATE", [recordId])).rows[0];
      if (!r) throw new HttpError(404, "Site not found.");
      if (r.stage === "declined") throw new HttpError(422, "This site is closed.");
      const b = (await c.query("SELECT version, sent_at FROM site_misc_boqs WHERE record_id=$1 FOR UPDATE", [recordId])).rows[0];
      if (b?.sent_at) throw new HttpError(422, "Store has already sent these misc items to site; the list can no longer change.");
      if ((b?.version ?? null) !== input.version) throw new HttpError(409, "Someone else saved this misc items list meanwhile. Reload it and try again.");
      if (input.optionKey && !(await c.query("SELECT 1 FROM misc_boq_options WHERE key=$1", [input.optionKey])).rowCount)
        throw new HttpError(400, "Choose one of the listed options.");
      const seen = new Set<string>();
      for (const l of input.lines) {
        if (seen.has(l.itemKey)) throw new HttpError(400, "An item appears twice on the list.");
        seen.add(l.itemKey);
        if (!(num(l.quantity) > 0)) throw new HttpError(400, "Every quantity must be more than zero; remove items that are not needed.");
      }
      if (!input.lines.length) throw new HttpError(400, "Add at least one misc item.");
      const known = new Set((await c.query("SELECT key FROM misc_items WHERE key = ANY($1)", [[...seen]])).rows.map((x) => x.key as string));
      if (known.size !== seen.size) throw new HttpError(400, "An item is not in the misc items list.");
      const version = (b?.version ?? 0) + 1;
      if (b) await c.query("UPDATE site_misc_boqs SET option_key=$2, version=$3, note=$4, updated_by=$5, updated_at=now() WHERE record_id=$1", [recordId, input.optionKey, version, input.note, actor]);
      else await c.query("INSERT INTO site_misc_boqs(record_id, option_key, version, note, updated_by) VALUES($1,$2,$3,$4,$5)", [recordId, input.optionKey, version, input.note, actor]);
      await c.query("DELETE FROM site_misc_boq_lines WHERE record_id=$1", [recordId]);
      for (const l of input.lines)
        await c.query("INSERT INTO site_misc_boq_lines(record_id, item_key, quantity) VALUES($1,$2,$3)", [recordId, l.itemKey, l.quantity]);
      await c.query(
        "INSERT INTO site_misc_boq_events(record_id, kind, version, snapshot, note, created_by) VALUES($1,'saved',$2,$3,$4,$5)",
        [recordId, version, JSON.stringify({ optionKey: input.optionKey, lines: input.lines }), input.note, actor],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `misc-boq.saved:${recordId}`]);
      return this.site(actor, recordId, c);
    });
  }

  /** A new misc item, added on the spot by Design or by the buyer. */
  async addItem(actor: string, input: { name: string; unit: string }) {
    return transaction(this.pool, async (c) => {
      const w = await this.who(actor, c);
      if (!w.buyer && !EDIT_ROLES.has(w.role)) throw new HttpError(403, "Only Design or the Procurement buyer can add misc items.");
      const dup = (await c.query("SELECT key FROM misc_items WHERE lower(btrim(name))=lower(btrim($1))", [input.name])).rows[0];
      if (dup) throw new HttpError(409, `That item is already on the list as ${dup.key}.`);
      const sort = num((await c.query("SELECT COALESCE(max(sort),0)+1 AS s FROM misc_items")).rows[0].s);
      const row = (await c.query(
        `INSERT INTO misc_items(key, name, unit, sort, created_by) VALUES(${NEW_KEY}, $1, $2, $3, $4) RETURNING key, name, unit, active`,
        [input.name, input.unit, sort, actor],
      )).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `misc-item.added:${row.key}`]);
      return { itemKey: row.key as string, name: row.name as string, unit: row.unit as string, active: row.active as boolean };
    });
  }

  /** The buyer corrects a misc item's name or unit, or takes it off the list for new sites. */
  async updateItem(actor: string, key: string, input: { name?: string; unit?: string; active?: boolean }) {
    return transaction(this.pool, async (c) => {
      const w = await this.who(actor, c);
      if (!w.buyer && w.role !== "Admin") throw new HttpError(403, "Only the Procurement buyer can change the misc items list.");
      const cur = (await c.query("SELECT key FROM misc_items WHERE key=$1 FOR UPDATE", [key])).rows[0];
      if (!cur) throw new HttpError(404, "Misc item not found.");
      if (input.name !== undefined) {
        const dup = (await c.query("SELECT key FROM misc_items WHERE lower(btrim(name))=lower(btrim($1)) AND key<>$2", [input.name, key])).rows[0];
        if (dup) throw new HttpError(409, `That name is already used by ${dup.key}.`);
      }
      const row = (await c.query(
        "UPDATE misc_items SET name=COALESCE($2,name), unit=COALESCE($3,unit), active=COALESCE($4,active) WHERE key=$1 RETURNING key, name, unit, active",
        [key, input.name ?? null, input.unit ?? null, input.active ?? null],
      )).rows[0];
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `misc-item.updated:${key}`]);
      return { itemKey: row.key as string, name: row.name as string, unit: row.unit as string, active: row.active as boolean };
    });
  }

  /**
   * Every site with a misc items BOQ, for Hamza (what to buy, site by site) and Shaigan (what to send).
   * "received" = the site has a customer PO and is not delivered yet; "upcoming" = heads-up without a PO; "survey" = neither yet.
   */
  async sites(actor: string) {
    const w = await this.reader(actor);
    if (w.role === "Design" && !w.buyer) throw new HttpError(403, "Design opens the misc items BOQ from the site's survey step.");
    const rows = (await this.pool.query(
      `SELECT b.record_id, b.option_key, o.label AS option_label, b.version, b.updated_at, b.sent_at, b.sent_note,
         uu.display_name AS updated_by_name, su.display_name AS sent_by_name,
         r.site_name, r.site_code, r.region, r.stage, cu.name AS customer,
         x.issuance_id, sw.delivered_on, sw.expected_delivery,
         EXISTS (SELECT 1 FROM project_advance_planning p WHERE p.record_id=r.id AND p.confirmed_issuance_id IS NULL)
           OR EXISTS (SELECT 1 FROM headsup_advance_members m WHERE m.record_id=r.id) AS headsup
       FROM site_misc_boqs b JOIN project_workflow_records r ON r.id=b.record_id LEFT JOIN customers cu ON cu.id=r.customer_id
       LEFT JOIN misc_boq_options o ON o.key=b.option_key JOIN users uu ON uu.id=b.updated_by LEFT JOIN users su ON su.id=b.sent_by
       LEFT JOIN LATERAL (
         SELECT operations_id AS issuance_id FROM project_workflow_issuances WHERE record_id=r.id
         UNION ALL SELECT confirmed_issuance_id FROM project_advance_planning WHERE record_id=r.id AND confirmed_issuance_id IS NOT NULL
         UNION ALL SELECT operations_id FROM headsup_advance_final_links WHERE record_id=r.id LIMIT 1) x ON true
       LEFT JOIN site_workflow sw ON sw.issuance_id=x.issuance_id
       ORDER BY b.sent_at IS NOT NULL, COALESCE(sw.expected_delivery, b.updated_at::date), r.site_name`,
    )).rows;
    const lines = rows.length ? (await this.pool.query(
      "SELECT l.record_id, l.item_key, m.name, m.unit, l.quantity FROM site_misc_boq_lines l JOIN misc_items m ON m.key=l.item_key WHERE l.record_id = ANY($1) ORDER BY m.sort, m.key",
      [rows.map((r) => r.record_id)],
    )).rows : [];
    return {
      sites: rows.map((r) => ({
        recordId: r.record_id as string, siteName: r.site_name as string, siteCode: r.site_code as string, customer: (r.customer ?? null) as string | null,
        region: (r.region || null) as string | null, optionKey: (r.option_key ?? null) as string | null, optionLabel: (r.option_label ?? null) as string | null,
        version: r.version as number, updatedBy: r.updated_by_name as string, updatedAt: r.updated_at as string,
        po: r.issuance_id ? (r.delivered_on ? "delivered" : "received") : r.headsup ? "upcoming" : "survey",
        expectedDelivery: r.expected_delivery ? String(r.expected_delivery).slice(0, 10) : null,
        sentAt: (r.sent_at ?? null) as string | null, sentBy: (r.sent_by_name ?? null) as string | null, sentNote: r.sent_note as string,
        lines: lines.filter((l) => l.record_id === r.record_id).map((l): MiscLine => ({ itemKey: l.item_key, name: l.name, unit: l.unit, quantity: fixed(num(l.quantity)) })),
      })),
      can: { send: w.role === "Inventory" },
    };
  }

  /** Store records that the site's misc items have gone out; they leave the buying needs and Store's list. */
  async markSent(actor: string, recordId: string, input: { note: string }) {
    return transaction(this.pool, async (c) => {
      const w = await this.who(actor, c);
      if (w.role !== "Inventory") throw new HttpError(403, "Only Store can send misc items to site.");
      const b = (await c.query("SELECT version, option_key, sent_at FROM site_misc_boqs WHERE record_id=$1 FOR UPDATE", [recordId])).rows[0];
      if (!b) throw new HttpError(404, "This site has no misc items BOQ.");
      if (b.sent_at) throw new HttpError(422, "These misc items were already sent.");
      const lines = (await c.query("SELECT item_key, quantity FROM site_misc_boq_lines WHERE record_id=$1", [recordId])).rows;
      await c.query("UPDATE site_misc_boqs SET sent_by=$2, sent_at=now(), sent_note=$3 WHERE record_id=$1", [recordId, actor, input.note]);
      await c.query(
        "INSERT INTO site_misc_boq_events(record_id, kind, version, snapshot, note, created_by) VALUES($1,'sent',$2,$3,$4,$5)",
        [recordId, b.version, JSON.stringify({ optionKey: b.option_key, lines: lines.map((l) => ({ itemKey: l.item_key, quantity: fixed(num(l.quantity)) })) }), input.note, actor],
      );
      await c.query("INSERT INTO audit_log(user_id,action) VALUES($1,$2)", [actor, `misc-boq.sent:${recordId}`]);
      return { recordId, sent: true };
    });
  }
}
