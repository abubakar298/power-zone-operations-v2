import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';
export async function requireOpenParent(c:Pool|PoolClient,id:string){if(!(await c.query("SELECT to_regclass('public.inventory_parent_reconciliation_versions') IS NOT NULL ready")).rows[0].ready)return;const state=(await c.query('SELECT status FROM inventory_parent_reconciliation_versions WHERE draft_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];if(state?.status==='closed')throw new HttpError(409,'This Parent DO is closed. Management must review it before any further changes.');}
