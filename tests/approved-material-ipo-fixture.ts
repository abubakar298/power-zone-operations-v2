import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {OrdersRepository} from '../server/orders/repository.js';
import {orderSchema} from '../server/orders/schema.js';
/** Fictional approved Customer PO, rather than training-only verbal confirmation. */
export async function approvedMaterialIpo(pool:Pool,coordinator:string,manager:string,templateId:string){
 const template=(await pool.query('SELECT snapshot FROM internal_purchase_orders WHERE id=$1',[templateId])).rows[0].snapshot;
 const po='SIMULATION-MATERIAL-PO-'+randomUUID(),input=orderSchema.parse({...template.input,evidenceType:'Customer PO',poNumber:po,evidenceNotes:'Isolated approved-material fixture, not a real customer order.'});
 const repo=new OrdersRepository(pool),preview=await repo.preview(coordinator,input),submission=await repo.submit(coordinator,input,preview.fingerprint,randomUUID()),approved=await repo.approve(manager,submission.id,randomUUID());
 return {ipoId:approved.id};
}
/** Explicit fictional installation state, matching these tests' legacy scope setup. */
export async function materialInstallationFixture(pool:Pool,ipoId:string,actor:string){
 const id='live-ipo:'+ipoId,row=(await pool.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];
 if(row)await pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,row.version+1,{...row.snapshot,installation:true,scopePending:false,projectType:'solar-bess'},'SIMULATION installation scope','Explicit positive installation fixture; no real project, delivery or QC evidence.',randomUUID(),actor]);
}
export async function materialBoardFixture(pool:Pool,ipoId:string,actor:string,patch:Record<string,unknown>){
 const id='live-ipo:'+ipoId,row=(await pool.query('SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];
 if(row)await pool.query('INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,row.version+1,{...row.snapshot,...patch},'SIMULATION position fixture','Explicit test position matching the legacy fixture update; no actual business evidence.',randomUUID(),actor]);
}
