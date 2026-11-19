import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {groupProducts,productHeading,productHeadings} from '../web/components/product-headings.js';
import {DirectProductFields} from '../web/components/DirectProductFields.js';

// Real product keys and names from the item master (migrations), as Coordination sees them.
const expected:Record<string,[string,string][]>={
 'Inverters':[['HYB-SP-006','HYB-SP-006'],['HYB-3P-010','HYB-3P-010'],['CH-PCS-On Grid-10KW','Inverter On Grid PCS-3P 10-KW'],['CH-PCS-HYB-3P-12-SXL','Sinexcel Sinexel Isuna D12K-TL-S']],
 'Batteries & BMS':[['BAT-HV-05 KW WO BMS','BAT-HV-05 KW WO BMS'],['BAT-LV-05 KW WO BMS','BAT-LV-05 KW WO BMS'],['CH-BMS-HV','CH-BMS-HV'],['CH-BMS-LV','CH-BMS-LV']],
 'Solar panels':[['Solar PV Modules','Solar PV Modules'],['CH-Solar Plates 585W','Brand to be confirmed 585 W Solar PV Modules'],['CH-Solar Plate J590','Jinko 590 N-Type Bi-Facial Tier 1 Solar Modules']],
 'Breakers':[['100A 4P MCCB','100A 4P MCCB'],['32A 2P MCB','32A 2P MCB'],['63A 4P MCB','63A 4P MCB'],['500V 2P DC Breaker','500V 2P DC Breaker'],['DC Breaker','DC Breaker'],['CH-BRK-AC-63A/3P-MCC','CHINT 63A 3 Pole Breaker MCCB'],['CH-BRK-DC-32A/2P','CHINT 32A DC Breaker 500V'],['technical-13','Inverter Output Breaker'],['technical-12','Grid Input Breaker']],
 'Fuses':[['DC Fuse with Holder','DC Fuse with Holder'],['CH-DC Fuse 20-AMP','CHINT Fuse 20-AMP'],['CH-FUSEH-1P-25A','CHINT Pilot 1P Fuse Holder 25A']],
 'Changeovers':[['32A 2P Breaker Changeover','32A 2P Breaker Changeover'],['100A Rotary Changeover with Box','100A Rotary Changeover with Box'],['CH-CHG-63A/2P','CHINT 63A 2P Changeover'],['CH-CHG-2P-INT','CHINT 2P Changover Interlock'],['CH-CHG-BOX','Change Over Rotary Box'],['technical-15','Changeover Switch']],
 'Surge protection (SPD)':[['AC SPD','AC SPD'],['DC SPD','DC SPD'],['63A 1P AC VPD','63A 1P AC VPD'],['CH-SPD-AC-2P','CHINT AC SPD 2P']],
 'Contactors':[['CH-Contactor 95A 4P','CHINT Magnetic Contactor 95A 4P'],['CH-MC-630A/4P-SND','CHINT 630A 4-pole contactor with auxiliary contacts']],
 'Cables':[['10mm² 1C AC Cable','10mm² 1C AC Cable'],['6mm² DC Cable Red','6mm² DC Cable Red'],['2.5mm² Earthing Cable','2.5mm² Earthing Cable'],['CH-CBL-CAT6','CAT 6 network cable'],['CH-Cable Earth-4mm','Cable Earth 4mm 1/C'],['technical-11','DC Cable for Battery Bank'],['technical-24','Earth Cables (Inverter/AC Combiner box to AC Earth Pit)']],
 'DB boxes & enclosures':[['AC & DC Boxes','AC & DC Boxes'],['CH-DB Box 14x20','DB Box 14x20'],['CH-18 Way Box','18 Way DB Box'],['CH-8 Way Box','8 Way Breakerl Box'],['CH-DB-14x20','Kashif White Box'],['CH-DB Box Solar','CH-DB Box Solar'],['CH-SOLAR BOX-18x24','DB Solar Box 18x24'],['SP DC Enclosures','SP DC Enclosures'],['technical-20','AC Combiner Box'],['technical-05','PV String Combiner Box (Rooftop)']],
 'Smart meters':[['Extra Smart Meter','Extra Smart Meter'],['CH-SM-1P','1P Smart Meter'],['CH-SM-3P','3 Phase smart Meter']],
 'C&I BESS parts':[['CH-C&I Cabinet EMS','C&I Cabinet EMS'],['CH-CAB-SM','Cabinet Smart Meters'],['CH-CNI-125-261','Chint Power Cabinet']],
 'Other materials':[['technical-08','Cable Glands / Termination Kits'],['technical-09','Cable Pipe / Conduit'],['technical-10','MC4 Connectors (Male/Female)'],['CH-Pvc Pipe 1.5 Inch','Pvc Pipe 1.5 Inch'],['CH-Mix Items All','Mix Small Items All Types'],['technical-21','Earthing Pit with Copper Bonded Electrode'],['Genset Synchronisation with Battery SOC','Genset Synchronisation with Battery SOC']],
};

