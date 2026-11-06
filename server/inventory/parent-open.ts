import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';
export async function requireOpenParent(c:Pool|PoolClient,id:string){
 if(!(await c.query("SELECT to_regclass('public.inventory_parent_reconciliation_versions') IS NOT NULL ready")).rows[0].ready)return;
 const state=(await c.query(`SELECT status FROM (
  SELECT DISTINCT ON(draft_id) draft_id,status,version FROM inventory_parent_reconciliation_versions
  WHERE draft_id=$1 OR draft_id IN(SELECT d.draft_id FROM inventory_material_dispatches_active d WHERE d.snapshot#>>'{combinedPlan,fixedDraftId}'=$1::text OR d.snapshot#>>'{combinedPlan,variableDraftId}'=$1::text)
  ORDER BY draft_id,version DESC
 ) latest WHERE status='closed' LIMIT 1`,[id])).rows[0];
 if(state)throw new HttpError(409,'This material ledger is closed. Management must review it before any further changes.');
}
