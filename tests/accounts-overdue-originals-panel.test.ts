import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {registerHooks} from 'node:module';

// The component pulls in a stylesheet and Vite '?url' assets, which Node cannot load; they are empty modules here.
registerHooks({load:(url,context,next)=>(url.endsWith('.css')||url.endsWith('?url'))?{format:'module',source:"export default ''",shortCircuit:true}:next(url,context)});
const {OverdueOriginals}=await import('../web/components/AccountsOriginals.js');

const overdueSite={id:'s1',name:'Musa Khail Branch, Mianwali',customer:'UBL',ipo:'CHP-163',originals:{startDate:'2026-11-06',startBasis:'Job Completion Date (QC)',missingStartDate:false,overdue:[{key:'d1:VSO',type:'VSO',batchLabel:'Acknowledgement & variable sign-off',location:'Received at Karachi office',status:'karachi-pending',daysOverdue:4,tracking:'',carrier:''}]}};
const noDateSite=(n:number)=>({id:'m'+n,name:'No Date Branch '+n,customer:'UBL',ipo:'CHP-'+n,originals:{startDate:null,startBasis:'Job Completion Date (QC)',missingStartDate:true,overdue:[]}});
const render=(sites:any[])=>renderToStaticMarkup(React.createElement(OverdueOriginals,{sites}));

test('the overdue originals table is unchanged',()=>{
 const html=render([overdueSite]);
 assert.match(html,/Overdue physical originals/);assert.match(html,/Musa Khail Branch, Mianwali/);assert.match(html,/4 days/);assert.match(html,/Accounts confirmation pending/);assert.match(html,/1 original</);
});

test('the long list of sites without a completion or final delivery date is no longer shown',()=>{
 const html=render([overdueSite,noDateSite(1),noDateSite(2)]);
 assert.match(html,/Musa Khail Branch, Mianwali/);
 assert.doesNotMatch(html,/No Date Branch|no deadline is set/);
 assert.equal(render([noDateSite(1),noDateSite(2)]),'','With nothing overdue the panel stays hidden.');
});
