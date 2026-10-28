import type {Pool,PoolClient} from 'pg';
import {HttpError} from '../http/errors.js';
/** QC's site assignment authorises evidence only, never warehouse posting. */
export async function requireQcMaterialSite(actor:string,boardSiteId:string,c:Pool|PoolClient,write=false){
 const user=(await c.query('SELECT u.active,u.role,a.kind,a.team FROM users u LEFT JOIN operations_board_access a ON a.user_id=u.id WHERE u.id=$1',[actor])).rows[0];
 if(!user?.active)throw new HttpError(401,'Your access has ended.');
 const owner=['Admin','Management'].includes(user.role);
 if(!owner&&(user.role!=='Operations'||!(write?['qc','head']:['qc','head','lead']).includes(user.kind)))throw new HttpError(403,'Only the assigned QC team can record site material evidence.');
 await c.query('SELECT id FROM operations_board_sites WHERE id=$1 FOR SHARE',[boardSiteId]);
 const board=(await c.query('SELECT snapshot FROM operations_board_versions WHERE site_id=$1 ORDER BY version DESC LIMIT 1',[boardSiteId])).rows[0]?.snapshot;
 if(!board||!owner&&user.kind!=='head'&&board.operationsTeam!==user.team)throw new HttpError(404,'Site not found in your assigned team.');
 if(board.installation!==true)throw new HttpError(422,'Installation scope must be confirmed before recording material usage.');return board;
}
