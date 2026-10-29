import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {migrate} from '../server/db/migrate.js';
/** Additional single-session SQL check when the host cannot start native PG.
 * Native PostgreSQL remains required for release concurrency verification. */
export async function directMaterialDatabase(){
 const db=await PGlite.create();
 const decode=(v:any):any=>v instanceof Uint8Array?Buffer.from(v):Array.isArray(v)?v.map(decode):v&&typeof v==='object'&&!(v instanceof Date)?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):v;
 const query=async(text:string,params?:any[])=>{const result=params?.length?await db.query(text,params):(await db.exec(text)).at(-1);return {rows:(result?.rows??[]).map(decode),rowCount:result?.affectedRows||result?.rows.length||0};};
 const client={query,release(){}};
 const pool={query,async connect(){return client;},async end(){},on(){}} as unknown as Pool;
 try{await migrate(pool);}catch(e){await db.close();throw e;}
 return {pool,async close(){await db.close();}};
}
