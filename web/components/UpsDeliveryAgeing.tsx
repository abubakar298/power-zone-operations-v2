import {useId,useState} from 'react';
import {Button} from '../ui/Button.js';

type Delivery={id:string,orderNumber:string,site:string,deliveryDate?:string|null,ipoSharedDate?:string|null,days:number|null,band:string};
const bands=[
 {key:'0-7',label:'0–7 days',color:'var(--pz-age-recent)'},
 {key:'8-14',label:'8–14 days',color:'var(--pz-age-followup)'},
 {key:'15-30',label:'15–30 days',color:'var(--pz-age-attention)'},
 {key:'31+',label:'31+ days',color:'var(--pz-age-overdue)'},
 {key:'unknown',label:'Date required / review',color:'var(--pz-age-unknown)'}
];
const displayDate=(date:string)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));

export function UpsDeliveryAgeing({rows,awaitingDelivery=false}:{rows:Delivery[],asOf?:string,awaitingDelivery?:boolean}){
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
 const hoverGroup=groups.find(b=>b.key===hovered);
 return <section className="pz-panel pz-stack" aria-label={`${title} ageing`} onKeyDown={e=>{if(e.key==='Escape')setHovered(null);}}>
  <div><h3>{awaitingDelivery?'Delivery ageing · awaiting delivery':'Delivery Done Installation Pending'}</h3><p className="pz-caption">Days since {awaitingDelivery?'IPO shared':'delivery'}</p></div>
  {!rows.length?<p>{awaitingDelivery?'No active sites are currently confirmed as awaiting delivery.':'No delivered sites are currently awaiting installation.'}</p>:<>
   <div className="pz-ups-ageing">
    <div className="pz-ups-ageing-chart" onMouseLeave={()=>setHovered(null)}>
     <svg viewBox="0 0 200 200" aria-label={`${rows.length} ${title.toLowerCase()}`} role="group">{slices.map(b=>{const props={fill:b.color,tabIndex:0,role:'button','aria-label':`${b.label}: ${b.count} sites`,'aria-describedby':hovered===b.key?tooltipId:undefined,onMouseEnter:()=>setHovered(b.key),onFocus:()=>setHovered(b.key),onBlur:()=>setHovered(null),onClick:()=>setSelected(selected===b.key?null:b.key),onKeyDown:(e:React.KeyboardEvent)=>{if(e.key==='Escape')setHovered(null);if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(selected===b.key?null:b.key);}}};return b.count===rows.length?<circle key={b.key} cx="100" cy="100" r="100" {...props}/>:<path key={b.key} d={b.path} {...props}/>;})}</svg>
     <div className="pz-ups-ageing-center"><strong>{rows.length}</strong><span>{awaitingDelivery?'awaiting delivery':'awaiting installation'}</span></div>
    </div>
    <div className="pz-ups-ageing-legend">{groups.filter(b=>b.key!=='unknown'||b.count>0).map(b=><Button key={b.key} variant="neutral" aria-pressed={selected===b.key} onMouseEnter={()=>setHovered(b.key)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setHovered(b.key)} onBlur={()=>setHovered(null)} onClick={()=>setSelected(selected===b.key?null:b.key)}><span className="pz-ups-ageing-swatch" style={{background:b.color}} aria-hidden="true"/><span>{b.label}</span><strong>{b.count}</strong></Button>)}</div>
    {hoverGroup&&<div id={tooltipId} role="tooltip" className="pz-ups-ageing-tooltip"><strong>{hoverGroup.label} · {hoverSites.length} {hoverSites.length===1?'site':'sites'}</strong>{hoverSites.slice(0,5).map(r=><div key={r.id}><span>{r.orderNumber} · {r.site||'Name required'}</span><small>{r.days===null?'Date required / review':`${r.days} days`}</small></div>)}{hoverSites.length>5&&<small>+{hoverSites.length-5} more · select this band to view all</small>}{!hoverSites.length&&<small>No sites in this band.</small>}</div>}
   </div>
   {selected&&<div className="pz-table-scroll"><table className="master-table"><caption>{selected==='all'?'All pending sites':groups.find(b=>b.key===selected)?.label} · {shown.length} {shown.length===1?'site':'sites'}</caption><thead><tr><th>Site / order</th><th>Site name</th><th>{clock}</th><th className="numeric">Days waiting</th></tr></thead><tbody>{shown.map(r=>{const date=awaitingDelivery?r.ipoSharedDate:r.deliveryDate;return <tr key={r.id}><td>{r.orderNumber}</td><td>{r.site||'Name required'}</td><td>{date?displayDate(date):'Date required'}</td><td className="numeric">{r.days??'Needs review'}</td></tr>;})}{!shown.length&&<tr><td colSpan={4}>No sites in this age band.</td></tr>}</tbody></table></div>}
  </>}
 </section>;
}
