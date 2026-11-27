// Read-only site locator (requested by the owner, 27 Nov 2026): "where is this site now inside the portal?"
// Searches by site name and/or branch code across every place a site can be recorded and prints, for
// each match, its current stage and what it is waiting on. It runs inside a READ ONLY transaction
// that is always rolled back: nothing is written, nothing is changed.
//
// Run in Render -> web service -> Shell (give --name, --code or both):
//   node dist/server/maintenance/find-site.js --name "Godhra" --code 2550
//   node dist/server/maintenance/find-site.js --name "Fazaia Housing"
import {readConfig} from "../config.js";
import {createPool} from "../db/pool.js";
import {findSiteReport} from "./find-site-report.js";

const args=process.argv.slice(2);
const value=(flag:string)=>{const i=args.indexOf(flag);return i>=0?String(args[i+1]??"").trim():"";};
const name=value("--name"),code=value("--code");
if(!name&&!code){
 console.log('Give --name "<part of the site name>" and/or --code <branch code>.');
 process.exitCode=1;
}else{
 const pool=createPool(readConfig(process.env));
 const c=await pool.connect();
 try{
  await c.query("BEGIN READ ONLY");
  console.log(`Searching for${name?` name "${name}"`:""}${name&&code?" or":""}${code?` branch code ${code}`:""} (read only)`);
  await findSiteReport(c,{name,code});
 }finally{
  await c.query("ROLLBACK").catch(()=>undefined);
  c.release();
  await pool.end();
 }
}
