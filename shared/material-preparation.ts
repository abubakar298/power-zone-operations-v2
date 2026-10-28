import {materialDocumentPolicy} from './material-documents.js';

type Basis={siteId:string;installation:boolean|null;items:unknown[];customer:string};
type CatalogueItem={itemId:string;description:string;units:string[]};
export type PreparationRow={key:string;itemId:string;description:string;unit:string;out:string;sites:string[];basisLine?:number;fixedGroup?:'bess'|'panels'|'other';section?:'customer'|'internal'};
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
