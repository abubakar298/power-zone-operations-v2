import {isArchivedLegacySolar,legacySolarArchiveReason} from '../../shared/legacy-solar-archive.js';
import type {Pool} from 'pg';
type Row=Record<string,any>;
export async function latestOperationsStages(pool:Pool){
 return (await pool.query(`SELECT DISTINCT ON(site_id) site_id,version,created_at,
 jsonb_build_object('sourceKey',snapshot->'sourceKey','stage',snapshot->'stage','completed',snapshot->'completed','partial',snapshot->'partial','deliveryDate',snapshot->'deliveryDate','completionDate',snapshot->'completionDate','cancelled',snapshot->'cancelled','transferred',snapshot->'transferred') AS snapshot
 FROM operations_board_versions ORDER BY site_id,version DESC`)).rows;
}
/** Read projection only: never overwrite imported history or current Operations facts. */
export function applyOperationsStages(rows:Row[],operations:Row[]){
 return rows.map(row=>{
  const canonical=operations.filter(o=>o.site_id==='registered-'+row.key),matches=canonical.length?canonical:operations.filter(o=>o.snapshot.sourceKey===row.key);
  if(matches.length!==1||row.cancelled||row.transferred)return row;
  const op=matches[0],s=op.snapshot;if(!['received','awaiting','delivered','completed'].includes(s.stage))return row;const installed=s.completed===true||s.stage==='completed',delivered=installed||s.stage==='delivered',partial=s.partial===true;
  return {...row,delivered,installed,partialDelivery:partial,deliveryDate:delivered||partial?s.deliveryDate??row.deliveryDate:null,installationDate:installed?s.completionDate??row.installationDate:null,operationsVersion:op.version,operationsUpdatedAt:op.created_at,stageBasis:'Current Operations record'};
 });
}
export function projectAccountsSites(snapshot:Row,operations:Row[]){
 const sourceRows=(snapshot.registers??[]).flatMap((r:Row)=>r.rows??[]),fields=['advance','completion','invoiceReferences','singleInvoiceSubmitted','singlePaymentReceived','invoiceStatus','paymentStatus'];
 const financial=(snapshot.sites.rows??[]).map((row:Row)=>{const matches=sourceRows.filter((r:Row)=>r.key===row.key);if(matches.length!==1)return row;const next={...row};for(const field of fields)if(Object.hasOwn(matches[0],field))next[field]=matches[0][field];return next;});
 const rows=applyOperationsStages(financial,operations).map((row:Row)=>({...row,...(isArchivedLegacySolar(row)?{archived:true,archiveReason:legacySolarArchiveReason}:{}),position:isArchivedLegacySolar(row)||row.cancelled||row.transferred?'history':row.installed?'completed':row.partialDelivery?'partial':row.delivered?'delivered':typeof row.installed!=='boolean'&&typeof row.delivered!=='boolean'?row.position??'awaiting':'awaiting'}));
 const active=rows.filter((r:Row)=>r.position!=='history');return {...snapshot.sites,rows,counts:{...snapshot.sites.counts,active:active.length,history:rows.length-active.length,archived:rows.filter((r:Row)=>r.archived).length,awaiting:active.filter((r:Row)=>r.position==='awaiting').length,delivered:active.filter((r:Row)=>r.position==='delivered').length,completed:active.filter((r:Row)=>r.position==='completed').length,partial:active.filter((r:Row)=>r.position==='partial').length},stageBasis:'Current Operations records; financial status from latest reviewed Accounts source'};
}
