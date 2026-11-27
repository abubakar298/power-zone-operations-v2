import type {Pool,PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {lockActiveActor} from '../auth/actor-lock.js';
import {transaction} from '../db/transaction.js';
import {HttpError} from '../http/errors.js';
import {historicalIssueReviews} from './historical-qc-issues.js';

/** Owner rule (27 Nov 2026): a review note on an old DO holds QC verification until the
 * Inventory head confirms it, with a reason. The confirmation covers the exact note text. */
export const historicalReviewHash=(review:string)=>createHash('sha256').update(review).digest('hex');
export const historicalReviewConfirmationSchema=z.object({
  requestKey:z.uuid(),
  reviewHash:z.string().regex(/^[a-f0-9]{64}$/),
  reason:z.string().trim().min(3).max(2000),
}).strict();

const key=(siteId:string,hash:string)=>siteId+'\0'+hash;

/** Confirmed notes as site + note-hash keys; check with `reviewStillOpen`. */
export async function confirmedHistoricalReviews(db:Pool|PoolClient,siteIds?:string[]){
  const rows=(siteIds
    ?await db.query('SELECT site_id,review_hash FROM inventory_historical_review_confirmations WHERE site_id=ANY($1::text[])',[siteIds])
    :await db.query('SELECT site_id,review_hash FROM inventory_historical_review_confirmations')).rows;
  return new Set(rows.map(r=>key(r.site_id,r.review_hash)));
}
export function reviewStillOpen(confirmed:Set<string>,siteId:string,review:string|undefined){
  return review&&!confirmed.has(key(siteId,historicalReviewHash(review)))?review:undefined;
}

/** The head is an active Inventory user holding the 'head' grant for any warehouse. */
async function inventoryHeadAnywhere(actor:string,db:Pool|PoolClient){
  return !!(await db.query("SELECT 1 FROM users u JOIN inventory_material_access a ON a.user_id=u.id AND a.capability='head' WHERE u.id=$1 AND u.active AND u.role='Inventory'",[actor])).rowCount;
}

export class HistoricalReviewConfirmations{
  constructor(private pool:Pool){}

  async list(actor:string){
    if(!await inventoryHeadAnywhere(actor,this.pool))return {canConfirm:false,reviews:[]};
    const holds=historicalIssueReviews();
    const ids=holds.map(h=>h.boardId);
    const [boards,confirmed]=await Promise.all([
      this.pool.query(`SELECT DISTINCT ON(site_id) site_id,snapshot->>'name' AS name,snapshot->>'customer' AS customer,
        (snapshot->>'cancelled')='true' AS cancelled FROM operations_board_versions WHERE site_id=ANY($1::text[]) ORDER BY site_id,version DESC`,[ids]),
      confirmedHistoricalReviews(this.pool,ids),
    ]);
    const byId=new Map(boards.rows.map(r=>[r.site_id,r]));
    const reviews=holds.flatMap(h=>{
      const board=byId.get(h.boardId);
      if(!board||board.cancelled||!reviewStillOpen(confirmed,h.boardId,h.review))return [];
      return [{siteId:h.boardId,siteName:board.name??'',customer:board.customer??'',ipo:h.ipo,reference:h.reference,review:h.review,reviewHash:historicalReviewHash(h.review)}];
    });
    return {canConfirm:true,reviews};
  }

  async confirm(actor:string,siteId:string,input:z.infer<typeof historicalReviewConfirmationSchema>){
    return transaction(this.pool,async db=>{
      await lockActiveActor(db,actor);
      if(!await inventoryHeadAnywhere(actor,db))throw new HttpError(403,'Only the Inventory head can confirm an old DO review note.');
      const replay=(await db.query('SELECT site_id,review_hash,confirmed_by FROM inventory_historical_review_confirmations WHERE request_key=$1',[input.requestKey])).rows[0];
      if(replay){
        if(replay.site_id!==siteId||replay.review_hash!==input.reviewHash||replay.confirmed_by!==actor)throw new HttpError(409,'This request key belongs to another confirmation.');
        return {confirmed:true};
      }
      const hold=historicalIssueReviews().find(h=>h.boardId===siteId);
      if(!hold||historicalReviewHash(hold.review)!==input.reviewHash)throw new HttpError(409,'This review note changed. Refresh before confirming.');
      const inserted=await db.query(`INSERT INTO inventory_historical_review_confirmations(site_id,review_hash,review,reason,request_key,confirmed_by)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(site_id,review_hash) DO NOTHING`,[siteId,input.reviewHash,hold.review,input.reason,input.requestKey,actor]);
      if(!inserted.rowCount)throw new HttpError(409,'This review note is already confirmed.');
      await db.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,'inventory.historical-review.confirmed:'+siteId]);
      return {confirmed:true};
    });
  }
}
