import type {Pool} from 'pg';
import {HttpError} from '../http/errors.js';

/** Management reference import only: this endpoint cannot issue, reserve or post. */
export async function managementReceivedPos(pool:Pool,actor:string){
 const user=(await pool.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
 if(!user?.active||!['Admin','Management'].includes(user.role))throw new HttpError(403,'Received PO reporting requires Management access.');
 const batch=(await pool.query('SELECT batch_key,snapshot,imported_at FROM management_received_po_batches ORDER BY imported_at DESC,batch_key DESC LIMIT 1')).rows[0];
 return batch?{...batch.snapshot,batchKey:batch.batch_key,importedAt:batch.imported_at}:{rows:[],unallocatedAccounts:[],summary:{},sourceDate:null};
}
