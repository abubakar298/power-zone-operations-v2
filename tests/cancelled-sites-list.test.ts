import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {registerHooks} from 'node:module';

// The list can open the project page, which pulls in stylesheets and Vite '?url' assets; they are empty modules here.
registerHooks({load:(url,context,next)=>(url.endsWith('.css')||url.endsWith('?url'))?{format:'module',source:"export default ''",shortCircuit:true}:next(url,context)});
const {CancelledSitesTable,FreeSlotsPanel}=await import('../web/components/CancelledSitesList.js');

const base={customer:'UBL',ipo:'CHP-163',po:'',recordId:null,projectKey:null,cancelledBy:null,reason:'',reusedBy:null,source:'Reviewed register' as const,outcome:'Cancelled' as const};
const sites=[
 {...base,id:'a',sr:1,order:'154/250',site:'Naseerabad Branch, Rawalpindi',siteCode:'',cancelledAt:'2026-10-26',slot:'In use again' as const,reusedBy:{site:'Renewed Naseerabad Branch',siteCode:'1154'}},
 {...base,id:'b',sr:2,order:'19/250',site:'CANTT, Multan',siteCode:'0019',po:'POF1',cancelledAt:'2026-11-21T08:00:00.000Z',source:'Operations' as const,cancelledBy:'Moaz',reason:'Customer said cancel for now',recordId:'record-b',projectKey:'["1","0019"]',slot:'Free' as const},
];

test('Cancelled Sites lists SR# from 1, the slot each site was cancelled from, and keeps its documents reachable',()=>{
 const html=renderToStaticMarkup(React.createElement(CancelledSitesTable,{sites,onOpenRecord:()=>undefined,onOpenProject:()=>undefined}));
 assert.match(html,/<th scope="col">SR#<\/th>/);
 assert.match(html,/<td>1<\/td>[\s\S]*Cancelled from 154\/250[\s\S]*<td>2<\/td>[\s\S]*Cancelled from 19\/250/);
 assert.match(html,/2 cancelled sites/);
 assert.match(html,/Now used by Renewed Naseerabad Branch \(1154\)/);
 assert.match(html,/Cancelled by Moaz · Customer said cancel for now/);
 assert.match(html,/Open IPO/);assert.match(html,/Project file/);
 assert.match(html,/Historical register order; no portal documents/);
 // Main items stay on their own line; descriptions sit underneath them (AGENTS.md alignment rule).
 assert.match(html,/<td>Naseerabad Branch, Rawalpindi<div class="pz-caption">Not entered<\/div><\/td>/);
});

test('free slots show the count and the slot numbers as short ranges',()=>{
 const html=renderToStaticMarkup(React.createElement(FreeSlotsPanel,{programmes:[{key:'UBL|CHP-163|250',customer:'UBL',ipo:'CHP-163',capacity:250,extra:0,inUse:246,freeCount:4,free:[19,21,22,250]}]}));
 assert.match(html,/Free order slots/);
 assert.match(html,/<td>250<\/td><td>246<\/td><td><strong>4<\/strong><\/td><td>19, 21–22, 250<\/td>/);
 assert.equal(renderToStaticMarkup(React.createElement(FreeSlotsPanel,{programmes:[]})),'');
});
