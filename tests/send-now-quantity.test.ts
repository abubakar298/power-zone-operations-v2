import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sendNowQuantity,totalFromSendNow} from '../web/inventory-approved/send-now.js';

test('before any DO, the box is the quantity itself',()=>{
 assert.equal(sendNowQuantity('10',undefined),'10');assert.equal(totalFromSendNow('10',undefined),'10');
 assert.equal(sendNowQuantity('10','0'),'10');assert.equal(totalFromSendNow('7','0'),'7');
});

test('after a DO, the box shows only what goes on the next DO; the saved total adds it to what was sent',()=>{
 assert.equal(sendNowQuantity('10','10'),'','nothing left to send yet');
 assert.equal(totalFromSendNow('5','10'),'15','10 already sent + 5 now');
 assert.equal(sendNowQuantity('15','10'),'5');
 assert.equal(totalFromSendNow('','10'),'10','an empty box sends nothing more and keeps what was sent');
 assert.equal(totalFromSendNow('2.5','100'),'102.5');
});

test('odd typing is passed through so the normal checks report it',()=>{
 assert.equal(totalFromSendNow('abc','10'),'abc');assert.equal(sendNowQuantity('abc','10'),'abc');
});
