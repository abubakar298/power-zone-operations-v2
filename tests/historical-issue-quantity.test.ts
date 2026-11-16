import assert from 'node:assert/strict';
import {test} from 'node:test';
import {historicalIssueQuantity} from '../server/inventory/historical-issue-quantity.js';

const issue={
  kind:'issue',documentType:'DO',quantity:'1.25',duplicateSourceRows:2,
  sourceIds:['DO-ISSUE:sample:row21:0','DO-ISSUE:sample:row22:0'],
};

test('the historical issue total includes each distinct row from the same source DO',()=>{
  assert.equal(historicalIssueQuantity(issue),'2.5');
});

test('the historical issue total preserves the imported quantity when source rows cannot be counted',()=>{
  assert.equal(historicalIssueQuantity({...issue,kind:'return'}),issue.quantity);
  assert.equal(historicalIssueQuantity({...issue,duplicateSourceRows:3}),issue.quantity);
  assert.equal(historicalIssueQuantity({...issue,sourceIds:[issue.sourceIds[0]!,issue.sourceIds[0]!]}),issue.quantity);
  assert.equal(historicalIssueQuantity({...issue,sourceIds:[issue.sourceIds[0]!,'DO-ISSUE:another-do:row22:0']}),issue.quantity);
});
