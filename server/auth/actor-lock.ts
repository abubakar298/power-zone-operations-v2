import type {PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';

/** Acquire first in an employee write transaction, before document/business locks.
 * Role/profile changes update this users row and must wait for the write to finish.
 * A connection-pool/autocommit read cannot provide this guarantee. */
export async function lockActiveActor(c:PoolClient,actor:string){
 const row=(await c.query<{id:string;active:boolean;role:string}>('SELECT id,active,role FROM users WHERE id=$1 FOR SHARE',[actor])).rows[0];
 if(!row?.active)throw new HttpError(401,'Your access has ended.');
 return row;
}
