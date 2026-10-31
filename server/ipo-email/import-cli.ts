import {readFile} from 'node:fs/promises';
import {readConfig} from '../config.js';
import {createPool} from '../db/pool.js';
import {importThreadIndex} from './import-index.js';
const args=process.argv.slice(2),file=args[args.indexOf('--file')+1],actor=args[args.indexOf('--actor')+1];
if(!args.includes('--file')||!args.includes('--actor')||!file||!actor)throw Error('Usage: import-cli --file PRIVATE_VERIFIED_INDEX --actor MANAGEMENT_UUID [--enable]');
const input=JSON.parse(await readFile(file,'utf8')),pool=createPool(readConfig());
try{console.log(JSON.stringify(await importThreadIndex(pool,actor,input,args.includes('--enable'))));}finally{await pool.end();}
