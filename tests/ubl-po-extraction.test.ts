import {test} from 'node:test';import assert from 'node:assert/strict';import {ublPoSuggestions} from '../server/orders/po-extraction.js';
test('UBL inclusive PO parses payable, printed zero and template date without taking supplier NTN as customer data',()=>{
const value=ublPoSuggestions('PURCHASE ORDER\n PO ID   PO Date\nPOF262710526   08/10/26\nSupplier Contact Person\nPower Zone Waqas Ul Haq\nNTN 5411333\nValue Excluding Sales Tax 7,800,000.00\nSales Tax 0.00\nValue including Sales Tax 7,800,000.00\nNet Payable 7,800,000.00 PKR\nPrices are inclusive of all applicable Taxes.');
assert.deepEqual(value,{total:'7800000.00',printedTax:'0.00',taxInclusive:true,poNumber:'POF262710526',orderDate:'2026-10-08'});assert.ok(!('customerNtn' in value));});
test('UBL total uses value including tax rather than withholding net; unknown or multiple totals stay unresolved',()=>{
assert.equal(ublPoSuggestions('Value including Sales Tax 7,800,000.00\nNet Payable 7,400,000.00 PKR').total,'7800000.00');
assert.equal(ublPoSuggestions('Value including Sales Tax 100.00\nValue including Sales Tax 200.00').total,'');
assert.equal(ublPoSuggestions('No amount provided').total,'');
assert.equal(ublPoSuggestions('Sales Tax 18.00').taxInclusive,false);
assert.equal(ublPoSuggestions('PO ID PO Date\nPOF123 31/02/26').orderDate,'');});
