import{createHash}from'node:crypto';
import type{Pool,PoolClient}from'pg';
import{downloadName,type DownloadName}from'../../shared/download-name.js';
/** File name for a download. A document with its own saved number is named by it; a file without one gets a
 * stable registered alias so its name never changes between downloads. */
export async function registeredDownloadName(pool:Pool|PoolClient,input:DownloadName){
 if(input.reference?.trim())return downloadName(input);
 let alias=(await pool.query('SELECT reference FROM download_reference_aliases WHERE document_key=$1',[input.identity])).rows[0]?.reference;
 if(!alias){
  for(let attempt=0;attempt<20;attempt++){
   const candidate=input.documentType.replace(/[^a-z]/gi,'').slice(0,1).toUpperCase()+createHash('sha256').update(`${input.identity}:${attempt}`).digest('hex').slice(0,8).toUpperCase();
   try{await pool.query('INSERT INTO download_reference_aliases(document_key,reference) VALUES($1,$2) ON CONFLICT DO NOTHING',[input.identity,candidate]);alias=(await pool.query('SELECT reference FROM download_reference_aliases WHERE document_key=$1',[input.identity])).rows[0]?.reference;if(alias)break;}
   catch(e){if((e as any).code!=='23505')throw e;}
  }
  if(!alias)throw Error('Unable to allocate a stable download reference.');
 }
 return downloadName({...input,alias});
}
/** The full customer name for a short code (file names use the name); undefined when it is not a known code. */
export async function customerFullName(pool:Pool|PoolClient,customer:string|undefined){
 if(!customer?.trim())return undefined;
 return (await pool.query('SELECT name FROM customers WHERE lower(short_code)=lower($1) LIMIT 1',[customer.trim()])).rows[0]?.name as string|undefined;
}
