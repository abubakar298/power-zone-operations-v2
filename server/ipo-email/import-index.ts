import type {Pool} from 'pg';
import {transaction} from '../db/transaction.js';
import {ipoIdentity,rfcMessageIds,references} from './model.js';

type IndexThread={threadId:string;identityKey:string;subject:string;routingDecision:string;replyAnchor:{messageId:string;references:string};notes?:unknown[]};
export type ThreadIndex={schemaVersion:number;summary:{sourceSHA256:string};threads:IndexThread[]};
/** Private operator import, not a public endpoint or seed committed to source control.
 * The audit supplies evidence-backed canonical decisions; excluded history is retained. */
export async function importThreadIndex(pool:Pool,actor:string,index:ThreadIndex,enable=false){
 if(index.schemaVersion!==2||!index.threads?.length||! /^[a-f0-9]{64}$/.test(index.summary?.sourceSHA256??''))throw new Error('Use the verified version-2 thread index');
 const allowed=new Set(['unique_thread','confirmed_current','duplicate_noncurrent','cancelled','superseded','duplicate_unresolved']);
 const ids=new Set<string>(),routes=new Set<string>();
 for(const row of index.threads){
  const [ipo,order]=row.identityKey.split('|');
  if(ipoIdentity(ipo,order)?.key!==row.identityKey||!allowed.has(row.routingDecision)||!row.threadId||ids.has(row.threadId)||!row.subject?.trim()||/[\r\n\0]/.test(row.subject)||rfcMessageIds(row.replyAnchor?.messageId).length!==1)throw new Error('Invalid or duplicate thread reference');
  if(['unique_thread','confirmed_current'].includes(row.routingDecision)){if(routes.has(row.identityKey))throw new Error('More than one current thread for an identity');routes.add(row.identityKey);}
  ids.add(row.threadId);
 }
 return transaction(pool,async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtext('ipo-document-email-worker'))");
  const user=(await c.query('SELECT active,role FROM users WHERE id=$1 FOR SHARE',[actor])).rows[0];
  if(!user?.active||!['Admin','Management'].includes(user.role))throw new Error('Active Management authorisation required');
  const setting=(await c.query('SELECT enabled FROM ipo_document_email_settings WHERE singleton FOR UPDATE')).rows[0];
  if(setting.enabled)throw new Error('Pause automatic document emails before replacing the mailbox index');
  // This is the complete checked mailbox snapshot, not a partial append.
  await c.query('DELETE FROM ipo_mailbox_thread_index');
  for(const row of index.threads){
   const [ipo,order]=row.identityKey.split('|');
   await c.query(`INSERT INTO ipo_mailbox_thread_index(gmail_thread_id,identity_key,ipo,order_number,subject,message_id,reference_ids,routing_decision,review_notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[row.threadId,row.identityKey,ipo,order,row.subject,row.replyAnchor.messageId,JSON.stringify(references(rfcMessageIds(row.replyAnchor.references),row.replyAnchor.messageId)),row.routingDecision,JSON.stringify(row.notes??[])]);
  }
  await c.query('UPDATE ipo_document_email_settings SET enabled=$1,mailbox_indexed_at=now(),activated_at=CASE WHEN $1 THEN now() ELSE activated_at END,updated_by=$2 WHERE singleton',[enable,actor]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`ipo.email.index:${index.summary.sourceSHA256}:threads:${ids.size}:enabled:${enable}`]);
  return {threads:ids.size,currentIdentities:routes.size,enabled:enable,historicalEmailsQueued:0};
 });
}
