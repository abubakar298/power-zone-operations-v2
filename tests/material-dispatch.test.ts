import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reconcileMaterialDispatch,materialSiteDocuments,validateMaterialDispatch} from '../server/inventory/material-dispatch.js';

const cableKey=randomUUID(),lugsKey=randomUUID(),id=randomUUID();
function fixture(){return {id,reference:'CPZ-PDO-001',warehouse:'Lahore warehouse',kind:'variable',parent:true,sites:[{id:'a',ipo:'IPO-A',installation:true,basisId:randomUUID(),basisVersion:1},{id:'b',ipo:'IPO-B',installation:true,basisId:randomUUID(),basisVersion:1}],lines:[{key:cableKey,itemId:'CH-CBL-AC-16MM/4C-PK',description:'16mm AC cable',unit:'m',out:'70',sites:['a','b']},{key:lugsKey,itemId:'CH-Mix Items All',description:'16mm lugs',unit:'piece',out:'35',sites:['a','b']}],usage:[{siteId:'a',lineKey:cableKey,used:'20'},{siteId:'b',lineKey:cableKey,used:'10'},{siteId:'a',lineKey:lugsKey,used:'20'},{siteId:'b',lineKey:lugsKey,used:'12'}],extraSources:[] as any[],receipts:[{id:randomUUID(),reference:'CPZ-PDO-001-IGP-01',dispatchId:id,evidenceId:randomUUID(),status:'verified',lines:[{lineKey:cableKey,quantity:'40'},{lineKey:lugsKey,quantity:'3'}]}]};}

