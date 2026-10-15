import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ipoSiteIdentity} from '../server/orders/site-identity.js';
test('explicit code amendment preserves issued finances and source, and rejects unauthorised/stale corrections',async()=>{
 const row={id:'ipo',snapshot:{siteCode:'0000',allocation:{total:'7800000.00'},peachtree:{phaseTotal:'6714576.27'}}};
 const before=JSON.stringify(row);
 const correction={id:'correction',role:'Admin',snapshot:{previousSiteCode:'0000',siteCode:'0208',reason:'Assigned at PO',originalFingerprint:createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex')}};
 const pool:any={query:async()=>({rows:[correction]})};
 const result=await ipoSiteIdentity(pool,row);
 assert.equal(result.snapshot.siteCode,'0208');assert.deepEqual(result.snapshot.allocation,row.snapshot.allocation);assert.deepEqual(result.snapshot.peachtree,row.snapshot.peachtree);assert.equal(JSON.stringify(row),before);
 correction.role='Coordinator';await assert.rejects(()=>ipoSiteIdentity(pool,row));correction.role='Admin';correction.snapshot.originalFingerprint='stale';await assert.rejects(()=>ipoSiteIdentity(pool,row));
 assert.deepEqual(await ipoSiteIdentity({query:async()=>({rows:[]})} as any,row),{});
});
