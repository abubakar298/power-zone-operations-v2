import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './database.js';
test('Approved UBL cost revision preserves original snapshots and applies stage-specific panel rates',async()=>{
 const db=await testDatabase();try{
 const rows=(await db.pool.query('SELECT configuration_id,stage,total_cost,panel_rate FROM ubl_effective_history_costs ORDER BY configuration_id,stage')).rows;
 const expected:Record<string,number>={'20-20-30':3840750,'25-20-30':4197700,'30-30-40':5412800,'35-30-40':5749800};
 const watts:Record<string,number>={'20-20-30':20000,'25-20-30':25000,'30-30-40':30000,'35-30-40':35000};
 assert.equal(rows.length,12);
 for(const r of rows){assert.equal(Number(r.total_cost),expected[r.configuration_id]-(r.stage==='Revised'?0:9*watts[r.configuration_id]));assert.equal(Number(r.panel_rate),r.stage==='Revised'?39:30);}
 const sites=(await db.pool.query('SELECT o.baseline AS old,e.baseline AS current FROM ubl_site_orders o JOIN ubl_effective_site_orders e USING(site_id) WHERE o.baseline IS NOT NULL')).rows;
 assert.equal(sites.length,37);
 for(const s of sites){assert.equal(s.old.sellingExcludingGst,s.current.sellingExcludingGst);assert.notEqual(String(s.old.budgetedCost),String(s.current.budgetedCost));assert.equal(s.current.items.reduce((n:number,l:any)=>n+Number(l.total_ex_gst),0),Number(s.current.budgetedCost));assert.equal(s.current.items.find((l:any)=>l.item==='Delivery/logistics').buying_rate_ex_gst,3);}
 assert.equal((await db.pool.query("SELECT total_cost FROM ubl_history_cost_baselines WHERE configuration_id='35-30-40' AND stage='Revised'")).rows[0].total_cost,'5889161');
 await assert.rejects(db.pool.query("UPDATE ubl_site_budget_revisions SET snapshot='{}'"));
 }finally{await db.close();}
});
