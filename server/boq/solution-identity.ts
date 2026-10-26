import {Decimal} from 'decimal.js';
import {findBess} from './bess.js';
import {singlePhaseConfigurations} from './equipment.js';
export function solutionValues(input:any){
 const bess=findBess(input.bessId??'')??singlePhaseConfigurations.find(b=>b.id===input.bessId);
 const inverter=bess?new Decimal(bess.inverterKw).mul(bess.inverterQty):(()=>{const match=String(input.inverter??'').match(/^(?:(\d+)×)?(\d+(?:\.\d+)?)\s*kW/);return match?new Decimal(match[2]).mul(match[1]??1):null;})();
 const pv=new Decimal(input.panelQty||0).mul(input.panelWattage||0),battery=new Decimal(bess?.batteryKwh??(input.batteryKwh||0));
 return{panelQty:String(input.panelQty??''),panelWattage:String(input.panelWattage??''),pvWatts:pv.toString(),inverterKw:inverter?.toString()??'',batteryKwh:battery.toString(),solutionId:!inverter?'N/A':input.family==='bess-only'?`UPS-${inverter}-${battery}`:`${pv.div(1000).toFixed(1,Decimal.ROUND_HALF_UP)}-${inverter}-${battery}`};
}
export function solutionDifferences(before:any,after:any){
 const a=solutionValues(before),b=solutionValues(after);
 return [['panelQty','Panel quantity'],['panelWattage','Panel wattage (W)'],['pvWatts','PV capacity (W)'],['inverterKw','Inverter capacity (kW)'],['batteryKwh','Battery capacity (kWh)']].filter(([key])=>{try{return!new Decimal((a as any)[key]).eq((b as any)[key]);}catch{return(a as any)[key]!== (b as any)[key];}}).map(([key,label])=>({field:label,before:(a as any)[key],after:(b as any)[key]}));
}
