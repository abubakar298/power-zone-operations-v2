import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {findSiteReport} from '../server/maintenance/find-site-report.js';
import {testDatabase} from './database.js';

test('the site locator finds a site by name or whole branch code and changes nothing',async()=>{
 const db=await testDatabase();
 try{
  const actor=randomUUID();
  await db.pool.query("INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,'owner@example.test','Owner','Admin','isolated')",[actor]);
  const site=(id:string,name:string,extra:object)=>({id,ipo:'CHP-1',name,customer:'Fixture bank',stage:'awaiting',installation:true,operationsTeam:'south',dispatchDate:'2026-05-20',documents:[],...extra});
  await new OperationsBoardRepository(db.pool).importSource(actor,{sourceSha256:'a'.repeat(64),rows:[
   site('fixture-site-a','Lakeside Branch, Karachi',{branchCode:'2550'}) as any,
   site('fixture-site-b','Hillside Branch',{branchCode:'12550'}) as any,
  ]});
  const versions=async()=>(await db.pool.query('SELECT count(*)::int n FROM operations_board_versions')).rows[0].n;
  const before=await versions();
  const run=async(search:{name:string;code:string})=>{
   const out:string[]=[],c=await db.pool.connect();
   try{await c.query('BEGIN READ ONLY');const result=await findSiteReport(c,search,t=>out.push(t));return {...result,text:out.join('\n')};}
   finally{await c.query('ROLLBACK');c.release();}
  };
  const byCode=await run({name:'',code:'02550'});
  assert.deepEqual(byCode.board,['fixture-site-a'],'leading zeros ignored; 12550 is not 2550');
  assert.match(byCode.text,/Board column\s+Awaiting delivery/);
  assert.match(byCode.text,/operations\/sites\/fixture-site-a/);
  assert.deepEqual((await run({name:'hillside',code:''})).board,['fixture-site-b']);
  const none=await run({name:'no such branch',code:''});
  assert.equal(none.found,0);assert.match(none.text,/No site matched/);
  assert.equal(await versions(),before,'nothing written');
 }finally{await db.close();}
});
