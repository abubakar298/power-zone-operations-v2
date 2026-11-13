/// <reference path="../web/inventory-approved/legacy-helpers.d.ts" />
import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SiteIssuePrintDocuments,type IssueProject,type IssueRecord} from '../web/inventory-approved/SiteIssueDocument.js';
import {noFixedItemsText,variableGatePassTitle} from '../shared/delivery-order-split.js';

const project:IssueProject={id:'site',ipo:'IPO-1',site:'Test site',customer:'Test customer',deliveryAddress:'',installation:true,warehouse:'Lahore',lines:[]};
const record=(extras:IssueRecord['extras']):IssueRecord=>({number:'DO-1',project:'site',warehouse:'Lahore',date:'2026-11-13',expected:{},quantities:{},extras,recorded:false});

test('browser print: the Variable Material Gate Pass has its own title with gate and storekeeper copies only',()=>{
 const html=renderToStaticMarkup(React.createElement(SiteIssuePrintDocuments,{mode:'do',project,record:record([{id:'CH-CBL-16MM-AC',description:'16mm2 AC cable',quantity:'40',unit:'m'}]),variableGatePass:true}));
 assert.ok(html.includes(variableGatePassTitle));assert.match(html,/Gate copy/);assert.match(html,/Storekeeper copy/);assert.match(html,/16mm2 AC cable/);
 assert.doesNotMatch(html,/Customer receipt and signature|Customer handover confirmation|Delivery Order \/ Outwards Gate Pass/);
});

test('browser print: a DO with no fixed items keeps its four copies and explains where the variable items are',()=>{
 const html=renderToStaticMarkup(React.createElement(SiteIssuePrintDocuments,{mode:'do',project,record:record([]),emptyRowsText:noFixedItemsText}));
 assert.match(html,/Delivery Order \/ Outwards Gate Pass/);assert.match(html,/Customer receipt and signature/);
 assert.ok(html.includes(noFixedItemsText));
 const normal=renderToStaticMarkup(React.createElement(SiteIssuePrintDocuments,{mode:'do',project,record:record([{id:'CH-PCS-15KW',description:'15kW hybrid inverter',quantity:'1',unit:'Nos'}]),emptyRowsText:noFixedItemsText}));
 assert.ok(!normal.includes(noFixedItemsText));
});
