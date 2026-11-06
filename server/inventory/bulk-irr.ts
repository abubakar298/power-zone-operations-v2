import source from './bulk-irr-source.json' with {type:'json'};
import { Decimal } from 'decimal.js';
import type {InventoryLine,ReportEntry} from './reconciliation.js';
export const BULK_IRR_ID='ubl-verified-irr-2026-10-11';
export const BULK_REFERENCE='Given in bulk by Abu Bakar — 11 October 2026';
export const verifiedGroups=Object.entries(source.rows.reduce((groups:Record<string,any[]>,row:any[])=>{if(row[0]&&row[1]) (groups[String(row[0])]??=[]).push(row);return groups;},{})).map(([originalId,rows])=>({originalId,ipo:originalId.includes('Mankera')?'316':originalId.includes('Darya')?'317':originalId.replace('CHJ','CHP').match(/CHP[- ]?(\d+)/)?.[1],rows}));
export const confirmedPanels:Record<string,[number,number]>={
 '293':[33,620],'232':[33,620],'285':[33,620],'292':[47,645],'316':[47,645],'319':[39,645],'286':[33,620],'295':[47,645],'302':[55,645],'309':[39,645],'317':[31,645],'318':[39,645],'320':[55,645],'301':[49,620],'306':[49,620],'311':[57,620],'299':[49,620],'296':[57,620],'290':[49,620],'298':[49,620],'312':[49,620],'287':[40,620]
};
export function bulkEntry(ipo:string,lines:InventoryLine[],dates:{start?:string,end?:string}={}) {
 const group=verifiedGroups.find(g=>g.ipo===ipo); if(!group)return null;
 const values=Object.fromEntries(group.rows.map(r=>[String(r[1]).replace(/\s*\[.*$/,'').trim(),String(r[2])]));
 const mapping:Record<string,string>={
 'Roof DC breaker':'DC Circuit Breaker (Roof DB)', 'Inverter room DC breaker':'DC Circuit Breaker (Inverter Room DB)',
 'DC fuse with holder':'DC Fuse with Holder (Roof DB)','DC SPD':'DC SPD',
 'Grid input 100A 4P MCCB':'Grid Input Breaker','Output 63A 4P MCB':'Inverter Output Breaker','Output 100A 4P MCCB':'Inverter Output Breaker',
 'AC SPD':'AC SPD','63A 4P Changeover':'Changeover Switch','100A Rotary Changeover with Box':'Changeover Switch',
 '16mm² 4C inverter cable':'AC Cable for Inverter Termination','16mm² 4C load cable':'AC Cable from AC Bus Bar to Load Panel','25mm² 4C load cable':'AC Cable from AC Bus Bar to Load Panel',
 'UBL earthing bore':'Earthing Pit with Copper Bonded Electrode','2.5mm² earth panel to panel':'Earth Cables Panel to Panel','6mm² DC earth':'Panels/DC combiner box to DC Earth Pit','10mm² AC earth':'Earth Cables (Inverter/AC Combiner box to AC Earth Pit)',
 'Smart meter included with inverter':'EMS & Energy Meter','Router/device plus first month':'Wifi Router with Internet of 5 MPBS'};
 const corrections=ipo==='232'?{'DC Circuit Breaker (Roof DB)':'3','DC Fuse with Holder (Roof DB)':'3','DC SPD':'3','DC Circuit Breaker (Inverter Room DB)':'3'}:{};
 Object.assign(values,corrections);
 const usage:Record<string,string>={}; const flags:string[]=['Combined DC cable split 50/50 by Abu Bakar; colour split remains assumed until IRR evidence confirms it.','Invoice differences remain under review; cable adjustments may already be included. Do not apply twice.'];
 for(const line of lines){
  if(line.key==='DC cable red 6mm²'||line.key==='DC cable black 6mm²')usage[line.key]=new Decimal(values['DC Cables (Red and Black for Positive and Negative)']).div(2).toString();
  else if(mapping[line.key]&&values[mapping[line.key]]!==undefined)usage[line.key]=values[mapping[line.key]];
  if(/^(HYB-|HV 5kWh battery$|HV BMS$|UBL genset synchronization$)/.test(line.key)) usage[line.key]=line.approved;
  if(line.group==='material'&&usage[line.key]!==undefined&&!new Decimal(usage[line.key]).eq(line.approved)&&/breaker|fuse|SPD|Changeover/i.test(line.key))flags.push(`${line.description}: approved ${line.approved}; used ${usage[line.key]}. Protection quantity difference — review required.`);
 }
 if(ipo==='232')flags.unshift('Documentation discrepancy: approved 25-20-30; reported installed solar 20,460 W. Approved configuration and prices retained.','Protection quantities corrected by Abu Bakar on 11 October 2026: 3 roof breakers, 3 fuses, 3 SPDs, 3 inverter-room breakers. Original sheet retained.');
 flags.push('Inverter, battery and BMS quantities confirmed by Abu Bakar as fully used per approved BOQ; genset synchronization completed at all 22 sites — 11 October 2026.');
 const unconfirmed=lines.filter(l=>l.group!=='watt'&&usage[l.key]===undefined).map(l=>l.description);
 flags.push('Unconfirmed items / IRR evidence needed: '+unconfirmed.join(', '));
 const installedWatts=values['PV Panels/Modules'];
 const panels=confirmedPanels[ipo];
 if(!panels||!new Decimal(panels[0]).mul(panels[1]).eq(installedWatts))throw new Error('Confirmed panel count and wattage do not reconcile with received IRR.');
 flags.push('Panel count and watts per panel confirmed directly by Abu Bakar — 11 October 2026.');
 if(lines.some(l=>l.group==='watt'&&new Decimal(installedWatts).lt(l.approved)))flags.push('Installed wattage below approved quantity; financial effect is shown in reconciliation, not automatically posted.');
 const entry:ReportEntry={start:dates.start??'',end:dates.end??'',panelCount:String(panels[0]),panelWattage:String(panels[1]),installedWatts,usage,remarks:BULK_REFERENCE+'\n'+flags.join('\n'),expectedReturns:'',receivedReturns:'',extra:[]};
 return {entry,provenance:{importId:BULK_IRR_ID,reference:BULK_REFERENCE,sourceUrl:source.sourceUrl,originalJobId:group.originalId,originalRows:group.rows,corrections,flags,unconfirmed,equipmentConfirmation:'abu-bakar-equipment-panels-2026-10-11',equipmentConfirmedFrom:'Abu Bakar',panelDetailsConfirmed:true,panelConfirmation:{count:panels[0],wattsPerPanel:panels[1],totalWatts:installedWatts,confirmedFrom:'Abu Bakar',confirmedDate:'2026-10-11'},receivedFrom:source.receivedFrom,receivedDate:source.receivedDate,signedSiteIrr:false}};
}
