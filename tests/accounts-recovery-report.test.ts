import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {recoveryAge,recoveryReport} from '../shared/recovery-report.js';
import {recoveryPdf} from '../web/reports/recovery-pdf.js';
import {billingRows} from '../server/accounts/billing-model.js';
test('recovery ageing has exact 7/8/14/15 day boundaries and no invented ages',()=>{
 for(const [date,days,color] of [['2026-10-31',0,'#4f46a5'],['2026-10-24',7,'#4f46a5'],['2026-10-23',8,'#b45309'],['2026-10-17',14,'#b45309'],['2026-10-16',15,'#b42318']] as const)assert.deepEqual(recoveryAge(date,'2026-10-31'),{days,color});
 for(const date of ['',null,'2026-11-01','2026-02-30','not recorded'])assert.equal(recoveryAge(date,'2026-10-31').days,null);
});
test('export keeps submitted unpaid invoice phases, unknown balances and only intended report fields',()=>{
 const base={site:'Example Branch',invoice:'27-90001',submission:'Submitted',customer:'Example Bank',po:'PO-123',date:'2026-10-16'};
 const rows=[{...base,id:'UBL:SOLAR:1:advance',category:'System · advance',pending:'100.25',internalCost:'SECRET'},
 {...base,id:'UBL:SOLAR:1:completion',category:'System · completion',pending:'200'},
 {...base,category:'Internet',pending:'20',submission:'Submission not confirmed'},
 {...base,category:'Extra cable',pending:'0',receiptConfirmed:true},
 {...base,invoice:'27-90002',category:'Extra cable',pending:null}];
 const before=JSON.stringify(rows),r=recoveryReport(rows,'2026-10-31');
 assert.equal(r.items.length,3);assert.equal(r.total,'300.25');assert.equal(r.unknownAmounts,1);
 assert.deepEqual(r.items.map(r=>r.stage),['50% Advance Invoice','Balance Invoice','Extra Cable Invoice']);
 assert.equal(r.items[0].po,'PO-123');assert.doesNotMatch(JSON.stringify(r),/SECRET|internalCost/);assert.equal(JSON.stringify(rows),before);
});
test('PO enrichment uses exact customer and invoice ownership without changing financial data or sources',()=>{
 const a={key:'UBL:UPS:1',kind:'UPS',customer:'UBL',po:'UBL-PO',ipo:'CHP-163',site:'Example',invoiceReferences:['27-90001'],singleInvoiceSubmitted:true};
 const b={...a,key:'MBL:UPS:1',customer:'MBL',po:'MBL-PO'};
 const source=[{rows:[a,b]}],before=JSON.stringify(source),r=billingRows(source,{rows:[]},{rows:[]});
 assert.deepEqual(r.map(x=>x.po),['UBL-PO','MBL-PO']);assert.deepEqual(r.map(x=>x.pending),[null,null]);assert.equal(JSON.stringify(source),before);
});
test('compressed selectable report paginates repeated headers and long site/invoice references',()=>{
 const rows=Array.from({length:115},(_,i)=>({id:'UBL:SOLAR:'+i,site:i%9===0?'Example branch with a long address / Another linked branch with a longer name / Third branch in the same invoice':'Example Branch '+i,customer:'Example Bank',ipo:'CHP-900',po:i%2?'PO-123456789':'',invoice:'27-90001 / 27-90001-S',category:i%2?'System · advance':'System · completion',submission:'Submitted',date:['2026-10-24','2026-10-23','2026-10-16',''][i%4],pending:i%7===0?null:'1234567.50'}));
 const report=recoveryReport(rows,'2026-10-31'),pdf=recoveryPdf(report),bytes=Buffer.from(pdf.output('arraybuffer'));
 assert.ok(pdf.getNumberOfPages()>1);assert.ok(bytes.length<500_000);mkdirSync('/tmp/pz-recovery-report',{recursive:true});writeFileSync('/tmp/pz-recovery-report/recovery-sample.pdf',bytes);writeFileSync('/tmp/pz-recovery-report/report.json',JSON.stringify(report));
 console.log('PDF pages:',pdf.getNumberOfPages(),'bytes:',bytes.length);
});
