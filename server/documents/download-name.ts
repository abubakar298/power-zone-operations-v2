import{createHash}from'node:crypto';
import type{Pool,PoolClient}from'pg';
import{downloadName,type DownloadName}from'../../shared/download-name.js';
export async function registeredDownloadName(pool:Pool|PoolClient,input:DownloadName){
 let reference=(await pool.query('SELECT reference FROM download_reference_aliases WHERE document_key=$1',[input.identity])).rows[0]?.reference;
 if(!reference){
  for(let attempt=0;attempt<20;attempt++){
   const official=input.reference&&/^(CHP[- ]?\d{1,10}|INV[- ]?\d{1,10}|DO[- ]?\d{1,10})$/i.test(input.reference)?input.reference.replace(/ /g,'-'):undefined;
   const candidate=attempt===0&&official?official:input.documentType.replace(/[^a-z]/gi,'').slice(0,1).toUpperCase()+createHash('sha256').update(`${input.identity}:${attempt}`).digest('hex').slice(0,8).toUpperCase();
   try{await pool.query('INSERT INTO download_reference_aliases(document_key,reference) VALUES($1,$2) ON CONFLICT DO NOTHING',[input.identity,candidate]);reference=(await pool.query('SELECT reference FROM download_reference_aliases WHERE document_key=$1',[input.identity])).rows[0]?.reference;if(reference)break;}
   catch(e){if((e as any).code!=='23505')throw e;}
  }
  if(!reference)throw Error('Unable to allocate a stable download reference.');
 }
 return downloadName({...input,reference});
}
