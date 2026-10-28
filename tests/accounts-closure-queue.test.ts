import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isClosurePreparationJob} from '../shared/accounts-closure-queue.js';
test('closure preparation respects the latest state before any prior PT receipt',()=>{
 const cases=[
  {name:'new IRR before PT',latestClosure:null,ptRecorded:false,expected:false},
  {name:'new IRR after PT',latestClosure:null,ptRecorded:true,expected:true},
  {name:'existing Draft',latestClosure:{stage:'Draft'},ptRecorded:true,expected:true},
  {name:'existing Draft retains its place even if old PT is unavailable',latestClosure:{stage:'Draft'},ptRecorded:false,expected:true},
  {name:'returned for revision',latestClosure:{stage:'Returned for Revision'},ptRecorded:true,expected:true},
  {name:'returned for revision with old PT absent',latestClosure:{stage:'Returned for Revision'},ptRecorded:false,expected:true},
  {name:'submitted despite recorded PT',latestClosure:{stage:'Awaiting Management'},ptRecorded:true,expected:false},
  {name:'closed despite recorded PT',latestClosure:{stage:'Closed'},ptRecorded:true,expected:false},
  {name:'unknown state despite recorded PT',latestClosure:{stage:'Other'},ptRecorded:true,expected:false},
  {name:'missing state on an existing closure',latestClosure:{},ptRecorded:true,expected:false},
 ];
 for(const row of cases)assert.equal(isClosurePreparationJob(row),row.expected,row.name);
});
