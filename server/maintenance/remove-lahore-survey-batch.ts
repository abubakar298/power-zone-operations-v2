import type { Pool } from 'pg';

// Director authorization: 14 October 2026. These 20 survey sites only; no backup
// requested. The separate active UBL Solar portfolio and the other 16 surveys
// must not change. This is an operator-only, one-time operation, never an API.
export const removalKey = 'director-remove-lahore-20-2026-10-14';
export const removalSites = [
  [90,'0859'],[93,'0560'],[103,'0118'],[100,'2342'],[101,'2362'],
  [88,'0253'],[87,'0363'],[104,'1236'],[94,'2174'],[98,'2175'],
  [106,'2233'],[92,'2260'],[89,'2430'],[91,'2456'],[96,'2458'],
  [97,'2905'],[102,'2940'],[86,'1203'],[95,'1967'],[105,'2125'],
] as const;
const sourceSha = '3b7017ba60b646a3e27526ff81c206a2e9da2d409455f02b37cf23a88f8c6daa';
const quote = (name: string) => '"' + name.replaceAll('"','""') + '"';

export async function removeLahoreSurveyBatch(pool: Pool, requested?: string) {
  if (requested !== removalKey) return;
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await c.query("SET LOCAL lock_timeout='10s'");
    await c.query('SELECT pg_advisory_xact_lock(742019087)');
    if ((await c.query('SELECT 1 FROM audit_log WHERE action LIKE $1',[removalKey+' completed:%'])).rowCount) {
      await c.query('COMMIT'); return {alreadyCompleted:true};
    }
    await c.query('LOCK TABLE sites,ubl_workflow_requests,project_workflow_records IN SHARE ROW EXCLUSIVE MODE');
    const customer = (await c.query("SELECT id FROM customers WHERE short_code='UBL' AND id=5")).rows;
    if(customer.length!==1)throw Error('Cleanup stopped: expected UBL customer not found.');
    const actor = (await c.query("SELECT id FROM users WHERE active AND role IN('Admin','Management') AND regexp_replace(lower(display_name),'[^a-z]','','g')='abubakarsiddique' ORDER BY created_at LIMIT 1")).rows[0];
    if(!actor)throw Error('Cleanup stopped: authorizing Director account not found.');
    const batch = (await c.query('SELECT id FROM ubl_workflow_batches WHERE source_sha256=$1',[sourceSha])).rows[0];
    if(!batch)throw Error('Cleanup stopped: exact imported survey batch not found.');
    if(Number((await c.query('SELECT count(*) FROM ubl_workflow_requests WHERE batch_id=$1',[batch.id])).rows[0].count)!==36)
      throw Error('Cleanup stopped: expected 36 survey rows before removal.');
    const ids=removalSites.map(([id])=>id);
    const sites=(await c.query('SELECT id,customer_id,code FROM sites WHERE id=ANY($1::int[])',[ids])).rows;
    if(sites.length!==20 || removalSites.some(([id,code])=>!sites.some(s=>s.id===id&&s.customer_id===5&&String(s.code).padStart(4,'0')===code)))
      throw Error('Cleanup stopped: exact 20 site IDs/codes do not match.');
    if((await c.query('SELECT 1 FROM ubl_site_orders WHERE site_id=ANY($1::int[])',[ids])).rowCount)
      throw Error('Cleanup stopped: target overlaps protected UBL Solar orders.');
    const requests=(await c.query('SELECT id,site_id,branch_code FROM ubl_workflow_requests WHERE batch_id=$1 AND customer_id=5 AND site_id=ANY($2::int[])',[batch.id,ids])).rows;
    if(requests.length!==20 || removalSites.some(([id,code])=>!requests.some(r=>r.site_id===id&&String(r.branch_code).padStart(4,'0')===code)))
      throw Error('Cleanup stopped: exact 20 survey requests do not match.');
    const requestIds=requests.map(r=>r.id);
    const workflows=(await c.query("SELECT id,data FROM project_workflow_records WHERE customer_id=5 AND site_id=ANY($1::int[]) AND legacy_type='ubl' AND legacy_id=ANY($2::uuid[])",[ids,requestIds])).rows;
    if(workflows.length!==20)throw Error('Cleanup stopped: expected exactly 20 linked coordination records.');
    const workflowIds=workflows.map(r=>r.id);
    if(workflows.some(r=>r.data.draftId||r.data.quotationId||r.data.ipoId))throw Error('Cleanup stopped: linked commercial documents need separate dependency review.');
    await c.query('CREATE TEMP TABLE removal_scope(table_name text PRIMARY KEY,predicate text NOT NULL) ON COMMIT DROP');
    // Bind all IDs through temp tables. Only these explicit children are deletable;
    // other dependencies (BOQs, orders, group membership) abort via foreign keys.
    await c.query('CREATE TEMP TABLE removal_site_ids(id integer PRIMARY KEY) ON COMMIT DROP');
    await c.query('INSERT INTO removal_site_ids SELECT unnest($1::int[])',[ids]);
    await c.query('CREATE TEMP TABLE removal_request_ids(id uuid PRIMARY KEY) ON COMMIT DROP');
    await c.query('INSERT INTO removal_request_ids SELECT unnest($1::uuid[])',[requestIds]);
    await c.query('CREATE TEMP TABLE removal_workflow_ids(id uuid PRIMARY KEY) ON COMMIT DROP');
    await c.query('INSERT INTO removal_workflow_ids SELECT unnest($1::uuid[])',[workflowIds]);
    const plan:[string,string][]=[
      ['ubl_workflow_demand','request_id IN(SELECT id FROM removal_request_ids)'],
      ['ubl_workflow_attachments','request_id IN(SELECT id FROM removal_request_ids)'],
      ['ubl_workflow_documents','request_id IN(SELECT id FROM removal_request_ids)'],
      ['ubl_workflow_events','request_id IN(SELECT id FROM removal_request_ids)'],
      ['project_workflow_files','record_id IN(SELECT id FROM removal_workflow_ids)'],
      ['project_workflow_documents','record_id IN(SELECT id FROM removal_workflow_ids)'],
      ['project_workflow_events','record_id IN(SELECT id FROM removal_workflow_ids)'],
      ['project_workflow_records','id IN(SELECT id FROM removal_workflow_ids)'],
      ['ubl_workflow_requests','id IN(SELECT id FROM removal_request_ids)'],
      ['sites','id IN(SELECT id FROM removal_site_ids)'],
    ];
    for(const [table,predicate] of plan)await c.query('INSERT INTO removal_scope VALUES($1,$2)',[table,predicate]);
    // Shared generated packages are not safe to delete as part of an individual
    // site's cleanup. Stop for inspection if they contain any target record.
    for(const table of ['ubl_survey_review_packages','survey_dispatch_previews','customer_headsup_receipts','headsup_department_handoffs']) {
      if((await c.query(`SELECT 1 FROM ${quote(table)} t WHERE EXISTS(SELECT 1 FROM removal_workflow_ids i WHERE position(i.id::text in to_jsonb(t)::text)>0)`)).rowCount)
        throw Error('Cleanup stopped: shared document dependency in '+table);
    }
    // Fingerprint EVERY non-target row. This also covers all 36 active Solar
    // sites, other survey rows, master rates/rules, and finalized documents.
    const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename as string);
    const fingerprint=async(table:string)=>{
      const predicate=plan.find(([t])=>t===table)?.[1];
      return (await c.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS hash FROM (SELECT md5(to_jsonb(t)::text) h FROM ${quote(table)} t ${predicate?'WHERE NOT ('+predicate+')':''}) s`)).rows[0];
    };
    const before=new Map<string,unknown>();
    for(const table of tables)before.set(table,await fingerprint(table));
    const counts:Record<string,number>={};
    for(const [table,predicate] of plan){
      const triggers=(await c.query("SELECT tgname FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal AND tgenabled='O' AND tgfoid='prevent_master_version_mutation()'::regprocedure",[table])).rows;
      // Transaction-local DDL with table locks; constraints are NEVER disabled.
      for(const {tgname} of triggers)await c.query(`ALTER TABLE ${quote(table)} DISABLE TRIGGER ${quote(tgname)}`);
      counts[table]=(await c.query(`DELETE FROM ${quote(table)} WHERE ${predicate}`)).rowCount??0;
      for(const {tgname} of triggers)await c.query(`ALTER TABLE ${quote(table)} ENABLE TRIGGER ${quote(tgname)}`);
    }
    for(const table of tables)if(JSON.stringify(before.get(table))!==JSON.stringify(await fingerprint(table)))
      throw Error('Cleanup rolled back: unrelated rows changed in '+table);
    if(counts.sites!==20||counts.ubl_workflow_requests!==20||counts.project_workflow_records!==20)
      throw Error('Cleanup rolled back: deletion counts differ from authorized scope.');
    if(Number((await c.query('SELECT count(*) FROM ubl_workflow_requests WHERE batch_id=$1',[batch.id])).rows[0].count)!==16)
      throw Error('Cleanup rolled back: remaining survey batch must contain 16 sites.');
    // Audit only the authorization, codes and counts; no copy of deleted data.
    await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor.id,removalKey+' completed: '+JSON.stringify({codes:removalSites.map(([,code])=>code),counts,otherTablesPreserved:tables.length})]);
    await c.query('COMMIT');
    return counts;
  }catch(error){await c.query('ROLLBACK');throw error;}
  finally{c.release();}
}
