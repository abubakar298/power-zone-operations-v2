import type {Pool,PoolClient} from 'pg';
import type {DownloadName} from '../../shared/download-name.js';
/** Download-name details of a file uploaded to an Operations-board site (signed DO, IRR, photos), wherever it is
 * downloaded (Operations board or Accounts site documents). User request, 23 Nov 2026: every file is named
 * "<document> - <customer> - <site name> - <site code>"; the site code comes from the linked IPO when there is one. */
export async function boardFileDownloadContext(pool:Pool|PoolClient,snapshot:any,fileId:string):Promise<DownloadName>{
 const received=snapshot.inventoryReceiving?.evidenceId===fileId?snapshot.inventoryReceiving:undefined;
 const label=(snapshot.documents??[]).find((d:any)=>(d.evidence??[]).some((f:any)=>f.id===fileId))?.label;
 const ipoId=snapshot.origin?.ipoId;
 const siteCode=typeof ipoId==='string'&&/^[0-9a-f-]{36}$/i.test(ipoId)?(await pool.query("SELECT snapshot->>'siteCode' AS code FROM internal_purchase_orders WHERE id=$1",[ipoId])).rows[0]?.code??undefined:undefined;
 return {
  documentType:received?'Signed DO':typeof label==='string'?label.replace(/\.(pdf|png|jpe?g|webp|heic|heif)$/i,''):'Site document',
  ...(received?.number?{reference:String(received.number)}:{}),
  identity:'operations_board_files:'+fileId,
  customer:typeof snapshot.customer==='string'?snapshot.customer:undefined,
  site:typeof snapshot.name==='string'?snapshot.name:undefined,
  siteCode,extension:'pdf',
 };
}
