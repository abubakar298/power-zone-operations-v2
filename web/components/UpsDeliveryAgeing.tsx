import {useId,useState} from 'react';
import {Button} from '../ui/Button.js';

type Delivery={id:string,orderNumber:string,site:string,deliveryDate?:string|null,ipoSharedDate?:string|null,days:number|null,band:string,delayOwner?:string,delayReason?:string};
const bands=[
 {key:'0-7',label:'0–7 days',color:'var(--pz-age-recent)'},
 {key:'8-14',label:'8–14 days',color:'var(--pz-age-followup)'},
 {key:'15-30',label:'15–30 days',color:'var(--pz-age-attention)'},
 {key:'31+',label:'31+ days',color:'var(--pz-age-overdue)'},
 {key:'unknown',label:'Date required',color:'var(--pz-age-unknown)'}
];
const displayDate=(date:string)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));

export function UpsDeliveryAgeing({rows,awaitingDelivery=false,customer='UBL'}:{customer?:'UBL'|'MBL',rows:Delivery[],asOf?:string,awaitingDelivery?:boolean}){
 const title=awaitingDelivery?'Awaiting delivery':'Delivered sites awaiting installation';
 const clock=awaitingDelivery?'IPO shared':'Delivered';
 const [selected,setSelected]=useState<string|null>(null);
 const [hovered,setHovered]=useState<string|null>(null),tooltipId=useId();
 const groups=bands.map(b=>({...b,count:rows.filter(r=>r.band===b.key).length}));
 let position=0;
 const slices=groups.filter(b=>b.count>0).map(b=>{
  const start=position;position+=b.count/rows.length*360;
  const point=(angle:number)=>[100+100*Math.cos((angle-90)*Math.PI/180),100+100*Math.sin((angle-90)*Math.PI/180)];
  const a=point(start),z=point(position);
  return {...b,path:`M100 100 L${a[0]} ${a[1]} A100 100 0 ${position-start>180?1:0} 1 ${z[0]} ${z[1]} Z`};
 });
 const shown=rows.filter(r=>selected==='all'||r.band===selected).sort((a,b)=>(b.days??-1)-(a.days??-1)||a.orderNumber.localeCompare(b.orderNumber,undefined,{numeric:true}));
 const hoverSites=rows.filter(r=>r.band===hovered).sort((a,b)=>(b.days??-1)-(a.days??-1));
 const owner=(r:Delivery)=>r.delayOwner==='PZ'?'PZ':r.delayOwner==='UBL'||r.delayOwner==='MBL'?customer:'Unclassified';
 const ownerClass=(r:Delivery)=>owner(r)==='PZ'?'pz-delay-pz':owner(r)==='Unclassified'?'pz-delay-unknown':'pz-delay-bank';
 const counts=['bank','pz','unknown'].map(key=>({key,label:key==='bank'?`${customer} Delay`:key==='pz'?'PZ Delay':'Unclassified',count:hoverSites.filter(r=>key==='bank'?owner(r)===customer:key==='pz'?owner(r)==='PZ':owner(r)==='Unclassified').length}));
 const hoverGroup=groups.find(b=>b.key===hovered);
 return <section className="pz-panel pz-stack pz-ups-ageing-panel" aria-label={`${title} ageing`} onKeyDown={e=>{if(e.key==='Escape')setHovered(null);}}>
  <div><h3>{awaitingDelivery?'PO Received - Delivery Pending':'Delivery Done - Installation Pending'}</h3><p className="pz-caption">Days since {awaitingDelivery?'IPO shared':'delivery'}</p></div>
  <>
   <div className="pz-ups-ageing">
    <div className="pz-ups-ageing-chart" onMouseLeave={()=>setHovered(null)}>
     <svg viewBox="0 0 200 200" aria-label={`${rows.length} ${title.toLowerCase()}`} role="group">{!slices.length&&<circle cx="100" cy="100" r="100" fill="var(--pz-age-unknown)"/>}{slices.map(b=>{const props={fill:b.color,tabIndex:0,role:'button','aria-label':`${b.label}: ${b.count} sites`,'aria-describedby':hovered===b.key?tooltipId:undefined,onMouseEnter:()=>setHovered(b.key),onFocus:()=>setHovered(b.key),onBlur:()=>setHovered(null),onClick:()=>setSelected(selected===b.key?null:b.key),onKeyDown:(e:React.KeyboardEvent)=>{if(e.key==='Escape')setHovered(null);if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(selected===b.key?null:b.key);}}};return b.count===rows.length?<circle key={b.key} cx="100" cy="100" r="100" {...props}/>:<path key={b.key} d={b.path} {...props}/>;})}</svg>
     <div className="pz-ups-ageing-center"><strong>{rows.length}</strong><span>{awaitingDelivery?'awaiting delivery':'awaiting installation'}</span></div>
    </div>
    <div className="pz-ups-ageing-legend">{groups.filter(b=>b.key!=='unknown'||b.count>0).map(b=><Button key={b.key} variant="neutral" aria-pressed={selected===b.key} onMouseEnter={()=>setHovered(b.key)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setHovered(b.key)} onBlur={()=>setHovered(null)} onClick={()=>setSelected(selected===b.key?null:b.key)}><span className="pz-ups-ageing-swatch" style={{background:b.color}} aria-hidden="true"/><span>{b.label}</span><strong>{b.count}</strong></Button>)}<div className="pz-ups-delay-legend" aria-label="Delay responsibility legend"><span className="pz-delay-bank">{customer} Delay</span><span className="pz-delay-pz">PZ Delay</span><span className="pz-delay-unknown">Unclassified</span></div></div>
    {hoverGroup&&<div id={tooltipId} role="tooltip" className="pz-ups-ageing-tooltip"><strong>{hoverGroup.label}</strong><div className="pz-ups-delay-counts">{counts.filter(c=>c.count>0).map(c=><span className={`pz-delay-${c.key}`} key={c.key}>{c.label}: {c.count} {c.count===1?'site':'sites'}</span>)}</div>{hoverSites.slice(0,5).map(r=><div key={r.id}><span className={ownerClass(r)}>{r.orderNumber} · {r.site||'Name required'}<em>{r.delayReason||'Reason not recorded'}</em></span><small>{r.days===null?'Date required / review':`${r.days} days`}</small></div>)}{hoverSites.length>5&&<small>+{hoverSites.length-5} more · select this band to view all</small>}{!hoverSites.length&&<small>No sites in this band.</small>}</div>}
   </div>
   <p className="pz-caption pz-ups-ageing-note">{!rows.length?(awaitingDelivery?'No active sites are currently confirmed as awaiting delivery.':'No delivered sites are currently awaiting installation.'):'Select an age band for site details.'}</p>
   {selected&&<div className="pz-table-scroll"><table className="master-table"><caption>{selected==='all'?'All pending sites':groups.find(b=>b.key===selected)?.label} · {shown.length} {shown.length===1?'site':'sites'}</caption><thead><tr><th>Site / order</th><th>Site name</th><th>{clock}</th><th className="numeric">Days waiting</th></tr></thead><tbody>{shown.map(r=>{const date=awaitingDelivery?r.ipoSharedDate:r.deliveryDate;return <tr key={r.id}><td>{r.orderNumber}</td><td>{r.site||'Name required'}</td><td>{date?displayDate(date):'Date required'}</td><td className="numeric">{r.days??'Needs review'}</td></tr>;})}{!shown.length&&<tr><td colSpan={4}>No sites in this age band.</td></tr>}</tbody></table></div>}
  </>
 </section>;
}
