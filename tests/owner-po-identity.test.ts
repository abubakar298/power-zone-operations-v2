import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applyIpoSiteIdentity} from '../server/orders/site-identity.js';
test('owner PO/order confirmation is fingerprint-bound, leaves original BOQ/money intact, and rejects changed prior identities',()=>{
 const row={snapshot:{siteCode:'0126',siteName:'New Chaali Barnch',input:{poNumber:'',orderNumber:'3/60'},allocation:{total:'935000.00'},boqRevisionId:'unchanged'},saved_po_reference:'EMAIL-0126'},before=JSON.stringify(row);
 const correction={id:'audit',role:'Management',snapshot:{originalFingerprint:createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex'),previousSiteCode:'0126',siteCode:'0126',previousSiteName:'New Chaali Barnch',siteName:'New Chaali Barnch, Karachi',previousPoNumber:'',poNumber:'1210031784',previousSavedPoReference:'EMAIL-0126',previousOrderNumber:'3/60',orderNumber:'3/20',reason:'Owner confirms upgrade and shared PO'}};
 const r=applyIpoSiteIdentity(row,correction);assert.equal(r.snapshot.input.poNumber,'1210031784');assert.equal(r.snapshot.input.orderNumber,'3/20');assert.equal(r.snapshot.allocation.total,'935000.00');assert.equal(r.snapshot.boqRevisionId,'unchanged');assert.equal(r.approvedPoReference,'1210031784');assert.equal(JSON.stringify(row),before);
 for(const c of [{...correction,role:'Inventory'},{...correction,snapshot:{...correction.snapshot,previousOrderNumber:'2/60'}},{...correction,snapshot:{...correction.snapshot,previousSavedPoReference:'OTHER'}}])assert.throws(()=>applyIpoSiteIdentity(row,c),/review/);
});
