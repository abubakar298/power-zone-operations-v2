import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountsReturnCheckDue,accountsReturnGapMs} from '../web/workspaces/accounts-refresh.js';

test('coming back to the Accounts window re-checks the counts only when the last check is a minute old',()=>{
  const now=10_000_000;
  assert.equal(accountsReturnGapMs,60_000);
  assert.equal(accountsReturnCheckDue(undefined,now),true);
  assert.equal(accountsReturnCheckDue(now-7_000,now),false);
  assert.equal(accountsReturnCheckDue(now-accountsReturnGapMs+1,now),false);
  assert.equal(accountsReturnCheckDue(now-accountsReturnGapMs,now),true);
});
