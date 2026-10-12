import type { CostLine, Masters } from '../boq/engine.js';
import type { Survey } from '../boq/schema.js';
export interface CatalogueItem { item_id:string;version:number;rate_key:string|null;payload:{itemId:string;technicalDescription:string;commercialDescription:string;category:string;itemGroup:string;brandCategory:string;unit:string;itemType:string;status:string;reviewNotes:string} }
export interface EngineeringProfile { key:string;version:number;payload:Record<string,any> }
export function standardProfile(m:Masters) { return m.engineeringProfiles?.find(p=>p.key==='standard-installation')?.payload; }
export function bankUpsProfile(m:Masters,customer:string,batteryKwh:number) {
 return m.engineeringProfiles?.find(p=>p.key===`${customer}-UPS-6-${batteryKwh}`);
}
const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
export function selectCatalogueItem(m:Masters,key:string,brand:string,panelWatts?:string):CatalogueItem|undefined {
 const rateKey=key==='6mm² DC Cable Black'?'6mm² DC Cable Red':key;
 let candidates=(m.catalogue??[]).filter(i=>i.rate_key===rateKey);
 if(key.startsWith('Structure -'))return m.catalogue?.find(i=>i.item_id==='CH-Structure');
 if(key==='Solar PV Modules')candidates=(m.catalogue??[]).filter(i=>i.payload.itemGroup==='Solar Panels'||i.payload.category==='Solar PV Modules').filter(i=>new RegExp(`(?:^|\\D)${panelWatts}(?:\\D|$)`).test(i.payload.technicalDescription+' '+i.item_id));
 if(!candidates.length)return;
 const group=candidates[0].payload.itemGroup;
 if(group==='Cables'){
  const target=/^(Any of the Above|General|All other cables|All Other Brands)$/i.test(brand)?'All other cables':brand;
  candidates=candidates.filter(i=>normalize(i.payload.brandCategory)===normalize(target));
  // Generic combined IDs are preferred over separate historical colour IDs.
  return candidates.find(i=>/RB/.test(i.item_id))??candidates.find(i=>!/-[RB]$/.test(i.item_id))??candidates[0];
 }
 if(key==='Solar PV Modules'){
  if(/Any of the Above|General/i.test(brand))return candidates.find(i=>i.payload.brandCategory==='Unconfirmed');
  return candidates.find(i=>normalize(i.payload.brandCategory).startsWith(normalize(brand)));
 }
 if(group==='AC Switchgear'||group==='DC Switchgear'){
  // The rotary changeover's confirmed OPAL make is fixed; global switchgear choice does not relabel it CHINT.
  if(key==='100A Rotary Changeover with Box')return candidates.find(i=>i.payload.brandCategory==='OPAL');
  return candidates.find(i=>/Any of the Above|General/i.test(brand)||normalize(i.payload.brandCategory)===normalize(brand));
 }
 return candidates.find(i=>!brand||/Any of the Above|General/i.test(brand)||normalize(i.payload.brandCategory)===normalize(brand))
  ?? (candidates.length===1 && /Chint/i.test(brand) && candidates[0].payload.brandCategory==='Chint Power'?candidates[0]:undefined);
}
export function identifyLines(m:Masters,lines:CostLine[],survey:Survey,warnings:string[]) {
 if(!m.catalogue?.length)return;
 for(const line of lines){
  const item=selectCatalogueItem(m,line.key,line.brand,survey.panelWattage);
  if(line.itemId){line.rateKey=line.key;const existing=m.catalogue.find(i=>i.item_id===line.itemId);if(existing?.payload.itemGroup==='Cables')line.unit='MTRS';continue;}
  if(item){line.itemId=item.item_id;line.itemVersion=item.version;line.stockBrand=item.payload.brandCategory;line.rateKey=line.key;if(!survey.specifications?.[line.key]){line.specification=item.payload.technicalDescription;line.specVersion=item.version;}line.costingCategory=item.payload.category;if(item.payload.itemGroup==='Cables')line.unit='MTRS';}
  else if((m.catalogue??[]).some(i=>i.rate_key===line.key)||/Cable|Solar PV Modules/.test(line.key))warnings.push(`${line.key}: no confirmed PT Item ID for ${line.brand||'selected specification'}; stock selection needs review.`);
  if(line.key==='6mm² DC Cable Red')line.colour='Red';
  if(line.key==='6mm² DC Cable Black')line.colour='Black';
 }
}
