import {Decimal} from 'decimal.js';
import type {BoqSnapshot} from '../boq/engine.js';
import type {QuoteLine} from './engine.js';

type Item = {description:string;unit:string;qty:string};
const acKeys = new Set(['63A 4P MCB','100A 4P MCCB','100A Rotary Changeover with Box','AC SPD','AC & DC Boxes','63A 2P MCB','32A 2P MCB','32A 2P Breaker Changeover','63A 1P AC VPD','SP AC Conduit Accessories and Box']);
const dcKeys = new Set(['DC Breaker','500V 2P DC Breaker','DC SPD','DC Fuse with Holder','SP DC Enclosures']);
export const earthingScopeDescription = 'Earthing Bore — Target earth resistance: 1–5 ohms, subject to site conditions';

/** New quotation scope only. Never changes BOQ quantities, classifications or selling amounts. */
export function customerScopeItems(boq:BoqSnapshot, sources:BoqSnapshot['lines']):Item[] {
  const output:Item[]=[];
  const protection=(side:'AC'|'DC',keys:Set<string>)=>{
    const present=sources.filter(l=>keys.has(l.key)&&new Decimal(l.qty).gt(0));
    if(!present.length)return;
    const parts:string[]=[];
    if(present.some(l=>/MCB|MCCB|Breaker/.test(l.key)&&!/Changeover/.test(l.key)))parts.push('breakers');
    if(present.some(l=>/SPD/.test(l.key)))parts.push('SPD');
    if(present.some(l=>/Changeover/.test(l.key)))parts.push('changeover');
    if(present.some(l=>/VPD/.test(l.key)))parts.push('VPD');
    if(present.some(l=>/Fuse/.test(l.key)))parts.push('fuses and holders');
    if(present.some(l=>/Box|Boxes|Enclosures/.test(l.key)))parts.push('enclosures and accessories');
    output.push({description:`${side} Protection Box (${parts.join(', ')})`,unit:'Set',qty:'1'});
  };
  for(const l of sources){
    if(!new Decimal(l.qty).gt(0)||acKeys.has(l.key)||dcKeys.has(l.key))continue;
    if(/^(10mm² 1C|16mm² 4C|25mm² 4C) AC Cable$/.test(l.key)){
      const total=new Decimal(l.qty),s=boq.survey,dual=boq.inverterConfig.quantity===2;
      let inverter:Decimal;
      if(l.key==='10mm² 1C AC Cable'){
        const saved=l.description.match(/Inverter termination \((\d+(?:\.\d+)?) m\)/);
        inverter=new Decimal(saved?.[1]??s.spInverterTerminationMetres??'20');
      }else if(s.sourceMode==='General quotation'||s.acTerminationMode==='Fixed'){
        inverter=new Decimal(l.key==='25mm² 4C AC Cable'?'0':dual?'15':'10');
      }else inverter=new Decimal(l.key==='25mm² 4C AC Cable'?s.acInverter25??'0':s.acInverter16??'0');
      // Use the frozen total. Never invent extra conductor quantities when reading older inputs.
      inverter=Decimal.min(total,inverter);
      const size=l.key.replace(' AC Cable','').replace('1C','1-core').replace('4C','4-core');
      for(const [purpose,qty] of [['Inverter Termination',inverter],['Load Panel Termination',total.minus(inverter)]] as const)
        if(qty.gt(0))output.push({description:`AC Cable ${purpose} — ${size}${l.brand?' — '+l.brand:''}`,unit:l.unit,qty:qty.toString()});
      continue;
    }
    const labels:Record<string,string>={'2.5mm² Earthing Cable':'2.5mm² Earthing Cable — Panel to Panel','6mm² Earthing Cable':boq.survey.family==='bess-only'?'6mm² Earthing Cable — AC Side':'6mm² Earthing Cable — DC Side','10mm² Earthing Cable':'10mm² Earthing Cable — AC Side','Earthing Bore':earthingScopeDescription,'Misc. Accessories':'Miscellaneous Accessories','Labour':'Installation, Testing & Commissioning','Delivery':'Project Delivery / Logistics'};
    const description=labels[l.key]??(/Cable/.test(l.key)?l.key:l.specification&&l.specification.trim()!=='General'?l.specification:l.description.trim()!=='General'?l.description:l.key);
    output.push({description:[description,l.brand].filter(Boolean).join(' — '),unit:l.unit,qty:l.qty});
  }
  protection('AC',acKeys);protection('DC',dcKeys);
  const rank=(i:Item)=> /AC Cable Inverter/.test(i.description)?0:/AC Cable Load/.test(i.description)?1:/DC Cable Red/.test(i.description)?2:/DC Cable Black/.test(i.description)?3:/2.5mm² Earthing/.test(i.description)?4:/6mm² Earthing/.test(i.description)?5:/10mm² Earthing/.test(i.description)?6:/AC Protection Box/.test(i.description)?7:/DC Protection Box/.test(i.description)?8:/Earthing Bore/.test(i.description)?9:/Installation,/.test(i.description)?11:/Delivery/.test(i.description)?12:10;
  return output.sort((a,b)=>rank(a)-rank(b));
}

/** Preserve the existing merged financial bands in Basic Breakup. */
export function orderCustomerScopeLines(lines:QuoteLine[],presentation:string):QuoteLine[]{
  const rank=(l:QuoteLine)=>{
    const text=l.items?.[0]?.description??l.description;
    if(l.group==='solar')return 0;
    if(l.group==='structure')return 1;
    if(l.group==='bess')return 2;
    if(/AC Cable Inverter/.test(text))return 3;
    if(/DC Cable/.test(text))return 4;
    if(/2.5mm² Earthing/.test(text))return 5;
    if(/6mm² Earthing/.test(text))return 6;
    if(/10mm² Earthing/.test(text))return 7;
    if(/AC Protection Box/.test(text))return 8;
    if(/DC Protection Box/.test(text))return 9;
    if(l.group==='earthing')return 10;
    if(/Installation, Testing/.test(text))return 12;
    if(/Delivery/.test(text))return 13;
    return 11;
  };
  if(presentation!=='Basic Breakup')return [...lines].sort((a,b)=>rank(a)-rank(b));
  const bands:QuoteLine[][]=[];
  for(const l of lines){if(bands.at(-1)?.[0].group===l.group)bands.at(-1)!.push(l);else bands.push([l]);}
  return bands.flatMap(band=>{
    const anchor=band.find(l=>l.amount!==undefined);
    const sorted=band.map(l=>({...l})).sort((a,b)=>rank(a)-rank(b));
    if(anchor && (anchor.span??1)>1){
      for(const l of sorted){delete l.amount;delete l.span;}
      sorted[0].amount=anchor.amount;sorted[0].span=anchor.span;
    }
    return sorted;
  });
}
