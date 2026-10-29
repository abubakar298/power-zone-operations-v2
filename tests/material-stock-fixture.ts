import {randomUUID} from 'node:crypto';
import {InventoryReviewRepository} from '../server/inventory/review-register.js';
import {WarehouseSourceRepository} from '../server/inventory/warehouse-register.js';
import {prepareInventoryReview} from '../server/inventory/review-source.js';
export async function materialStockFixture(pool:any,itemId='FINAL',meta:Record<string,unknown>={canonicalIds:1},extraBalances:Record<string,unknown>[]=[]){
 const owner=randomUUID(),reviewer=randomUUID();for(const [id,role] of [[owner,'Admin'],[reviewer,'Inventory']])await pool.query('INSERT INTO users(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',[id,id+'@ledger.example.test',role,role,'isolated']);
 const catalogue={rows:[{itemId},...extraBalances.map(row=>({itemId:row.itemId}))]},source={groups:[{id:'batch',title:'Batch',warehouse:'Lahore',rows:[{id:'cable',item:'Cable',itemId,unit:'m',origin:'warehouse_stock',status:'Review needed',dispatch:10,used:7,countedReturn:3,credited:1}]}]};
 const review=new InventoryReviewRepository(pool),warehouse=new WarehouseSourceRepository(pool),sha='a'.repeat(64),catalogueSha='b'.repeat(64),stockSha='c'.repeat(64);
 await review.importSource(owner,{sourceSha256:sha,catalogueSha256:catalogueSha,source,catalogue});
 await warehouse.importSource(owner,{sourceSha256:stockSha,catalogueSha256:catalogueSha,reviewSourceSha256:sha,finalItemIds:[itemId,...extraBalances.map(row=>String(row.itemId))],source:{meta,balances:[{itemId,warehouse:'Lahore warehouse',unit:'m',description:'Cable',opening:10,in:5,out:8,closing:7,openingStatus:'Reviewed source',review:''},...extraBalances],events:[{eventId:'old-in',itemId,warehouse:'Lahore warehouse',unit:'m',description:'Cable',in:5,out:0},{eventId:'old-out',itemId,warehouse:'Lahore warehouse',unit:'m',description:'Cable',in:0,out:8}]}});
 const row=prepareInventoryReview(source,catalogue).cases[0],closing=await warehouse.caseClosing(row.id,row);if(!closing.available)throw Error('Expected fixture balance.');
 return {owner,reviewer,review,warehouse,row,stockSha,key:closing.ledgerKey};
}

