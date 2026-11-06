import{approvedMasterAdditions}from'./approved-master-additions.js';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {preservationSnapshot} from '../db/preservation.js';
import {transaction} from '../db/transaction.js';
export const canonical=(x:any):string=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
/** No HTTP endpoint. Only a deliberately invoked hosting-shell operation can run this import. */
export async function importLocalWorkflow(pool:pg.Pool,payload:any,sourceSha:string){
 if(payload.authorization!=='Director-approved-25-UBL-2026-10-15'||payload.pack?.roots?.length!==25)throw Error('Unapproved import scope');
 const expectedCodes=['0000','0118','0253','0363','0560','0859','1203','1236','1967','2125','2174','2175','2233','2260','2342','2362','2430','2456','2458','2478','2482','2537','2771','2905','2940'];
 if(canonical(payload.pack.roots.map((r:any)=>r.site_code).sort())!==canonical(expectedCodes))throw Error('Import site list differs from Director approval');
 return transaction(pool,async(client)=>{
 await client.query("SELECT pg_advisory_xact_lock(hashtext('project-workflow-create'))");
 await client.query('SELECT pg_advisory_xact_lock(742019040)');
 const prior=(await client.query('SELECT verification FROM local_workflow_import_receipts WHERE source_sha256=$1',[sourceSha])).rows[0];if(prior)return{...prior.verification,repeated:true};
 const executedBy=payload.executedBy,operator=(await client.query("SELECT id FROM users WHERE id=$1 AND active AND role='Admin'",[executedBy])).rows[0];if(!operator)throw Error('Director administrator identity must exist and be active');
 if((await client.query("SELECT short_code FROM customers WHERE id=5")).rows[0]?.short_code!=='UBL')throw Error('Customer identity changed');
 const incomingCodes=payload.pack.roots.map((r:any)=>r.site_code),existing=(await client.query('SELECT id,site_code,stage,version FROM project_workflow_records WHERE customer_id=5 AND site_code=ANY($1::text[]) FOR UPDATE',[incomingCodes])).rows;
 const allowedOld=new Set(payload.originalWorkflows.map((r:any)=>r.id));if(existing.length!==4||existing.some(r=>!allowedOld.has(r.id)))throw Error('Concurrent live workflow found; import cancelled');
 for(const original of payload.originalWorkflows){
 const checked=(await client.query('SELECT row_to_json(r) AS row,(r.created_at=$2::timestamptz AND r.updated_at=$3::timestamptz) AS timestamps_match FROM project_workflow_records r WHERE id=$1',[original.id,original.created_at,original.updated_at])).rows[0];
 const {created_at:oldCreated,updated_at:oldUpdated,...oldFields}=original;const {created_at:currentCreated,updated_at:currentUpdated,...currentFields}=checked?.row??{};
 if(!checked?.timestamps_match||canonical(currentFields)!==canonical(oldFields))throw Error('Existing workflow changed since the reviewed backup; import cancelled');
 }

 const approvedMasterChanges=await approvedMasterAdditions(client,payload.approvedMasters,executedBy);
 const before=await preservationSnapshot(client);
 const db={pool:client};
 const maps=new Map<string,Map<string,any>>(),counts:any={},provenance:any[]=[],conflicts:any[]=[];
 function set(t:string,k:any,v:any){let m=maps.get(t);if(!m){m=new Map;maps.set(t,m)}m.set(String(k),v)}function get(t:string,k:any){return maps.get(t)?.get(String(k))}
 const originalRows=new Map<string,any[]>();for(const table of Object.keys(before))originalRows.set(table,(await db.pool.query(`SELECT row_to_json(t) AS row FROM "${table}" t`)).rows.map((r:any)=>r.row));
 const pack=payload.pack,actorRoles:Record<string,string>={Coordinator:'bess@powerzone.com.pk',Design:'sajidkasrana@powerzone.com.pk',Operations:'hamzabutt@powerzone.com.pk',Admin:'abubakar@powerzone.com.pk',Management:'amc.abubakar@gmail.com',Accounts:'recoverypzes@powerzone.com.pk',Inventory:'shaiggan@powerzone.com.pk'};
 const liveUsers=(await db.pool.query('SELECT id,email,role FROM users WHERE active')).rows,sourceUsers=payload.userRows;
 for(const u of sourceUsers){let live=liveUsers.find((x:any)=>x.id===u.id)||liveUsers.find((x:any)=>x.email===u.email);if(!live&&/\.invalid$/.test(u.email))live=liveUsers.find((x:any)=>x.email===(u.display_name.startsWith('Solution Engineer')?actorRoles.Admin:actorRoles[u.role]));if(live){set('users',u.id,live.id);provenance.push({sourceActor:u.id,sourceName:u.display_name,targetActor:live.id,reason:'Director-authorised local walkthrough imported as historical work; original snapshots preserved'})}}
 for(const fk of pack.fks.filter((f:any)=>f.parent==='users'))for(const row of pack.rows.filter((r:any)=>r.table===fk.table_name)){const id=row.row[fk.column_name];if(id&&!get('users',id))throw Error('Unmapped actor '+id)}
 const sourceSites=payload.siteRows;const selectedSiteIds=new Set(pack.roots.map((r:any)=>r.site_id));
 for(const s of sourceSites.filter((s:any)=>selectedSiteIds.has(s.id))){const exists=(await db.pool.query('SELECT * FROM sites WHERE customer_id=$1 AND code=$2',[s.customer_id,s.code])).rows;if(exists.length>1)throw Error('Ambiguous site '+s.code);if(exists.length)set('sites',s.id,exists[0].id);else{const n=(await db.pool.query('SELECT coalesce(max(id),0)+1 AS id FROM sites')).rows[0].id;const row={...s,id:n};const columns=Object.keys(row);await db.pool.query(`INSERT INTO sites(${columns.map(c=>'"'+c+'"').join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));set('sites',s.id,n);counts.sites=(counts.sites??0)+1}}
 const sourceFrameworks=payload.frameworkRows;for(const id of new Set(pack.rows.flatMap((r:any)=>pack.fks.filter((f:any)=>f.table_name===r.table&&f.parent==='project_framework_versions').map((f:any)=>r.row[f.column_name]).filter(Boolean)))){const s=sourceFrameworks.find((x:any)=>x.id===id);const live=(await db.pool.query('SELECT * FROM project_framework_versions WHERE customer_id=$1 AND configuration_key=$2 AND version=$3',[s.customer_id,s.configuration_key,s.version])).rows[0];if(!live||canonical(live.payload)!==canonical(s.payload))throw Error('Frozen framework differs: '+s.configuration_key);set('project_framework_versions',id,live.id)}
 const codes=['2478','2482','2537','2771'],old=(await db.pool.query('SELECT * FROM project_workflow_records WHERE customer_id=5 AND site_code=ANY($1::text[])',[codes])).rows;if(old.length!==4||old.some(r=>r.stage!=='advance_pending'||r.version!==1||r.legacy_type!=='ubl'))throw Error('Live placeholders changed; abort replacement');
 for(const r of old){for(const fk of pack.fks.filter((f:any)=>f.parent==='project_workflow_records')){const n=(await db.pool.query(`SELECT count(*)::int AS n FROM "${fk.table_name}" WHERE "${fk.column_name}"=$1`,[r.id])).rows[0].n;if(n)throw Error('Live placeholder acquired children: '+r.site_code+' '+fk.table_name)}}
 // Recovery copy is written before deleting exactly these four empty placeholders on the disposable clone.
 // The original workflows are saved in the immutable receipt within this transaction.
 await db.pool.query('DELETE FROM project_workflow_records WHERE id=ANY($1::uuid[])',[old.map((r:any)=>r.id)]);
 const pending=[...pack.rows] as any[], inserted=new Set<string>();
 while(pending.length){let progress=false;for(let i=0;i<pending.length;i++){const item=pending[i],row={...item.row};if(item.table==='audit_log'){if(get('audit_log',row.id)===undefined){const next=(await db.pool.query('SELECT coalesce(max(id),0)+1 AS id FROM audit_log')).rows[0].id;set('audit_log',row.id,next)}row.id=get('audit_log',row.id)}let ready=true;for(const fk of pack.fks.filter((f:any)=>f.table_name===item.table)){const v=row[fk.column_name];if(v===null||v===undefined)continue;const mapped=get(fk.parent,v);if(mapped!==undefined)row[fk.column_name]=mapped;else if(!pack.masters.includes(fk.parent)){const parent=pack.rows.find((r:any)=>r.table===fk.parent&&String(r.row[fk.parent_column])===String(v));if(parent&&!inserted.has(parent.key)){ready=false;break}}}
 if(!ready)continue;
 const keys=pack.pks[item.table] as string[];if(!keys?.length)throw Error('Missing primary key '+item.table);
 const predicate=keys.map((k,j)=>'"'+k+'"=$'+(j+1)).join(' AND '),existing=(await db.pool.query(`SELECT row_to_json(t) AS row FROM "${item.table}" t WHERE ${predicate}`,keys.map(k=>row[k]))).rows[0]?.row;
 if(existing){if(canonical(existing)!==canonical(row)){conflicts.push({table:item.table,key:item.key,reason:'Existing primary key differs'});throw Error('Primary key conflict: '+item.table)} }
 else{const columnInfo=(await db.pool.query("SELECT column_name,data_type,udt_name,is_identity FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[item.table])).rows;const columns=Object.keys(row);const values=columns.map(k=>{const info=columnInfo.find(c=>c.column_name===k),v=row[k];return info?.data_type==='jsonb'||info?.data_type==='json'?JSON.stringify(v):v});try{await db.pool.query(`INSERT INTO "${item.table}"(${columns.map(c=>'"'+c+'"').join(',')}) OVERRIDING SYSTEM VALUE VALUES(${columns.map((_,j)=>'$'+(j+1)).join(',')})`,values)}catch(e:any){conflicts.push({table:item.table,key:item.key,reason:e.message});throw e}counts[item.table]=(counts[item.table]??0)+1}
 inserted.add(item.key);pending.splice(i--,1);progress=true;}if(!progress)throw Error('Unresolved cyclic dependencies: '+[...new Set(pending.map((r:any)=>r.table))].join(','))}
 const after=await preservationSnapshot(client,false,before);const changed=Object.keys(before).filter(t=>canonical(before[t])!==canonical(after[t]));
 const overwrittenOriginalRows:string[]=[];for(const[table,rows]of originalRows){const current=new Set((await db.pool.query(`SELECT row_to_json(t) AS row FROM "${table}" t`)).rows.map((r:any)=>canonical(r.row)));if(rows.some(r=>!current.has(canonical(r))))overwrittenOriginalRows.push(table)}if(overwrittenOriginalRows.length)throw Error('Original protected rows changed: '+overwrittenOriginalRows.join(','));
 const verifiedIpos=[];for(const item of pack.rows.filter((r:any)=>r.table==='internal_purchase_orders')){const live=(await db.pool.query('SELECT snapshot,number FROM internal_purchase_orders WHERE id=$1',[item.row.id])).rows[0];if(canonical(live.snapshot)!==canonical(item.row.snapshot)||live.number!==item.row.number)throw Error('IPO snapshot changed during import');verifiedIpos.push({id:item.row.id,number:live.number,identicalFrozenSnapshot:true})}
 let verifiedFiles=0;for(const item of pack.rows.filter((r:any)=>r.table==='project_workflow_files')){const file=(await db.pool.query('SELECT content,sha256 FROM project_workflow_files WHERE id=$1',[item.row.id])).rows[0];if(createHash('sha256').update(file.content).digest('hex')!==file.sha256||file.sha256!==item.row.sha256)throw Error('Evidence hash mismatch');verifiedFiles++}
 const replacements=(await db.pool.query('SELECT id,site_id,site_code,stage,data FROM project_workflow_records WHERE customer_id=5 AND site_code=ANY($1::text[])',[codes])).rows;
 const advancedSequences:any[]=[];
 for(const table of Object.keys(counts)){
 const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND (is_identity='YES' OR column_default LIKE 'nextval(%')",[table])).rows;
 for(const col of columns){const sequence=(await client.query('SELECT pg_get_serial_sequence($1,$2) AS name',[table,col.column_name])).rows[0].name;if(!sequence)continue;const maximum=(await client.query(`SELECT max("${col.column_name}")::text AS value FROM "${table}"`)).rows[0].value;if(!maximum)continue;const parts=sequence.replaceAll('"','').split('.'),current=(await client.query('SELECT last_value::text AS value FROM pg_sequences WHERE schemaname=$1 AND sequencename=$2',[parts[0]??'public',parts[1]??parts[0]])).rows[0]?.value??'0';const value=BigInt(current)>BigInt(maximum)?current:maximum;await client.query('SELECT setval($1::regclass,$2::bigint,true)',[sequence,value]);advancedSequences.push({sequence,before:current,after:value})}
 }
 const documentCounters:any[]=[];
 for(const entry of pack.rows.filter((r:any)=>r.table==='document_reference_roots')){
 const match=/^CPZ-([A-Z]+)-(\d{2})-(\d+)-/.exec(entry.row.reference);if(!match)continue;
 const type=match[1],year=2000+Number(match[2]),minimum=Number(match[3]);const prior=(await client.query('SELECT last_value FROM document_sequences WHERE document_type=$1 AND calendar_year=$2',[type,year])).rows[0]?.last_value??0;
 if(prior<minimum){await client.query('INSERT INTO document_sequences(document_type,calendar_year,last_value) VALUES($1,$2,$3) ON CONFLICT(document_type,calendar_year) DO UPDATE SET last_value=greatest(document_sequences.last_value,excluded.last_value)',[type,year,minimum]);documentCounters.push({type,year,before:prior,after:minimum})}
 }
 const result={success:true,productionApplied:true,sourceMetadata:payload.sourceMetadata,counts,approvedMasterChanges,advancedSequences,documentCounters,changedProtectedTables:changed,overwrittenOriginalRows,verifiedIpos,verifiedFiles,replacements:replacements.map((r:any)=>({id:r.id,siteId:r.site_id,siteCode:r.site_code,stage:r.stage})),actorProvenance:provenance,conflicts};await db.pool.query('INSERT INTO local_workflow_import_receipts(source_sha256,source_metadata,original_workflows,imported_keys,identity_mapping,verification,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[sourceSha,payload.sourceMetadata,JSON.stringify(old),JSON.stringify(pack.rows.map((r:any)=>({table:r.table,key:r.key}))),JSON.stringify({actors:provenance,maps:Object.fromEntries([...maps].map(([k,v])=>[k,Object.fromEntries(v)]))}),JSON.stringify(result),executedBy]);
 return result;
 });
}
export function decodeImportPayload(raw:Buffer,expected:string){if(createHash('sha256').update(raw).digest('hex')!==expected)throw Error('Payload hash mismatch');
 const packed=JSON.parse(raw.toString('utf8')),hydrate=(v:any):any=>{if(v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$localPayloadText==='string'){const text=packed.textValues[v.$localPayloadText];if(typeof text!=='string'||createHash('sha256').update(text).digest('hex')!==v.$localPayloadText)throw Error('Payload text hash mismatch');return text}if(Array.isArray(v))return v.map(hydrate);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,hydrate(x)]));return v};
 return hydrate(packed.payload);
}
// Compressed payload arrives over the owner's authenticated service shell, never from a public URL.
if(process.argv[1]?.endsWith('/import-local-workflow.js')){
 const expected=process.argv[2];if(!/^[0-9a-f]{64}$/.test(expected??''))throw Error('Expected payload SHA256 required');
 const chunks:Buffer[]=[];for await(const chunk of process.stdin){chunks.push(Buffer.from(chunk));if(chunks.reduce((n,b)=>n+b.length,0)>64*1024*1024)throw Error('Import too large')}
 const raw=gunzipSync(Buffer.from(Buffer.concat(chunks).toString('utf8').trim(),'base64'),{maxOutputLength:128*1024*1024});
 if(createHash('sha256').update(raw).digest('hex')!==expected)throw Error('Payload hash mismatch');
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});try{const result=await importLocalWorkflow(pool,decodeImportPayload(raw,expected),expected);console.log(JSON.stringify(result))}finally{await pool.end()}
}
