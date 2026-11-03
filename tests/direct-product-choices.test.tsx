import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {DirectProductFields} from '../web/components/DirectProductFields.js';

const items=Array.from({length:23},(_,i)=>({key:'P'+String(i).padStart(2,'0'),display_name:'Product '+String(i).padStart(2,'0'),status:'Active',unit:'No',approved_specification:'Fixture'}));
const masters={items:[...items,{key:'Labour - Installation',status:'Active',unit:'Job'},{key:'Old item',status:'Inactive',unit:'No'}],brands:[]};

test('Direct Product Sale lists every active product in the dropdown, not only the first ten',()=>{
 const html=renderToStaticMarkup(<DirectProductFields masters={masters} initial={undefined}/>);
 const values=[...html.matchAll(/<option value="(P\d\d)"/g)].map(m=>m[1]);
 assert.deepEqual(values,items.map(i=>i.key),'all 23 active products are choices');
 assert.doesNotMatch(html,/Labour - Installation|Old item/,'services and inactive items stay excluded');
 assert.doesNotMatch(html,/choices pages/,'no hidden page controls');
});
