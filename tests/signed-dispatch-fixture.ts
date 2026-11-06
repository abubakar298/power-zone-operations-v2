import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {MaterialStockRepository} from '../server/inventory/material-stock.js';
import {GatePassRepository} from '../server/inventory/gate-passes.js';
export async function signDispatch(pool:Pool,actor:string,kind:'dispatch'|'transfer-out'|'replacement-out'|'replacement-in',id:string,warehouse='Lahore warehouse'){
 const evidence=await new MaterialStockRepository(pool).uploadEvidence(actor,{warehouse,filename:'FICTIONAL-signed-gate-'+id+'.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.7 FICTIONAL SIGNED GATE '+id).toString('base64')});
 return new GatePassRepository(pool).attach(actor,{kind,documentId:id,copyKind:kind==='replacement-in'?'signed-store':'signed-gate',evidenceId:evidence.id,note:'Fictional signed gate copy for isolated test',requestKey:randomUUID()});
}

export async function receiveSigned(pool:Pool,repo:any,actor:string,input:any){const r=await repo.receiveFaulty(actor,input);if(r.awaitingSignedIgp){const d=await repo.detail(actor,input.caseId);assert.equal(d.returns.find((v:any)=>v.id===r.id).heldQuantity,'0','Unsigned IGP does not record faulty stock IN.');}await signDispatch(pool,actor,'replacement-in',r.id,input.warehouse);return {...r,holdingRecorded:true,awaitingSignedIgp:false};}
