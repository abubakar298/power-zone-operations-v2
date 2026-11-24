import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupBySite,matchesSiteType,siteIndex,siteKeys} from '../shared/accounts-site-groups.js';
import {recoveryFilteredRows,recoveryReport} from '../shared/recovery-report.js';
import {cableSitesCount} from '../server/accounts/cable-consolidations.js';

// Site type filter on Payments to Record (user request, agreed with Abu Bakar, 24 Nov 2026).
const UBL='United Bank Limited';
const ups=(id:string,ipo:string,site:string,pending='100.00',date='2026-11-01')=>({id,customer:UBL,category:'System',sourceKey:'UBL:UPS:'+id,ipo,site,invoice:'27-'+id,amount:pending,pending,submission:'Submitted',date});
const solar=(id:string,ipo:string,site:string,pending='200.00')=>({id,customer:UBL,category:'System · advance',sourceKey:'UBL:SOLAR:'+id,ipo,site,invoice:'27-'+id,amount:pending,pending,submission:'Submitted',date:'2026-11-02'});
const cable=(id:string,ipo:string,site:string,pending='50.00',customer=UBL)=>({id:'cable:'+id,customer,category:'Extra cable',ipo,site,invoice:'27-C'+id,amount:pending,pending,submission:'Submitted',date:'2026-11-03'});
const rows=[
 ups('1','CHP-363','Ameen Choti Zareen'),cable('1','CHP-363','Ameen Choti Zareen'),
 ups('2','CHP-400','Walton Road'),
 solar('3','CHP-70','Model Town'),cable('3','CHP-70','Model Town','75.00'),
 solar('4','CHP-71','Gulberg'),
 // Same IPO under another customer is a different site.
 cable('5','CHP-400','Walton Road','10.00','Meezan Bank Limited'),
 // Older invoice entered before the one-site rule: covers two sites.
 cable('6','CHP-500 / CHP-501','2 branches'),ups('6','CHP-500','Site A'),ups('7','CHP-501','Site B'),
];
const pick=(type:string)=>{const sites=siteIndex(rows);return rows.filter(r=>matchesSiteType(r,type,sites)).map(r=>r.id);};

test('a site is linked by exact customer + IPO number, never a similar name',()=>{
 assert.deepEqual(siteKeys(ups('1','CHP-363','X')),[UBL+'|CHP-363']);
 assert.deepEqual(siteKeys(cable('6','CHP-500 / CHP-501','2 branches')),[UBL+'|CHP-500',UBL+'|CHP-501']);
 assert.deepEqual(siteKeys({...ups('8',' chp-9 · 213/250 ','X')}),[UBL+'|CHP-9']);
 assert.deepEqual(siteKeys({...ups('9','','X')}),[]);
});

test('UPS only, UPS + Extra Cable, Solar only and Solar + Extra Cable pick the right invoices',()=>{
 assert.deepEqual(pick('ups-cable'),['1','cable:1','cable:6','6','7']);
 assert.deepEqual(pick('ups-only'),['2']);
 assert.deepEqual(pick('solar-cable'),['3','cable:3']);
 assert.deepEqual(pick('solar-only'),['4']);
 assert.equal(pick('').length,rows.length);
 assert.equal(pick('unknown').length,0);
 // The Meezan cable invoice on IPO CHP-400 does not turn the UBL Walton Road UPS site into "UPS + Extra Cable".
 assert.ok(!pick('ups-cable').includes('cable:5'));
});

test('grouped list: one heading per site, main invoice first, a multi-site cable invoice listed and counted once',()=>{
 const sites=siteIndex(rows),filtered=rows.filter(r=>matchesSiteType(r,'ups-cable',sites));
 const groups=groupBySite([...filtered].reverse(),'ups-cable',sites);
 const first=groups.find(g=>g.ipo==='CHP-363')!;
 assert.equal(first.site,'Ameen Choti Zareen');assert.equal(first.customer,UBL);
 assert.deepEqual(first.rows.map(r=>r.id),['1','cable:1'],'UPS invoice first, then its extra-cable invoice');
 assert.equal(first.pending,'150.00');
 assert.equal(groups.flatMap(g=>g.rows).filter(r=>r.id==='cable:6').length,1,'shared cable invoice appears once');
 assert.ok(groups.some(g=>g.sharedCable.some(r=>r.id==='cable:6')));
 assert.equal(groups.flatMap(g=>g.rows).length,filtered.length,'every invoice is shown exactly once');
});

test('site type comes from all of the site\'s invoices, so a paid UPS invoice still makes it "UPS + Extra Cable"',()=>{
 const awaiting=[cable('1','CHP-363','Ameen Choti Zareen')],all=[ups('1','CHP-363','Ameen Choti Zareen','0.00'),...awaiting];
 assert.deepEqual(recoveryFilteredRows(awaiting,{siteType:'ups-cable'},1,all).map(r=>r.id),['cable:1']);
 assert.deepEqual(recoveryFilteredRows(awaiting,{siteType:'ups-only'},1,all).map(r=>r.id),[]);
});

test('recovery PDF follows the filter and keeps each site\'s invoices together',()=>{
 const filtered=recoveryFilteredRows(rows,{siteType:'ups-cable'},1);
 const report=recoveryReport(filtered,'2026-11-24',true);
 const i=report.items.findIndex(r=>r.invoice==='27-1');assert.equal(report.items[i+1].invoice,'27-C1');
 assert.equal(report.items.length,5);
 // Without a site type the order stays oldest first.
 assert.equal(recoveryReport(recoveryFilteredRows(rows,{},1),'2026-11-24').items[0].submittedOn,'2026-11-01');
});

test('one extra-cable invoice can cover only one site',()=>{
 assert.equal(cableSitesCount([{site:'First site',ipo:'CHP-220'},{site:'Second name',ipo:'chp-220'}]),1);
 assert.equal(cableSitesCount([{site:'A',ipo:'CHP-1'},{site:'B',ipo:'CHP-2'}]),2);
 assert.equal(cableSitesCount([{site:'No IPO site'}]),1);
});
