import {ublPoSuggestions} from '../server/orders/po-extraction.js';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {directPoSuggestions,directPoChanges,validOrderPosition,directPoCapacityIssues} from '../shared/direct-po-reading.js';
test('approval email derives branch from the thread and keeps HQ, site contact and order numbering separate',()=>{
 const text=`Sender Name <sender@bank.test> Thu, Oct 8, 2026 at 5:53 PM\nRE: UPS Problem : Consumer Hub Lahore\nInstall 1 Chint Inverter (6 KW) with Lithium Battery as per approved rate.\nPOC:\nAftab = 0300-9898958\nFrom: another@bank.test\nGulberg Consumer Premises ( Branch\nCode 0201)\nMeezan Bank Limited, 60-Main Boulevard, Gulberg-II, LahorePABX`;
 const values=directPoSuggestions(text,{contact_person:'HQ contact',phone:'HQ phone',email:'hq@bank.test',address:'Karachi HQ'});
 assert.equal(values.siteCode,'0201');assert.equal(values.siteName,'Consumer Hub Lahore');assert.equal(values.siteAddress,'60-Main Boulevard, Gulberg-II, Lahore');assert.equal(values.siteContact,'Aftab');assert.equal(values.sitePhone,'0300-9898958');assert.equal(values.approvalDate,'2026-10-08');assert.equal(values.approvalContact,'Sender Name');assert.equal(values.approvalEmail,'sender@bank.test');assert.equal(values.billingAddress,'Karachi HQ');assert.equal(values.paymentContact,'HQ contact');assert.equal(values.ipoNumber,'');assert.equal(values.orderNumber,'');
 assert.deepEqual(directPoChanges(values,{...values,siteName:'Corrected site',orderNumber:'20/60'}).map(v=>v.field),['siteName','orderNumber']);
});
test('missing or ambiguous codes remain editable without guessing; unit sequence is bounded by total',()=>{
 assert.equal(directPoSuggestions('Branch Code: 201').siteCode,'0201');assert.equal(directPoSuggestions('Branch code: 0201\nBranch code: 0202').siteCode,'');assert.equal(directPoSuggestions('No branch information').siteCode,'');
 assert.equal(validOrderPosition('20/60'),true);for(const v of ['0/60','61/60','20/0','20','20/60/1'])assert.equal(validOrderPosition(v),false);
});

test('selected MBL6-5 remains authoritative unless latest evidence explicitly changes battery capacity',()=>{
 assert.deepEqual(directPoCapacityIssues('Install one 6 kW inverter with lithium battery as per approved rate','MBL-UPS-6-5'),[]);
 assert.equal(directPoCapacityIssues('Install 10 kWh lithium battery','MBL-UPS-6-5').length,1);
 for(const text of ['2 x 5 kWh batteries','2 × 5 kWh lithium batteries','2 batteries of 5 kWh']){assert.equal(directPoCapacityIssues(text,'MBL-UPS-6-5').length,1);assert.deepEqual(directPoCapacityIssues(text,'MBL-UPS-6-10'),[]);}
 assert.deepEqual(directPoCapacityIssues('Install 5 kWh battery\nFrom: older sender\nOld discussion: 10 kWh battery','MBL-UPS-6-5'),[]);
});

test('UBL photographed PO rows populate readable fields and leave redacted amounts empty',()=>{
 const text='PO ID POF999999001 PO Date 15/10/26\nDelivery Address UBL SAMPLE DELIVERY SITE, OSI-1195\nPOC: SITE CONTACT"\nDeliver To Email test@example.invalid Deliver To Contact No. 03000000000\nImport Ref Branch Code 0999\nComment Branch Name CENTRAL OFFICE\nPrices and values redacted';
 const fields=directPoSuggestions(text),po=ublPoSuggestions(text);
 assert.equal(fields.siteCode,'0999');assert.equal(fields.siteName,'CENTRAL OFFICE');assert.equal(fields.siteAddress,'UBL SAMPLE DELIVERY SITE, OSI-1195');assert.equal(fields.siteContact,'SITE CONTACT');assert.equal(fields.sitePhone,'03000000000');assert.equal(po.poNumber,'POF999999001');assert.equal(po.orderDate,'2026-10-15');assert.equal(po.total,'');assert.equal(po.printedTax,'');assert.equal(fields.ipoNumber,'');assert.equal(fields.orderNumber,'');
 assert.equal(directPoSuggestions('Branch Name\nSupplier other information').siteName,'');
 assert.equal(directPoSuggestions('Delivery Address\nContact other information').siteAddress,'');
});

test('UBL installation branch comes from delivery, retaining temporary printed code',()=>{
 const text='Delivery Address "(NO-AR) - UBL AMEEN SARDHERI BRANCH CHARSADDA, MARDAN REGION OSI-1195 - 2026\nBranch Code 0999\nBranch Name CENTRAL OFFICE';
 const fields=directPoSuggestions(text);
 assert.equal(fields.siteName,'UBL Ameen Sardheri, Charsadda');assert.equal(fields.siteCode,'0999');assert.match(fields.siteAddress,/OSI-1195/);
 assert.equal(directPoSuggestions('Branch Code 0999\nBranch Name CENTRAL OFFICE\nDelivery Address unreadable').siteName,'CENTRAL OFFICE');
 assert.equal(directPoSuggestions('Branch Code 0201\nBranch Name Consumer Hub Lahore\nDelivery Address Meezan House Karachi').siteName,'Consumer Hub Lahore');
});

test('only0999 can use name and delivery address as shared-code identity',async()=>{
 const {directPoSiteMatches:matches}=await import('../shared/direct-po-reading.js');
 const site={customer_id:1,code:'0999',name:'UBL Ameen Sardheri, Charsadda',location:'Sardheri address'};
 assert.equal(matches(site,1,'0999','UBL Ameen Sardheri, Charsadda','Sardheri address',true),true);
 assert.equal(matches(site,1,'0999','Another branch','Another address',true),false);
 assert.equal(matches(site,1,'0999',site.name,'Different address',true),false);
 assert.equal(matches({...site,code:'0208'},1,'0208','Different name','Different address'),true);
 assert.equal(matches({...site,code:'0000'},1,'0000','Different name','Different address'),true);
 assert.equal(matches(site,1,'0999','Different name','Different address',false),true);
 assert.equal(matches(site,2,'0999',site.name,site.location,true),false);
});
