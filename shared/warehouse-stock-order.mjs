// Director's warehouse order: equipment, cables by family/brand/colour, switchgear, then miscellaneous.
export const stockSections=['LV Systems','HV Systems','C&I Cabinets','Solar Panels','DC Cables','Communication Cables','Earthing Cables','AC Cables','AC Switchgear','DC Switchgear','BESS Accessories','General Items'];
export function stockSection(variant,itemId,description){
 if(variant==='Cabinet accessories')return 'BESS Accessories';
 if(variant==='LV system')return 'LV Systems';
 if(variant==='HV system')return 'HV Systems';
 if(/bess|C&I.*cabinet|CNI.*cabinet/i.test(`${itemId} ${description}`))return 'C&I Cabinets';
 if(variant==='Cabinet accessories')return 'BESS Accessories';
 if(variant==='Solar panels')return 'Solar Panels';
 if(variant==='DC cables')return 'DC Cables';
 if(variant==='Communication cables')return 'Communication Cables';
 if(variant==='Earthing cables')return 'Earthing Cables';
 if(variant==='AC cables')return 'AC Cables';
 if(['AC switchgear','DB boxes'].includes(variant))return 'AC Switchgear';
 if(variant==='DC switchgear')return 'DC Switchgear';
 return 'General Items';
}
const rank=new Map(stockSections.map((s,i)=>[s,i]));
const text=r=>`${r.itemId||r.id||''} ${r.description||''}`;
const id=r=>r.itemId||r.id||'';
const power=r=>Number(id(r).match(/PCS.*-(\d{3})$/i)?.[1]||text(r).match(/(\d+(?:\.\d+)?)\s*(?:KW|KWH)/i)?.[1]||0);
const bess=r=>/PCS|HYB|inverter(?! battery)/i.test(text(r))?0:/BAT|battery/i.test(text(r))?1:/BMS/i.test(text(r))?2:3;
const voltage=r=>/\bLV\b|[- ]LV[- ]|low.voltage/i.test(text(r))?0:/\bHV\b|[- ]HV[- ]|high.voltage/i.test(text(r))?1:2;
const gear=r=>r.variant==='DB boxes'||/\bbox\b/i.test(text(r))?8:/FUSEH|holder/i.test(text(r))?4:/BRK|MCCB|MCB|ACB|breaker/i.test(text(r))?0:/CHG|change.?over/i.test(text(r))?1:/contactor|CH-MC-/i.test(text(r))?2:/FUSE(?!H)|\bfuse\b/i.test(text(r))?3:/FUSEH|holder/i.test(text(r))?4:/SPD/i.test(text(r))?5:/VPD/i.test(text(r))?6:/SM-|meter/i.test(text(r))?7:8;
const amps=r=>Number(text(r).match(/(\d+)\s*A\b/i)?.[1]||0);
const poles=r=>Number(text(r).match(/(\d)\s*P\b/i)?.[1]||0);
function cable(r){const key=id(r);const colour=key.match(/-(R|B)\/(PK|LCL)$/i);return {family:colour?key.slice(0,colour.index):key,size:Number(key.match(/(\d+(?:\.\d+)?)MM/i)?.[1]||0),cores:Number(key.match(/\/(\d)C/i)?.[1]||0),source:colour?colour[2].toUpperCase()==='PK'?0:1: /\/PK$/i.test(key)?0: /\/LCL$/i.test(key)?1:2,colour:colour?colour[1].toUpperCase()==='R'?0:1:0};}
export function compareStockItems(a,b){
 const sectionA=a.section||stockSection(a.variant||'',id(a),a.description||''),sectionB=b.section||stockSection(b.variant||'',id(b),b.description||'');
 let n=(rank.get(sectionA)??99)-(rank.get(sectionB)??99);if(n)return n;
 if(['LV Systems','HV Systems'].includes(sectionA)){n=bess(a)-bess(b);if(n)return n;n=bess(a)===0?power(a)-power(b):voltage(a)-voltage(b);if(n)return n;}
 if(['DC Cables','Communication Cables','Earthing Cables','AC Cables'].includes(sectionA)){
  const ca=cable(a),cb=cable(b);
  n=(a.variant==='Communication cables'?1:0)-(b.variant==='Communication cables'?1:0);if(n)return n;
  if(sectionA==='AC Cables'){n=(ca.cores===1?0:ca.cores===4?1:2)-(cb.cores===1?0:cb.cores===4?1:2);if(n)return n;}
  n=ca.size-cb.size;if(n)return n;n=ca.family.localeCompare(cb.family,undefined,{numeric:true});if(n)return n;n=ca.source-cb.source;if(n)return n;n=ca.colour-cb.colour;if(n)return n;
 }
 if(['AC Switchgear','DC Switchgear'].includes(sectionA)){n=gear(a)-gear(b);if(n)return n;n=amps(a)-amps(b);if(n)return n;n=poles(a)-poles(b);if(n)return n;}
 return id(a).localeCompare(id(b),undefined,{numeric:true});
}
