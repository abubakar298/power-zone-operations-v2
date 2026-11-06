import type {Pool,PoolClient} from 'pg';
import type {EmailDelivery,EmailAttachment} from '../email/delivery.js';
import {buildIpoPdf} from '../orders/document-renderers.js';
import {isArchivedLegacySolar} from '../../shared/legacy-solar-archive.js';
import {ipoEmailTo,ipoEmailCc,ipoEmailStages,references,rfcMessageIds,operationsEmailIdentity,operationsStageEvidence,stageFingerprint,type Evidence} from './model.js';

const MAX_RAW_BYTES=27*1024*1024;
class Hold extends Error{}
class Superseded extends Hold{}
type Manifest={ref:Evidence;filename:string;size:number};
export function attachmentParts<T extends {size:number}>(files:T[],limit=MAX_RAW_BYTES):T[][]{
 const parts:T[][]=[[]];let size=0;
 for(const f of files){
  if(f.size>limit||f.size<1)throw new Hold('An attachment needs review before emailing');
  if(size+f.size>limit){parts.push([]);size=0;}
  parts.at(-1)!.push(f);size+=f.size;
 }
 return parts;
}
export function replyHeaders(thread:{last_message_id?:string;reference_ids?:string[]}){
 const last=rfcMessageIds(thread.last_message_id)[0];
 return last?{'In-Reply-To':last,References:references(thread.reference_ids??[],last).join(' ')}:undefined;
}
async function source(c:PoolClient,ref:Evidence,bytes=false){
 const content=bytes?',content':'';
 if(ref.kind==='operations')return (await c.query(`SELECT filename,octet_length(content) AS size${content} FROM operations_board_files WHERE id=$1 AND site_id=$2`,[ref.id,ref.siteId])).rows[0];
 if(ref.kind==='po')return (await c.query(`SELECT filename,octet_length(content) AS size${content} FROM customer_po_documents WHERE id=$1`,[ref.id])).rows[0];
 if(ref.kind==='workflow-po')return (await c.query(`SELECT f.filename,octet_length(f.content) AS size${bytes?',f.content':''} FROM project_po_receipts r JOIN project_workflow_files f ON f.id::text=r.input->>'evidenceId' AND f.record_id=r.record_id WHERE r.id=$1`,[ref.id])).rows[0];
 const row=(await c.query('SELECT number,snapshot FROM internal_purchase_orders WHERE id=$1',[ref.id])).rows[0];
 if(!row||row.snapshot.historicalImport)throw new Hold('Approved IPO source needs review');
 // PT/costing pages are internal: do not attach them to the recovery thread.
 const pdf=buildIpoPdf(row.snapshot,row.number,null,{includePt:false});
 return {filename:row.number.replace(/[^a-zA-Z0-9_-]/g,'-')+'.pdf',size:pdf.length,...(bytes?{content:pdf}:{})};
}
async function threadFor(c:PoolClient,job:any){
 const current=(await c.query('SELECT * FROM ipo_document_email_threads WHERE identity_key=$1',[job.identity_key])).rows[0];
 if(current)return current;
 const candidates=(await c.query('SELECT * FROM ipo_mailbox_thread_index WHERE identity_key=$1',[job.identity_key])).rows;
 const allowed=candidates.filter(r=>['unique_thread','confirmed_current'].includes(r.routing_decision));
 if(allowed.length>1||candidates.length&&!allowed.length)throw new Hold('Existing email thread mapping needs review');
 if(!job.context.order&&(await c.query("SELECT 1 FROM ipo_mailbox_thread_index WHERE ipo=$1 AND order_number<>'' LIMIT 1",[job.context.ipo])).rowCount)throw new Hold('Shared IPO requires its exact programme order number');
 const found=allowed[0],ids=found?references(found.reference_ids,found.message_id):[];
 await c.query(`INSERT INTO ipo_document_email_threads(identity_key,subject,root_message_id,last_message_id,reference_ids,gmail_thread_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[job.identity_key,found?.subject??job.context.subject,ids[0]??null,found?.message_id??null,JSON.stringify(ids),found?.gmail_thread_id??null]);
 return (await c.query('SELECT * FROM ipo_document_email_threads WHERE identity_key=$1',[job.identity_key])).rows[0];
}
/** One indexed job per sweep, globally serialised across app instances. Only immutable
 * file references are queued, not copies of binary attachments or fresh calculations. */
export class IpoEmailWorker {
 constructor(private pool:Pool){}
 async deliverOne(delivery:EmailDelivery){
  if(!delivery.configured||!delivery.getMessageId)return;
  const c=await this.pool.connect();let locked=false,job:any;
  try{
   locked=(await c.query("SELECT pg_try_advisory_lock(hashtext('ipo-document-email-worker')) AS locked")).rows[0].locked;
   if(!locked||!(await c.query('SELECT enabled FROM ipo_document_email_settings WHERE singleton')).rows[0]?.enabled)return;
   job=(await c.query(`SELECT q.* FROM ipo_document_email_queue q WHERE state='queued' AND next_attempt_at<=now()
    AND NOT EXISTS(SELECT 1 FROM ipo_document_email_queue earlier WHERE earlier.identity_key=q.identity_key AND earlier.state NOT IN('sent','superseded') AND (earlier.created_at,earlier.stage,earlier.id)<(q.created_at,q.stage,q.id))
    ORDER BY created_at,stage,id LIMIT 1`)).rows[0];
   if(!job)return;
   if(!job.context.ipo||!job.context.subject)throw new Hold('Exact IPO identity needs review');
   const thread=await threadFor(c,job);
   let parts=(await c.query('SELECT * FROM ipo_document_email_parts WHERE queue_id=$1 ORDER BY part',[job.id])).rows;
   if(!parts.length){
    const manifest:Manifest[]=[];
    for(const ref of job.evidence as Evidence[]){
     const file=await source(c,ref);
     // A written approval without its original upload must never silently become text-only.
     if(!file)throw new Hold('A linked evidence attachment is not available');
     manifest.push({ref,filename:file.filename,size:Number(file.size)});
    }
    const groups=attachmentParts(manifest);
    await c.query('BEGIN');
    try{
     for(const [part,files] of groups.entries())await c.query('INSERT INTO ipo_document_email_parts(queue_id,part,evidence) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[job.id,part+1,JSON.stringify(files.map(f=>f.ref))]);
     await c.query('COMMIT');
    }catch(error){await c.query('ROLLBACK');throw error;}
    parts=(await c.query('SELECT * FROM ipo_document_email_parts WHERE queue_id=$1 ORDER BY part',[job.id])).rows;
   }
   const part=parts.find(p=>!p.message_id);
   if(!part){await c.query("UPDATE ipo_document_email_queue SET state='sent',sent_at=now(),reason=NULL WHERE id=$1",[job.id]);return;}
   if(!part.provider_id){
    for(const siteId of new Set<string>((job.evidence as Evidence[]).filter(f=>f.kind==='operations').map(f=>f.siteId!))){
     const row=(await c.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[siteId])).rows[0];
     const site=row?.snapshot;
     if(!site||site.superseded||site.cancelled||site.transferred||isArchivedLegacySolar({...site,id:siteId}))throw new Hold('The site status needs review before emailing');
     if(operationsEmailIdentity({...site,id:siteId})?.key!==job.identity_key)throw new Hold('The current site IPO identity differs from this email');
     const fingerprint=stageFingerprint({stage:job.stage,files:job.evidence,detail:job.context.detail});
     if(!operationsStageEvidence({...site,id:siteId}).some(e=>stageFingerprint(e)===fingerprint))throw new Superseded('Evidence was replaced before email delivery');
    }
    const attachments:EmailAttachment[]=[];
    for(const ref of part.evidence){const file=await source(c,ref,true);if(!file?.content)throw new Hold('A linked evidence attachment is not available');attachments.push({filename:file.filename.replace(/[\r\n\0]/g,' '),content:file.content.toString('base64')});}
    const text=[`Subject: ${ipoEmailStages[job.stage-1]}.`,`${job.context.customer??''}${job.context.site?' · '+job.context.site:''}`,`IPO: ${job.context.ipo}${job.context.order?' · Order '+job.context.order:''}`,job.context.detail,parts.length>1?`Attachments ${part.part} of ${parts.length}`:'','Shared automatically from the saved site documents.','Rafiq · Power Zone Systems'].filter(Boolean).join('\n\n');
    const provider=await delivery.send({to:ipoEmailTo,cc:ipoEmailCc,subject:thread.subject,text,headers:replyHeaders(thread),...(attachments.length?{attachments}:{})},`ipo-document:${job.id}:${part.part}`);
    // Save acceptance before resolving the RFC Message-ID. A lookup failure must never resend.
    await c.query('UPDATE ipo_document_email_parts SET provider_id=$3,sent_at=now() WHERE queue_id=$1 AND part=$2',[job.id,part.part,provider]);part.provider_id=provider;
   }
   const messageId=await delivery.getMessageId(part.provider_id);
   if(!messageId){await c.query("UPDATE ipo_document_email_queue SET next_attempt_at=now()+interval '1 minute',reason='Awaiting provider reply reference' WHERE id=$1",[job.id]);return;}
   // These writes are atomic: never allow a later part/job to reply using an older root.
   await c.query('BEGIN');
   try{
    await c.query('UPDATE ipo_document_email_parts SET message_id=$3 WHERE queue_id=$1 AND part=$2',[job.id,part.part,messageId]);
    await c.query('UPDATE ipo_document_email_threads SET root_message_id=COALESCE(root_message_id,$2),last_message_id=$2,reference_ids=$3,updated_at=now() WHERE identity_key=$1',[job.identity_key,messageId,JSON.stringify(references(thread.reference_ids,messageId))]);
    const finished=parts.every(p=>p.part===part.part||p.message_id);
    await c.query(`UPDATE ipo_document_email_queue SET state=$2,message_id=$3,provider_id=$4,sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END,attempts=0,reason=NULL,next_attempt_at=now() WHERE id=$1`,[job.id,finished?'sent':'queued',messageId,part.provider_id]);
    await c.query('COMMIT');
   }catch(error){await c.query('ROLLBACK');throw error;}
  }catch(error){
   if(!job)throw error;
   // No provider response bodies, email addresses or document content in logs/reasons.
   const hold=error instanceof Hold;
   await c.query(`UPDATE ipo_document_email_queue SET state=CASE WHEN $4 THEN 'superseded' WHEN $2 THEN 'held' WHEN attempts>=4 THEN 'failed' ELSE 'queued' END,reason=$3,attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,[job.id,hold,hold?(error as Error).message:'Email delivery or reference lookup interrupted',error instanceof Superseded]);
  }finally{if(locked)await c.query("SELECT pg_advisory_unlock(hashtext('ipo-document-email-worker'))").catch(()=>{});c.release();}
 }
}
