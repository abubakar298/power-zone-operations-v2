import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {materialStockFixture} from './material-stock-fixture.js';
import {WarehouseAuthorityRepository} from '../server/inventory/warehouse-ledger.js';
import {warehouseAvailability} from '../server/inventory/warehouse-availability.js';

test('warehouse availability holds ambiguous identity, unverified authority and incompatible units instead of treating them as zero',async()=>{
 const db=await testDatabase();try{
  const itemId='CH-CBL-AC-16MM/4C-PK',f=await materialStockFixture(db.pool,itemId),authority=new WarehouseAuthorityRepository(db.pool);
  assert.equal(await warehouseAvailability(db.pool,[{itemKey:itemId,unit:'m'}]),null,'No warehouse authority retains the legacy path.');
  const command={warehouse:'Lahore warehouse',version:0,sourceSha256:f.stockSha,state:'active' as const,reason:'Fictional reviewed balance.',requestKey:randomUUID()};await authority.command(f.owner,command);
  let values=await warehouseAvailability(db.pool,[{itemKey:itemId,unit:'m'},{itemKey:'unknown-final-id',unit:'m'}]);
  assert.equal(values?.get(itemId)?.quantity,'7');assert.equal(values?.get('unknown-final-id')?.quantity,null);assert.match(values?.get('unknown-final-id')?.hold??'',/identity/);
  values=await warehouseAvailability(db.pool,[{itemKey:itemId,unit:'coils'}]);assert.equal(values?.get(itemId)?.quantity,null);assert.match(values?.get(itemId)?.hold??'',/units/);
  values=await warehouseAvailability(db.pool,[{itemKey:'CH-BAT-LV-05 KW',unit:'piece'}]);assert.equal(values?.get('CH-BAT-LV-05 KW')?.quantity,null);assert.match(values?.get('CH-BAT-LV-05 KW')?.hold??'',/opening/);
  await authority.command(f.owner,{...command,version:1,state:'suspended',requestKey:randomUUID()});
  values=await warehouseAvailability(db.pool,[{itemKey:itemId,unit:'m'}]);assert.equal(values?.get(itemId)?.quantity,null);assert.match(values?.get(itemId)?.hold??'',/verification/);
 }finally{await db.close();}
});
