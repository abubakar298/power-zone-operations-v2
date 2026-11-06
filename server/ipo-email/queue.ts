import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {ipoIdentity,operationsEmailIdentity,changedStageEvidence,stageFingerprint,type EmailIdentity,type StageEvidence} from './model.js';

/** Called only inside the authenticated business transaction after evidence is bound.
 * Disabled means no historical backlog is accumulated for later activation. */
export async function queueIpoEmail(c:PoolClient,actor:string,source:string,identity:EmailIdentity|null,evidence:StageEvidence){
 const enabled=(await c.query('SELECT enabled FROM ipo_document_email_settings WHERE singleton')).rows[0]?.enabled;
 if(!enabled)return;
 const id=randomUUID();
 await c.query(`INSERT INTO ipo_document_email_queue(id,source_key,identity_key,stage,context,evidence,state,reason,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_key) DO NOTHING`,[
  id,source,identity?.key??`unresolved:${id}`,evidence.stage,JSON.stringify({...identity,detail:evidence.detail}),JSON.stringify(evidence.files),identity?'queued':'held',identity?null:'Exact IPO and order identity needs review',actor,
 ]);
}
export async function queueOperationsEmails(c:PoolClient,actor:string,previous:any,next:any){
 for(const evidence of changedStageEvidence(previous,next))await queueIpoEmail(c,actor,`operations:${next.id}:${stageFingerprint(evidence)}`,operationsEmailIdentity(next),evidence);
}
export function orderEmailIdentity(number:string,snapshot:any){return ipoIdentity(number,snapshot.input?.orderNumber,snapshot.siteName,snapshot.customer?.name);}
export async function queueIssuedPo(c:PoolClient,actor:string,ipo:{id:string;number:string;snapshot:any},evidenceId?:string,workflowReceiptId?:string){
 if(ipo.snapshot.historicalImport)return;
 await queueIpoEmail(c,actor,`ipo:${ipo.id}:po`,orderEmailIdentity(ipo.number,ipo.snapshot),{
  stage:1,files:workflowReceiptId?[{kind:'workflow-po',id:workflowReceiptId}]:evidenceId?[{kind:'po',id:evidenceId}]:[],
  detail:[ipo.snapshot.input?.evidenceType,ipo.snapshot.input?.poNumber,ipo.snapshot.input?.approvalReference,ipo.snapshot.input?.evidenceNotes].filter(Boolean).join(' · '),
 });
}
export async function queueSharedIpo(c:PoolClient,actor:string,ipo:{id:string;number:string;snapshot:any}){
 if(ipo.snapshot.historicalImport)return;
 await queueIpoEmail(c,actor,`ipo:${ipo.id}:shared`,orderEmailIdentity(ipo.number,ipo.snapshot),{stage:2,files:[{kind:'ipo',id:ipo.id}],detail:'Approved IPO shared with Accounts'});
}