test('Parent DO reconciles warehouse OUT with all sites and verified receipts; site sign-offs do not repeat warehouse issuance',()=>{
 const source=fixture(),before=structuredClone(source),result=reconcileMaterialDispatch(source);assert.equal(result.ready,true);assert.equal(result.stockPosting,false);assert.deepEqual(source,before);
 assert.equal(result.rows[0].warehouseOut,'70');assert.equal(result.rows[0].used,'30');assert.equal(result.rows[0].expectedReturn,'40');assert.equal(result.rows[0].verifiedWarehouseReturn,'40');assert.equal(result.rows[0].remaining,'0');
 const documents=materialSiteDocuments(source,'a');assert.equal(documents.customerUsage.length,1);assert.equal(documents.customerUsage[0].used,'20');assert.equal(documents.customerUsage[0].issuedAtSite,'20');assert.equal(documents.installationReconciliation.length,1);assert.equal(documents.installationReconciliation[0].itemId,'CH-Mix Items All');assert.equal(documents.fixedDelivery.length,0);assert.equal(documents.stockPosting,false);
 assert.throws(()=>materialSiteDocuments(source,'other'),/not part/);
});
test('missing usage is unknown; uploaded receipts are not warehouse credits; no-return-due needs no fabricated receipt',()=>{
 const missing=fixture();missing.usage=missing.usage.filter(u=>!(u.siteId==='b'&&u.lineKey===cableKey));const partial=reconcileMaterialDispatch(missing);assert.equal(partial.rows[0].used,null);assert.equal(partial.rows[0].remaining,null);assert.equal(partial.ready,false);assert.equal(materialSiteDocuments(missing,'b').customerUsage[0].issuedAtSite,null);
 const uploaded=fixture();uploaded.receipts[0].status='uploaded';const waiting=reconcileMaterialDispatch(uploaded);assert.equal(waiting.rows[0].verifiedWarehouseReturn,'0');assert.equal(waiting.rows[0].remaining,'40');assert.equal(waiting.ready,false);
 const noReturn=fixture();noReturn.lines[0].out='30';noReturn.lines[1].out='32';noReturn.receipts=[];assert.equal(reconcileMaterialDispatch(noReturn).ready,true);
});
test('separate additional DO and LP evidence explain over-use without a second source credit or warehouse issue for site purchases',()=>{
 const single=fixture();single.parent=false;single.sites=single.sites.slice(0,1);single.lines=single.lines.slice(0,1).map(r=>({...r,sites:['a'],out:'181'}));single.usage=[{siteId:'a',lineKey:cableKey,used:'206'}];single.receipts=[];
 assert.equal(reconcileMaterialDispatch(single).rows[0].remaining,'-25');
 const extra={documentId:randomUUID(),lineKey:cableKey,kind:'warehouse-do',quantity:'25',verified:true};single.extraSources=[extra,structuredClone(extra)];const explained=reconcileMaterialDispatch(single);assert.equal(explained.rows[0].warehouseOut,'206');assert.equal(explained.ready,true);assert.equal(materialSiteDocuments(single,'a').customerUsage[0].issuedAtSite,'206');
 single.extraSources=[{...extra,kind:'local-purchase'}];const lp=reconcileMaterialDispatch(single);assert.equal(lp.rows[0].warehouseOut,'181');assert.equal(lp.rows[0].localPurchase,'25');assert.equal(lp.ready,true);
 single.extraSources=[{...extra,verified:false}];assert.equal(reconcileMaterialDispatch(single).rows[0].status,'Additional evidence pending');
 single.extraSources=[{...extra,documentId:id}];assert.throws(()=>validateMaterialDispatch(single),/already counted/);
 single.extraSources=[extra,{...extra,quantity:'26'}];assert.throws(()=>validateMaterialDispatch(single),/Conflicting quantities/);
});
test('provisional colour allocation stays flagged even when its combined shortage equals 77m',()=>{
 const source=fixture();source.lines[0]={...source.lines[0],itemId:'CH-CBL-DC-6MM/1C-R/PK',out:'845',sites:['a']};source.lines[1]={...source.lines[1],itemId:'CH-CBL-DC-6MM/1C-B/PK',description:'DC black cable',unit:'m',out:'961',sites:['b']};source.usage=[{siteId:'a',lineKey:cableKey,used:'733'},{siteId:'b',lineKey:lugsKey,used:'732'}];
 const batch={...source.receipts[0],allocationProvisional:true,lines:[{lineKey:cableKey,quantity:'132'},{lineKey:lugsKey,quantity:'132'}]};source.receipts=[batch];
 const result=reconcileMaterialDispatch(source);assert.equal(result.rows[0].remaining,'-20');assert.equal(result.rows[1].remaining,'97');assert.equal(result.ready,false);assert.ok(result.rows.every(r=>r.status==='Provisional return allocation needs verification'));
});
test('wrong parent, duplicate receipts, incompatible sites and fixed/variable mixing are rejected',()=>{
 const duplicate=fixture();duplicate.receipts.push(structuredClone(duplicate.receipts[0]));assert.throws(()=>validateMaterialDispatch(duplicate),/already recorded/);
 const wrong=fixture();wrong.receipts[0].dispatchId=randomUUID();assert.throws(()=>validateMaterialDispatch(wrong),/another dispatch/);
 const outside=fixture();outside.usage[0].siteId='other';assert.throws(()=>validateMaterialDispatch(outside),/another site/);
 const fixed=fixture();fixed.lines[0].itemId='CH-BRK-DC-20A/4P';fixed.lines[0].description='DC breaker';assert.throws(()=>validateMaterialDispatch(fixed),/separate dispatches/);
 const noParent=fixture();noParent.parent=false;assert.throws(()=>validateMaterialDispatch(noParent),/Parent DO/);
});
test('delivery-only product sales use their fixed delivery document without installation variance or IRR',()=>{
 const source=fixture();source.kind='fixed';source.parent=false;source.sites=[{...source.sites[0],installation:false}];source.lines=[{...source.lines[0],sites:['a']}];source.usage=[];source.receipts=[];
 const document=materialSiteDocuments(source,'a');assert.equal(document.fixedDelivery.length,1);assert.equal(document.customerUsage.length,0);assert.equal(document.installationReconciliation.length,0);
 source.kind='variable';assert.throws(()=>validateMaterialDispatch(source),/Delivery-only/);
});
test('a miscellaneous site return is recorded internally without becoming a verified warehouse receipt',()=>{
 const source=fixture();source.receipts=[];
 (source.usage[2] as any).issued='23';(source.usage[2] as any).returned='3';
 const site=materialSiteDocuments(source,'a');assert.equal(site.installationReconciliation[0].issuedAtSite,'23');assert.equal(site.installationReconciliation[0].returnedAtSite,'3');
 const summary=reconcileMaterialDispatch(source).rows.find(r=>r.key===lugsKey)!;assert.equal(summary.verifiedWarehouseReturn,'0');assert.equal(summary.remaining,'3');assert.equal(summary.ready,false);
 delete (source.usage[2] as any).issued;assert.equal(materialSiteDocuments(source,'a').installationReconciliation[0].issuedAtSite,null,'Do not infer miscellaneous site allocation from usage.');
});

test('known use exceeding warehouse supply is flagged even while another site remains unknown',()=>{
 const source=fixture();source.usage=source.usage.filter(r=>r.siteId==='a');source.usage[0].used='80';source.receipts=[];
 const row=reconcileMaterialDispatch(source).rows[0];assert.equal(row.used,null);assert.equal(row.remaining,null);assert.equal(row.status,'Additional DO / LP evidence or quantity correction needed');
});
