import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {EmailAttachment} from '../email/delivery.js';
import {buildQuotationPdf} from '../commercial/report.js';
import {buildCniPdf} from '../commercial/cni-report.js';
import {registeredDownloadName} from '../documents/download-name.js';

/** Resolve from the submission event, never from the latest mutable proposal pointer. */
export async function quotationApprovalAttachments(c:PoolClient,row:{id:string;event_source_key:string;event_kind:string;audience:string;role:string}):Promise<EmailAttachment[]> {
 if(row.audience!=='management'||!['Admin','Management'].includes(row.role)||!['Submitted','Approval requested'].includes(row.event_kind))return [];
 const match=/^(quote|cni):([0-9a-f-]{36})$/i.exec(row.event_source_key);
 if(!match)throw Error('Approval email source is unavailable');
 const cached=(await c.query('SELECT filename,content,sha256,source_key FROM notification_email_attachments WHERE notification_id=$1',[row.id])).rows[0];
 if(cached){
  if(cached.source_key!==row.event_source_key||createHash('sha256').update(cached.content).digest('hex')!==cached.sha256)throw Error('Approval attachment verification failed');
  return [{filename:cached.filename,content:cached.content.toString('base64')}];
 }
 const isCni=match[1]==='cni';
 const document=(await c.query(isCni?
  "SELECT v.id,v.number,v.version,v.snapshot FROM cni_proposal_actions e JOIN cni_proposal_versions v ON v.id=e.version_id WHERE e.id=$1 AND e.action='Approval requested'":
  "SELECT q.id,q.number,q.version,q.snapshot FROM coordination_events e JOIN quotation_versions q ON q.id=e.quotation_id WHERE e.id=$1 AND e.kind='Submitted'",[match[2]])).rows[0];
 if(!document)throw Error('Submitted quotation is unavailable');
 const s=document.snapshot;
 const pdf=isCni?buildCniPdf(s,document.number,true):buildQuotationPdf(s,document.number);
 if(pdf.subarray(0,5).toString()!=='%PDF-'||pdf.length>25*1024*1024)throw Error('Approval PDF cannot be attached');
 const filename=await registeredDownloadName(c,{customer:s.customer?.shortCode??s.customer?.short_code??s.customer?.name,site:s.siteName,siteCode:s.siteCode,documentType:isCni?'Quotation DRAFT':'Quotation',identity:`${isCni?'cni_proposal_versions':'quotation_versions'}:${document.id}`,reference:document.number,revision:document.version,extension:'pdf'});
 await c.query("INSERT INTO notification_email_attachments(notification_id,source_key,filename,mime,sha256,content) VALUES($1,$2,$3,'application/pdf',$4,$5)",[row.id,row.event_source_key,filename,createHash('sha256').update(pdf).digest('hex'),pdf]);
 return [{filename,content:pdf.toString('base64')}];
}