test('each product in the picker falls under the heading Coordination expects',()=>{
 for(const [heading,items] of Object.entries(expected))for(const [key,display_name] of items)
  assert.equal(productHeading({key,display_name}),heading,`${display_name} (${key})`);
 assert.deepEqual(Object.keys(expected),[...productHeadings],'every heading is covered, in picker order');
});

test('products are grouped in heading order, with sizes sorted 6mm² before 10mm² before 25mm²',()=>{
 const items=[{key:'25mm² 4C AC Cable'},{key:'HYB-3P-010'},{key:'10mm² 1C AC Cable'},{key:'6mm² DC Cable Red'},{key:'Unknown thing'}];
 assert.deepEqual(groupProducts(items).map(g=>[g.heading,g.items.map(i=>i.key)]),[
  ['Inverters',['HYB-3P-010']],
  ['Cables',['6mm² DC Cable Red','10mm² 1C AC Cable','25mm² 4C AC Cable']],
  ['Other materials',['Unknown thing']],
 ]);
});

const masters={brands:[],items:[
 {key:'HYB-3P-010',display_name:'HYB-3P-010',status:'Active',unit:'No.'},
 {key:'6mm² DC Cable Red',display_name:'6mm² DC Cable Red',status:'Active',unit:'m'},
 {key:'32A 2P MCB',display_name:'32A 2P MCB',status:'Active',unit:'Each'},
 {key:'Old cable',display_name:'Old cable',status:'Inactive',unit:'m'},
]};

test('the picker offers a heading drop-down and lists products under their headings',()=>{
 const html=renderToStaticMarkup(<DirectProductFields masters={masters} initial={undefined}/>);
 const heading=html.match(/aria-label="Product 1 heading"[^>]*>(.*?)<\/select>/)?.[1]??'';
 assert.deepEqual([...heading.matchAll(/<option value="([^"]*)"/g)].map(m=>m[1]),['','Inverters','Breakers','Cables'],'All headings, then only headings that have products');
 assert.match(heading,/All headings/);
 assert.match(html,/<optgroup label="Inverters"><option value="HYB-3P-010">/);
 assert.match(html,/<optgroup label="Breakers"><option value="32A 2P MCB">/);
 assert.doesNotMatch(html,/Old cable/,'inactive products stay out');
 assert.match(html,/name="directProducts" value="\[\{&quot;kind&quot;:&quot;item&quot;,&quot;key&quot;:&quot;&quot;,&quot;qty&quot;:&quot;1&quot;\}\]"/,'the saved selection has no heading in it');
});

test('a saved product opens with its own heading chosen and only that heading listed',()=>{
 const html=renderToStaticMarkup(<DirectProductFields masters={masters} initial={[{kind:'item',key:'6mm² DC Cable Red',qty:'40'}]}/>);
 assert.match(html,/<option value="Cables" selected="">Cables \(1\)<\/option>/);
 const product=html.match(/aria-label="Product 1" required=""[^>]*>(.*?)<\/select>/)?.[1]??'';
 assert.deepEqual([...product.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),['6mm² DC Cable Red']);
});

test('Complete BESS ID rows have no product heading',()=>{
 const html=renderToStaticMarkup(<DirectProductFields masters={masters} initial={[{kind:'bess',key:'',qty:'1'}]}/>);
 assert.doesNotMatch(html,/Product 1 heading/);
});
