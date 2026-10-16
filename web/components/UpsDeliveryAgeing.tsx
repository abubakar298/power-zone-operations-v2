import {useState} from 'react';
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

export function UpsDeliveryAgeing({rows,asOf,awaitingDelivery=false}:{rows:Delivery[],asOf?:string,awaitingDelivery?:boolean}){
 const title=awaitingDelivery?'Awaiting delivery':'Delivered sites awaiting installation';
 const clock=awaitingDelivery?'IPO shared':'Delivered';
 const [selected,setSelected]=useState<string|null>(null);
 const groups=bands.map(b=>({...b,count:rows.filter(r=>r.band===b.key).length}));
 let position=0;
 const stops=groups.filter(b=>b.count>0).map(b=>{const start=position;position+=b.count/rows.length*100;return `${b.color} ${start}% ${position}%`;});
 const shown=rows.filter(r=>selected==='all'||r.band===selected).sort((a,b)=>(b.days??-1)-(a.days??-1)||a.orderNumber.localeCompare(b.orderNumber,undefined,{numeric:true}));
 return <section className="pz-panel pz-stack" aria-label={`${title} ageing`}>
  <div><h3>{awaitingDelivery?'Delivery ageing · awaiting delivery':'Delivery ageing · installation pending'}</h3><p className="pz-caption">Days since {awaitingDelivery?'IPO shared':'delivery'}{asOf?` · as of ${displayDate(asOf)}`:''}</p></div>
  {!rows.length?<p>{awaitingDelivery?'No active sites are currently confirmed as awaiting delivery.':'No delivered sites are currently awaiting installation.'}</p>:<>
   <div className="pz-ups-ageing">
    <div className="pz-ups-ageing-chart" role="img" aria-label={`${rows.length} ${title.toLowerCase()}. ${groups.map(b=>`${b.label}: ${b.count}`).join('; ')}`} style={{background:`conic-gradient(${stops.join(',')})`}}><div><strong>{rows.length}</strong><span>{awaitingDelivery?'awaiting delivery':'awaiting installation'}</span></div></div>
    <div className="pz-ups-ageing-legend">{groups.filter(b=>b.key!=='unknown'||b.count>0).map(b=><Button key={b.key} variant="neutral" aria-pressed={selected===b.key} onClick={()=>setSelected(selected===b.key?null:b.key)}><span className="pz-ups-ageing-swatch" style={{background:b.color}} aria-hidden="true"/><span>{b.label}</span><strong>{b.count}</strong></Button>)}<Button variant="secondary" aria-pressed={selected==='all'} onClick={()=>setSelected(selected==='all'?null:'all')}>{selected==='all'?'Hide sites':'View all pending sites'}</Button></div>
   </div>
   {selected&&<div className="pz-table-scroll"><table className="master-table"><caption>{selected==='all'?'All pending sites':groups.find(b=>b.key===selected)?.label} · {shown.length} {shown.length===1?'site':'sites'}</caption><thead><tr><th>Site / order</th><th>Site name</th><th>{clock}</th><th className="numeric">Days waiting</th></tr></thead><tbody>{shown.map(r=>{const date=awaitingDelivery?r.ipoSharedDate:r.deliveryDate;return <tr key={r.id}><td>{r.orderNumber}</td><td>{r.site||'Name required'}</td><td>{date?displayDate(date):'Date required'}</td><td className="numeric">{r.days??'Needs review'}</td></tr>;})}{!shown.length&&<tr><td colSpan={4}>No sites in this age band.</td></tr>}</tbody></table></div>}
  </>}
 </section>;
}
