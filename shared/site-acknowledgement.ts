import {Decimal} from 'decimal.js';
/** Customer-print allowlist. No prices, serials, private contacts or completion claims. */
export type SiteAcknowledgement={siteId:string;reference:string;customer:string;site:string;ipo:string;customerPo:string;orderNumber:string;address:string;contact:string;phone:string;inverter:string;battery:string;panels:string;installation:boolean|null};
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const positive=(v:unknown)=>typeof v==='number'||typeof v==='string'?Number(v)>0:false;
const equipmentText=(row:any)=>[row.specification,row.description,row.itemId,row.key].map(text).join(' ');
function basicInverters(lines:any[]){
 const groups=new Map<string,Decimal>();
 for(const row of lines){const id=text(row.itemId)||text(row.key),words=equipmentText(row);if(!positive(row.qty??row.out)||row.phase==='EPC'||/^(?:CH-)?(?:BAT|BMS)/i.test(id)||/installation|labou?r|commissioning/i.test(text(row.description))||!/inverter|\bups\b|^(?:CH-)?(?:PCS|INV|HYB)[-\s]/i.test(id+' '+words))continue;
 const rating=words.match(/(\d+(?:\.\d+)?)\s*(kW|kVA)\b/i),type=/hybrid|\bHYB[-\s]/i.test(words)?'Hybrid Inverter':/\bUPS\b/i.test(words)&&!/inverter/i.test(words)?'UPS':'Inverter';
 const label=[rating?new Decimal(rating[1]).toString()+' '+(rating[2].toLowerCase()==='kw'?'kW':'kVA'):'',type].filter(Boolean).join(' ');groups.set(label,(groups.get(label)??new Decimal(0)).plus(row.qty??row.out));
 }
 return [...groups].map(([label,qty])=>qty.toString()+' x '+label).join('; ');
}
function basicBatteries(lines:any[]){
 const groups=new Map<string,Decimal>();
 for(const row of lines){const id=text(row.itemId)||text(row.key),words=equipmentText(row);if(!positive(row.qty??row.out)||row.phase==='EPC'||/^(?:CH-)?(?:BMS|INV|HYB|PCS)/i.test(id)||!/batter(?:y|ies)|^(?:CH-)?BAT[-\s]/i.test(id+' '+words)||/installation|labou?r|commissioning/i.test(text(row.description)))continue;
 const unit=text(row.unit),capacity=words.match(/(\d+(?:\.\d+)?)\s*kWh\b/i)??id.match(/(?:BAT[-\s](?:HV|LV)[-\s])?(\d+(?:\.\d+)?)\s*KW\b/i);
 if(!/^kwh$/i.test(unit)&&!capacity)continue;
 const total=new Decimal(row.qty??row.out).mul(/^kwh$/i.test(unit)?1:capacity![1]),voltage=/\bHV\b|high[- ]voltage/i.test(words)?'HV':/\bLV\b|low[- ]voltage/i.test(words)?'LV':'';
 groups.set(voltage,(groups.get(voltage)??new Decimal(0)).plus(total));
 }
 return [...groups].map(([voltage,capacity])=>capacity.toString()+' kWh of '+(voltage?voltage+' ':'')+'Batteries').join('; ');
}
type AcknowledgementRecord={id?:string;number:string;snapshot:{sites:any[];lines:any[]}};
const panelLine=(row:any)=>{const words=[row.itemId,row.key,row.description].map(text).join(' ');return !/structure|mounting|earthing|breaker|cable|box|cabinet|meter|labou?r|installation/i.test(words)&&/solar(?: pv)? (?:panels?|plates?|modules?)|\bPV\s*(?:panels?|modules?)/i.test(words);};
/** Only saved DO quantities with an exact single-site allocation. Pooled quantities are never divided or copied. */
export function issuedPanelLinesBySite(records:AcknowledgementRecord[]){
 const result=new Map<string,any[]>(),seen=new Set<string>();
 for(const record of records)for(const [index,row] of record.snapshot.lines.entries()){
  if(!panelLine(row)||!positive(row.out??row.qty))continue;
  const allocated=Array.isArray(row.sites)?row.sites:record.snapshot.sites.length===1?[record.snapshot.sites[0].siteId]:[];
  if(allocated.length!==1||!record.snapshot.sites.some(site=>site.siteId===allocated[0]))continue;
  const identity=(record.id??record.number)+'|'+(row.key??index);if(seen.has(identity))continue;seen.add(identity);
  result.set(allocated[0],[...(result.get(allocated[0])??[]),row]);
 }
 return result;
}
function issuedPanels(rows:any[],source:any){
 let watts=new Decimal(0),unknown=false;
 for(const row of rows){const qty=new Decimal(row.out??row.qty),unit=text(row.unit);if(/^(?:w|wp|watts?)$/i.test(unit))watts=watts.plus(qty);else if(/^(?:kw|kwp)$/i.test(unit))watts=watts.plus(qty.mul(1000));else if(/^(?:nos?\.?|pcs?\.?|pieces?|panels?|modules?)$/i.test(unit)){
  const rating=equipmentText(row).match(/(\d+(?:\.\d+)?)\s*W(?:p|att(?:s)?)?\b/i)?.[1]??source?.boq?.survey?.panelWattage;
  if(rating&&positive(rating))watts=watts.plus(qty.mul(rating));else unknown=true;
 }else unknown=true;}
 return unknown?'Panel wattage not recorded on issued DO':watts.gt(0)?watts.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+' W of Solar Panels':'';
}
export function siteAcknowledgementModels(record:AcknowledgementRecord,ipos:ReadonlyMap<string,any>,actualPanels=issuedPanelLinesBySite([record])):SiteAcknowledgement[]{
 const seen=new Set<string>();
 return record.snapshot.sites.flatMap(site=>{
  if(!site.siteId||seen.has(site.siteId))return [];seen.add(site.siteId);
  const source=ipos.get(site.siteId),s=source?.snapshot??{},input=s.input??{};
  // Every product is from this site's exact IPO/BOQ. Parent pooled material is never treated as a site's installed system.
  const lines=Array.isArray(source?.boq?.lines)?source.boq.lines:record.snapshot.sites.length===1?record.snapshot.lines:[];
  return [{siteId:site.siteId,reference:record.number,customer:text(site.customer)||text(s.customer?.name),site:text(site.siteName)||text(s.siteName),ipo:text(site.ipo)||text(source?.number),customerPo:text(site.customerPo)||text(input.poNumber),orderNumber:text(site.orderNumber)||text(input.orderNumber),address:text(input.deliveryAddress),contact:text(input.siteContact)||text(input.contactPerson),phone:text(input.sitePhone)||text(input.phone),inverter:basicInverters(lines),battery:basicBatteries(lines),panels:issuedPanels(actualPanels.get(site.siteId)??[],source),installation:typeof site.installation==='boolean'?site.installation:null}];
 });
}
