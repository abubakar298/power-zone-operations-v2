import {materialDocumentPolicy} from './material-documents.js';

type Basis={siteId:string;installation:boolean|null;items:unknown[];customer:string};
type CatalogueItem={itemId:string;description:string;units:string[]};
export type PreparationRow={key:string;itemId:string;description:string;unit:string;out:string;sites:string[];basisLine?:number;fixedGroup?:'bess'|'panels'|'other';section?:'customer'|'internal';documentPolicyVersion?:2};
const qty=(v:unknown)=>/^\d{1,14}(?:\.\d{1,6})?$/.test(String(v??''))?String(v):'';
const countUnit=(value:string)=>/^(?:no\.?|nos\.?|each|pcs\.?|pieces?|units?)$/i.test(value.trim());
export function approvedEarthingBasis(value:any){return String(value.key??'').toUpperCase()==='CH-EARTHING'||/^Earthing Bore$/i.test(String(value.key??''))||/\bearthing bore\b/i.test(String(value.description??''));}
/** Seed from an approved basis without guessing aliases or converting power,
 * coils, lengths or pieces. Unresolved IDs remain visible for a decision. */
export function fixedPreparationRows(source:Basis,catalogue:CatalogueItem[],key:()=>string,aliases:Record<string,string>={}):PreparationRow[]{
 return source.items.flatMap((raw:any,basisLine:number)=>{
  const sourceKey=String(raw.key??'');
  const approvedId=catalogue.some(i=>i.itemId===sourceKey)?sourceKey:aliases[sourceKey]??sourceKey;
  const description=String(raw.description??catalogue.find(i=>i.itemId===approvedId)?.description??raw.key??''),unit=String(raw.unit??'');
  const approvedEarthing=approvedEarthingBasis(raw);
  const itemId=approvedEarthing?'CH-Earthing':approvedId;
  const policy=materialDocumentPolicy({itemId,description});
  const approvedFixed=approvedEarthing||/^CH-STRUCTURE\b/i.test(itemId)||/\b(?:solar|girder) structure\b/i.test(description);
  const service=!approvedFixed&&(/\b(?:installation|labou?r|project delivery|transportation|delivery charges?|genset synch)\b/i.test(description)||/^(?:project )?delivery$/i.test(description)||/^misc\.? accessories$/i.test(String(raw.key??description))||/^(?:job|jobs|service)$/i.test(unit));
  const bundled=/united bank|\bUBL\b/i.test(source.customer)&&itemId.toUpperCase()==='CH-SM-3P';
  if(service||bundled||policy.group==='non-stock'||(source.installation!==false&&policy.variableDispatch))return [];
  const stock=catalogue.find(i=>i.itemId===itemId),locked=policy.approvedQuantityLocked;
  const fixedGroup=/^(?:CH-)?(?:PCS|INV|HYB|BAT|BMS)[-\s]|\b(?:inverter|batter(?:y|ies)|BMS)\b/i.test(itemId+' '+description)?'bess':approvedFixed||/\b(?:solar (?:PV )?(?:panels?|plates?|modules?)|structure|earthing bore)\b/i.test(description)?'panels':'other';
  const countUnits=stock?.units.filter(countUnit)??[];
  const recognisedUnit=stock?.units.find(u=>u.toLowerCase()===unit.toLowerCase())??(countUnit(unit)&&countUnits.length===1?countUnits[0]:undefined);
  // A power figure is not a count of inverters or batteries. Require a reviewed
  // quantity instead of turning 20kW into 20 pieces or guessing a model rating.
  const physicalCountUnknown=/^(?:kW|kWh|kWp|W|Wp|Watt|Watts)$/i.test(unit);
  return [{key:key(),itemId:stock||locked?itemId:'',description,unit:locked?unit:recognisedUnit??'',out:physicalCountUnknown&&!locked?'':qty(raw.qty),sites:[source.siteId],fixedGroup,basisLine}];
 });
}

/** Prefill only explicitly approved variable materials. The quantity to dispatch
 * stays blank: approved allowance is not evidence that stock left a warehouse.
 * Different variants remain separate; matching pool rows share exact site IDs. */
export function variablePreparationRows(sources:Basis[],catalogue:CatalogueItem[],key:()=>string,aliases:Record<string,string>={}):PreparationRow[]{
 const grouped=new Map<string,PreparationRow>();
 for(const source of sources){
  if(source.installation===false)continue;
  source.items.forEach((raw:any,basisLine:number)=>{
   const sourceKey=String(raw.key??''),approvedId=catalogue.some(i=>i.itemId===sourceKey)?sourceKey:aliases[sourceKey]??sourceKey;
   const description=String(raw.description??catalogue.find(i=>i.itemId===approvedId)?.description??raw.key??'');
   const policy=materialDocumentPolicy({itemId:approvedId,description});
   if(!policy.variableDispatch)return;
   const stock=catalogue.find(i=>i.itemId===approvedId),unit=String(raw.unit??'');
   const recognised=stock?.units.find(u=>u.toLowerCase()===unit.toLowerCase())??(countUnit(unit)?stock?.units.find(countUnit):undefined);
   const row:PreparationRow={documentPolicyVersion:2,key:key(),itemId:stock?approvedId:'',description,unit:recognised??(stock?.units.length===1?stock.units[0]:''),out:'',sites:[source.siteId],...{section:policy.group==='internal-variable'?'internal':'customer'}};
   const identity=JSON.stringify([row.itemId||sourceKey,row.description,row.unit]);
   const prior=grouped.get(identity);
   if(prior){prior.sites=[...new Set([...prior.sites,source.siteId])];delete prior.basisLine;}else grouped.set(identity,row);
  });
 }
 return [...grouped.values()];
}
