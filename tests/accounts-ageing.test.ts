import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ageBand,customerTotals} from '../server/accounts/billing-model.js';
test('Accounts ageing uses non-overlapping 0–7,8–15,over15 day boundaries',()=>{
 const asOf='2026-10-28';
 for(const [date,band]of [['2026-10-28','0-7'],['2026-10-21','0-7'],['2026-10-20','8-15'],['2026-10-13','8-15'],['2026-10-12','15+'],['2026-01-01','15+'],['2026-10-29','unknown'],['bad','unknown']])assert.equal(ageBand(date,asOf),band);
 assert.equal(ageBand(null,asOf),'unknown');
 const rows=[{customer:'UBL',amount:'1.49',pending:'1.49',date:'2026-10-12',submission:'Submitted'},{customer:'UBL',amount:'2.49',pending:'2.49',date:'2026-10-20',submission:'Submitted'},{customer:'UBL',amount:'10.25',pending:'10.25',date:'2026-01-01',submission:'Submission not confirmed'}];
 const t=customerTotals(rows,asOf)[0];assert.equal(t.submittedPending,'3.98');assert.equal(t.awaitingSubmission,'10.25');assert.equal(t.bands.find(b=>b.id==='15+')?.amount,'1.49');
});
