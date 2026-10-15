import {Decimal} from 'decimal.js';
import type {Pool,PoolClient} from 'pg';
export const UBL_STANDARD_REVIEW_MESSAGE = "Not in line with agreed UBL standards. Please discuss with UBL Management.";
export function ublConfigurationReview(s:any, approved:any) {
 const inverter=String(s.inverter??'').match(/^(?:(\d+)×)?([\d.]+) kW/);
 const parts=String(approved.solutionId??'').split('-');
 const differences:string[]=[];
 const watts=new Decimal(approved.pvWatts??0),panelWatts=new Decimal(s.panelWattage||0);
 const roundedPanelCount=panelWatts.gt(0)?watts.div(panelWatts).toDecimalPlaces(0,Decimal.ROUND_HALF_UP):null;
 if(!roundedPanelCount||!roundedPanelCount.eq(s.panelQty??-1)) differences.push('PV capacity differs from the agreed configuration beyond whole-panel rounding.');
 if(parts.length===3){
  if(!inverter||!new Decimal(inverter[1]??1).mul(inverter[2]).eq(parts[1])) differences.push('Inverter capacity differs from the agreed configuration.');
  if(!new Decimal(s.batteryKwh??-1).eq(parts[2])) differences.push('Battery capacity differs from the agreed configuration.');
 }
 return {needsReview:differences.length>0,message:differences.length?UBL_STANDARD_REVIEW_MESSAGE:'',differences,panelRoundingOnly:!!roundedPanelCount&&roundedPanelCount.eq(s.panelQty??-1)&&!watts.eq(new Decimal(s.panelQty??0).mul(panelWatts))};
}
/** Compare measured inputs to a frozen approved BOQ, without altering costs or commercial basis. */
export async function ublSurveyComparison(c:Pool|PoolClient,r:any,basis:any){
 const customer=(await c.query('SELECT short_code FROM customers WHERE id=$1',[r.customer_id])).rows[0];
 if(customer?.short_code?.toUpperCase()!=='UBL'||r.route!=='survey-framework')return null;
 const s=r.data?.surveyInputs;
 if(!s)return {rows:[],pending:'Standard BOQ inputs have not been saved.',source:basis.source};
 const lines=basis.boq.lines;
 const sum=(test:(line:any)=>boolean)=>lines.filter(test).reduce((n:Decimal,l:any)=>n.add(l.qty),new Decimal(0)).toString();
 const q=(description:string)=>sum(l=>l.description===description);
 const rows:any[]=[];
 const add=(field:string,approved:any,entered:any,numeric=false)=>{
  const missing=entered==null||entered==='';
  let different=missing||String(approved)!==String(entered);
  if(!missing&&numeric){try{different=!new Decimal(approved).eq(entered);}catch{different=true;}}
  let status=missing?'Not entered':different?`Approved: ${approved??'Not specified'}; entered: ${entered}`:'Matches';
  if(!missing&&numeric&&different){
   try{const difference=new Decimal(entered).sub(approved);const unit=field.match(/\((W|kW|kWh|m)\)/)?.[1]??'';status=`${difference.abs().toString()}${unit?' '+unit:''} ${difference.gt(0)?'above':'below'} approved`;}catch{}
  }
  rows.push({field,approved:approved==null?'Not specified':String(approved),entered:missing?'Not entered':String(entered),different,status});
 };
 add('Solution family',basis.boq.survey.family,s.family);
 add('PV capacity (W)',basis.boq.engineering.pvWatts,s.panelQty!=null&&s.panelWattage!==''?new Decimal(s.panelQty).mul(s.panelWattage).toString():null,true);
 const configuration=basis.boq.engineering.solutionId?.split('-');
 if(configuration?.length===3){
  const match=String(s.inverter??'').match(/^(?:(\d+)×)?([\d.]+) kW/);
  add('Inverter capacity (kW)',configuration[1],match?new Decimal(match[1]??1).mul(match[2]).toString():null,true);
  add('Battery capacity (kWh)',configuration[2],s.batteryKwh,true);
  add('Inverter quantity',sum(l=>/HYB|inverter/i.test(l.key)&&l.phase==='BESS'),match?match[1]??'1':null,true);
 }
 add('Structure',lines.find((l:any)=>l.key.startsWith('Structure'))?.key.replace('Structure - ',''),s.structure);
 for(const [field,key,description] of [
  ['DC cable combined red/black (m)','dcMetres','DC'],
  ['16mm² inverter cable (m)','acInverter16','16mm² 4C inverter cable'],
  ['25mm² inverter cable (m)','acInverter25','25mm² 4C inverter cable'],
  ['16mm² load cable (m)','acPanel16','16mm² 4C load cable'],
  ['25mm² load cable (m)','acPanel25','25mm² 4C load cable'],
  ['2.5mm² earth cable (m)','earth25','2.5mm² earth panel to panel'],
  ['6mm² DC earth cable (m)','earth6','6mm² DC earth'],
  ['10mm² AC earth cable (m)','earth10','10mm² AC earth']
 ])add(field,description==='DC'?sum(l=>/^DC cable (red|black) 6mm²$/.test(l.description)):q(description),s[key]??'0',true);
 add('Include Earthing Bore?',new Decimal(q('UBL earthing bore')).gt(0)?'Yes':'No',s.spIncludeEarthingBore===false?'No':'Yes');
 add('Genset synchronisation',new Decimal(q('UBL genset synchronization')).gt(0)?'Yes':'No',s.genset?'Yes':'No');
 add('Extra smart meter',basis.boq.survey.smartMeter===true?'Yes':'No',s.smartMeter==null?null:s.smartMeter?'Yes':'No');
 const brands=(await c.query('SELECT id,name FROM brands')).rows;
 for(const [key,label,test] of [
  ['inverter','Inverter brand',(l:any)=>/HYB|inverter/i.test(l.key)&&l.phase==='BESS'],
  ['battery','Battery / BMS brand',(l:any)=>/BAT|BMS/i.test(l.key)&&l.phase==='BESS'],
  ['cable','Cable brand',(l:any)=>/Cable/.test(l.key)],
  ['switchgear','Switchgear brand',(l:any)=>/MCB|MCCB|SPD|Breaker|Fuse/.test(l.key)]
 ] as const){const expected=[...new Set(lines.filter(test).map((l:any)=>l.brand))].join(', ');const selected=brands.find(b=>b.id===s.brands?.[key])?.name;if(expected&&selected)add(label,expected,selected);}
 return {source:basis.source,rows,standardsReview:ublConfigurationReview(s,basis.boq.engineering),notes:'Panel count and wattage are assessed together against agreed PV capacity. The approved BOQ does not fix an individual panel wattage. The standard UBL smart meter is included with the inverter; Extra smart meter means an additional meter. Brand selection is completed by Atif; unselected brands are not survey discrepancies. Financial snapshots remain unchanged.'};
}
