import {test} from 'node:test';import assert from 'node:assert/strict';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {quotationPayable} from '../shared/quotation-payable.js';
import {snapshotListMetadata} from '../server/documents/list-metadata.js';
import {CostingWorkflowHistory} from '../web/components/CostingWorkflowHistory.js';

// Tax Included quotation with the discount built into selling prices: the engine saves only a "Total" row.
const embedded={input:{discount:'5000',taxMode:'Tax Included'},footer:[{label:'Total',amount:'245000.00'}]};
const quotation=(snapshot:any)=>({id:'q1',number:'QT-1',created_at:'2026-11-26T08:00:00Z',workflow_status:'Approved',snapshot});
const history=(snapshot:any)=>renderToStaticMarkup(createElement(CostingWorkflowHistory,{review:{workflow_history:[]},quotation:quotation(snapshot)}));

test('payable reads Net Total, falls back to Total, and reports a missing amount as undefined',()=>{
 assert.equal(quotationPayable({footer:[{label:'Total',amount:'250000.00'},{label:'Special Discount',amount:'5000.00'},{label:'Net Total',amount:'245000.00'}]}),'245000.00');
 assert.equal(quotationPayable(embedded),'245000.00');
 for(const snapshot of [undefined,{},{footer:[]},{footer:[{label:'Subtotal Before Tax',amount:'1'}]},{footer:[{label:'Net Total',amount:''}]}])assert.equal(quotationPayable(snapshot),undefined);
});

test('quotation review history opens without a Net Total row and shows what is missing instead of crashing',()=>{
 assert.match(history(embedded),/245,000\.00/);
 assert.match(history({input:{},footer:[]}),/Not recorded/);
 assert.match(history({}),/Not recorded/);
});

test('Ready to Send list shows the amount of a Tax Included quotation with the discount built into prices',()=>{
 assert.equal(snapshotListMetadata(embedded,'direct-product').documentAmount,'245000.00');
 assert.equal(snapshotListMetadata(embedded,'direct-product').solutionType,'Direct Sale');
});
