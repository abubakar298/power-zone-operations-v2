import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {registerHooks} from 'node:module';
import {sharedOrderLabel,splitSharedOrder,sortSharedIpos} from '../shared/shared-ipo-order.js';

// Components pull in stylesheets and Vite '?url' assets, which Node cannot load; they are empty modules here.
registerHooks({load:(url,context,next)=>(url.endsWith('.css')||url.endsWith('?url'))?{format:'module',source:"export default ''",shortCircuit:true}:next(url,context)});
const {IposSharedList}=await import('../web/components/IposSharedList.js');

// The IPO saves the bank order as one text "213/250": the permanent running order number and the
// IPO's target site count. They are different values (orders can exceed the target when some are
// cancelled), so the portal shows them separately instead of as a progress fraction.
test('the saved order text is read as Order No. and Target Sites',()=>{
 assert.deepEqual(splitSharedOrder('213/250'),{orderNo:'213',target:'250'});
 assert.deepEqual(splitSharedOrder(' 257 / 250 '),{orderNo:'257',target:'250'},'an order number above the target is kept as it is');
 assert.deepEqual(splitSharedOrder('7'),{orderNo:'7',target:null});
 assert.equal(splitSharedOrder(''),null);assert.equal(splitSharedOrder(null),null);
 assert.equal(sharedOrderLabel('213/250'),'Order No. 213 · Target Sites 250');
 assert.equal(sharedOrderLabel('7'),'Order No. 7');
 assert.equal(sharedOrderLabel('Order A'),'Order A','text that is not a number pair is shown unchanged');
});

test('IPOs Shared sorting by order number is unchanged',()=>{
 const rows=[{data:{ipoNumber:'CHP-163',sharedOrderNumber:'9/250'}},{data:{ipoNumber:'CHP-163',sharedOrderNumber:'213/250'}},{data:{ipoNumber:'CHP-163',sharedOrderNumber:'40/250'}}];
 assert.deepEqual(sortSharedIpos(rows).map(r=>r.data.sharedOrderNumber),['213/250','40/250','9/250']);
});

test('IPOs Shared shows Order No., Target Sites and the salesperson, never "213/250"',()=>{
 const record={id:'r1',customer:'United Bank Limited',customerCode:'UBL',site:'UBL Bihar Colony, Karachi Region',siteCode:'1233',stage:'issued',
  data:{ipoShared:true,ipoId:'i1',ipoNumber:'CHP-163',sharedOrderNumber:'213/250',ipoSalesPerson:'Waqas ul Haq',sharedPoReference:'POF262712880',sharedPoDate:'2026-10-28'}};
 const html=renderToStaticMarkup(React.createElement(IposSharedList,{records:[record],onPreview:()=>{}}));
 assert.match(html,/Order No\. 213 · Target Sites 250/);
 assert.doesNotMatch(html,/213\/250/);
 assert.match(html,/Salesperson: Waqas ul Haq/);
 const noSales=renderToStaticMarkup(React.createElement(IposSharedList,{records:[{...record,data:{...record.data,ipoSalesPerson:null,sharedOrderNumber:null}}],onPreview:()=>{}}));
 assert.doesNotMatch(noSales,/Salesperson|Order No\./,'nothing extra when the IPO has no order or salesperson');
});
