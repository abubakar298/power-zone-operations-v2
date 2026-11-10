import type {Pool,PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {qcMaterialHandoff} from '../accounts/qc-material-handoff.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {historicalQcIssues} from './historical-qc-issues.js';
import {requireQcMaterialSite} from './qc-material-access.js';
import type {ReportEntry} from './reconciliation.js';

type Input={version:number;requestKey:string;reason:string;verify:boolean;entry:ReportEntry};

export class LinkedHistoricalQcUsage {
  constructor(private pool:Pool){}

  private async context(actor:string,boardId:string,db:Pool|PoolClient,write=false){
    const board=await requireQcMaterialSite(actor,boardId,db,write);
    const source=historicalQcIssues(boardId,board.ipo??'');
    const handoff=source&&await qcMaterialHandoff(db,'site:'+boardId);
    if(!source||!handoff?.historicalIssueEvidence||handoff.holds.includes('Multiple Operations site links need review'))
      throw new HttpError(409,'Review this site’s exact historical issue and approved IPO link before recording usage.');
    const record=(await db.query('SELECT version,job_key,snapshot FROM inventory_historical_qc_issue_usage WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[boardId])).rows[0];
    if(record&&record.job_key!==handoff.jobKey)throw new HttpError(409,'The approved job link changed. Review the previous usage before continuing.');
    if(write)await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['closure:'+handoff.jobKey]);
    const locked=(await db.query(`SELECT 1 FROM (
      SELECT DISTINCT ON(job_key) stage FROM accounts_active_job_closures
      WHERE job_key=ANY($1::text[]) ORDER BY job_key,version DESC
    ) latest WHERE stage IN ('Closed','Awaiting Management')`,[[handoff.jobKey,...handoff.aliases]])).rowCount!>0;
    return {source,handoff,record,locked,evidence:handoff.historicalIssueEvidence};
  }

  async read(actor:string,boardId:string){
    const {source,handoff,record,locked,evidence}=await this.context(actor,boardId,this.pool);
    const saved=record?.snapshot;
    const entry:ReportEntry|null=saved?.issueSignature===source.signature?{
      start:'',end:'',panelCount:'',panelWattage:'',expectedReturns:'',receivedReturns:'',extra:[],
      usage:saved.usage,remarks:saved.remarks,
    }:null;
    return {
      boardId,jobKey:handoff.jobKey,ipo:handoff.ipo,version:record?.version??0,locked,entry,
      linkedIssues:true,linkReview:source.review,issued:source.lines,lines:source.lines,
      needsSignedDo:!evidence.signedDoIds.length||evidence.unsignedDeliveries>0,
      needsVso:source.lines.some(line=>line.variable)&&!evidence.vsoId&&!evidence.noVariableItemsUsed,
      stockPosting:false,
    };
  }

  async save(actor:string,boardId:string,input:Input){
    return transaction(this.pool,async db=>{
      await lockActiveActor(db,actor);
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['qc-issue:'+boardId]);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory.historical.qc.usage.request.'||$1,0))",[input.requestKey]);
      const {source,handoff,record,locked,evidence}=await this.context(actor,boardId,db,true);
      const fingerprint=createHash('sha256').update(JSON.stringify({boardId,input})).digest('hex');
      const replay=(await db.query('SELECT site_id,version,request_fingerprint,created_by FROM inventory_historical_qc_issue_usage WHERE request_key=$1',[input.requestKey])).rows[0];
      if(replay){
        if(replay.site_id!==boardId||replay.created_by!==actor||replay.request_fingerprint!==fingerprint)
          throw new HttpError(409,'This request key belongs to another usage entry.');
        return {version:replay.version,stockPosting:false};
      }
      if(locked)throw new HttpError(409,'This job has already been submitted or closed.');
      if((record?.version??0)!==input.version)throw new HttpError(409,'Material usage changed. Refresh before saving.');

      if(input.entry.extra.length)throw new HttpError(422,'Record local purchases separately from historical warehouse issues.');
      const usage=input.entry.usage;
      if(Object.keys(usage).some(key=>!source.lines.some(line=>line.key===key)))
        throw new HttpError(422,'Actual usage must refer to the linked historical DO rows.');
      for(const line of source.lines){
        const used=usage[line.key];
        if(input.verify&&(used===undefined||used===''))
          throw new HttpError(422,'Enter the actual quantity for every linked row, including explicit zero.');
        if(used&&new Decimal(used).gt(line.issued))
          throw new HttpError(422,'Actual usage exceeds the linked issue quantity for '+line.itemId+'.');
        if(input.verify&&line.variable&&evidence.noVariableItemsUsed&&used&&new Decimal(used).gt(0))
          throw new HttpError(422,'Job Completion declares no variable items used. Correct that declaration before verifying.');
      }
      if(input.verify){
        if(source.review)throw new HttpError(409,source.review);
        if(!evidence.signedDoIds.length||evidence.unsignedDeliveries)
          throw new HttpError(422,'Attach the site’s signed delivery DO before verifying usage.');
        if(source.lines.some(line=>line.variable)&&!evidence.vsoId&&!evidence.noVariableItemsUsed)
          throw new HttpError(422,'Attach a distinct signed VSO or record that no variable items were used.');
      }
      const version=input.version+1;
      const snapshot={
        usage,remarks:input.entry.remarks,reason:input.reason,state:input.verify?'signed':'reported',
        evidence:JSON.stringify(evidence),issueSignature:source.signature,stockPosting:false,
      };
      await db.query(`INSERT INTO inventory_historical_qc_issue_usage
        (site_id,job_key,version,snapshot,request_key,request_fingerprint,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[boardId,handoff.jobKey,version,snapshot,input.requestKey,fingerprint,actor]);
      await db.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'qc.linked-historical-usage:'+boardId+':'+version]);
      return {version,stockPosting:false};
    });
  }
}
