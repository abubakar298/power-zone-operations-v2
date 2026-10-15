import {Decimal} from 'decimal.js';
import {DISCOUNT_POLICY} from '../commercial/discount-strategy.js';
const categories=['Installation Cost','Earthing Cost','Electrical Labour','Deliveries'];
const categoryOf=(l:any)=>/^(electrical labour|labour)$/i.test(l.key??'')?'Electrical Labour':/^(delivery\/logistics|delivery|deliveries)$/i.test(l.key??'')?'Deliveries':categories.includes(l.epc)?l.epc:'Installation Cost';
function phaseOf(l:any){return l.phase==='Solar Panels'?'Solar Panels':l.phase==='Structure'?'Structure':/^(HYB-|CH-PCS-)/.test(l.key)?'Inverter':/^(BAT-|CH-BAT-)/.test(l.key)?'Batteries':/^(BMS-|CH-BMS-)/.test(l.key)?'BMS':l.phase==='BESS'?'BESS':'EPC';}
/** Detail of a frozen accepted phase, never a fresh costing or commercial calculation. */
export function ptDetail(snapshot:any,boq:any,approvedPanelQty=boq.survey?.panelQty){
 const d=structuredClone(snapshot.peachtree);if(!d)return undefined;
 const lines=boq.lines??[];
 if(snapshot.allocation?.policy==='fixed-bank-ups'){
   d.phases=d.phases.filter((p:any)=>['Inverter','Batteries','BMS','EPC'].includes(p.name)).map((p:any)=>{const source=lines.filter((l:any)=>phaseOf(l)===p.name);return {...p,name:p.name==='EPC'?'Installations':p.name,itemId:p.name==='EPC'?'CH-Installations':[...new Set(source.map((l:any)=>l.itemId??l.key))].join('\n'),description:p.name==='EPC'?'Installation, testing and commissioning':source.map((l:any)=>`${l.qty} ${l.unit} x ${l.specification||l.description||l.key}`).join('\n')};});
   delete d.epcBreakup;
   return d;
 }

 d.phases=d.phases.map((p:any)=>{
   if(p.name==='EPC')return {...p,itemId:'CH-EPC',description:'Installations'};
   if(p.name==='Solar Panels')return {...p,itemId:'CH-Solar Panels-General',description:'Solar Panels - Revise at IRR stage.'};
   const source=lines.filter((l:any)=>phaseOf(l)===p.name||(p.name==='BESS'&&['Inverter','Batteries','BMS','BESS'].includes(phaseOf(l))));
   return {...p,itemId:[...new Set(source.map((l:any)=>l.itemId??l.key))].join('\n'),description:source.map((l:any)=>`${l.qty} ${l.unit} x ${l.specification||l.description||l.key}`).join('\n')||p.description};
 });
 const epc=d.phases.find((p:any)=>p.name==='EPC');if(!epc)return d;
 if(snapshot.allocation?.policy===DISCOUNT_POLICY){
   const field=d.taxMode==='Tax Included'?'total':'beforeTax';
   d.epcBreakup=categories.map((name,index)=>{const allocated=snapshot.allocation.lines.filter((l:any)=>l.phase==='EPC'&&l.epcCategory===name),source=lines.filter((l:any)=>phaseOf(l)==='EPC'&&categoryOf(l)===name),sum=(key:string)=>allocated.reduce((s:Decimal,l:any)=>s.add(l[key]??0),new Decimal(0)).toFixed(2);return {name,amount:sum(field),approvedDiscount:sum('approvedDiscount'),managementSpecialDiscount:sum('managementSpecialDiscount'),itemId:['CH-EPC','CH-Earthing','CH-Electrical Labor','CH-Deliveries'][index],description:index===0?'Installations':source.map((l:any)=>`${l.qty} ${l.unit} x ${l.specification||l.description||l.key}`).join('\n')||name};});
   if(d.epcBreakup.reduce((s:Decimal,p:any)=>s.add(p.amount),new Decimal(0)).toFixed(2)!==new Decimal(epc.amount).toFixed(2))throw Error('Accepted EPC detail does not reconcile.');
   d.epcBreakupBasis='Saved accepted item selling values after approved and Management Special Discount; no redistribution to protected earthing work.';
   return d;
 }
 const amounts=categories.map(name=>lines.filter((l:any)=>phaseOf(l)==='EPC'&&categoryOf(l)===name).reduce((s:Decimal,l:any)=>s.plus(l.total??0),new Decimal(0)));
 const cost=amounts.reduce((s:Decimal,v:Decimal)=>s.plus(v),new Decimal(0)),target=new Decimal(epc.amount);
 const cents=target.mul(100).toDecimalPlaces(0),exact=amounts.map((v:Decimal)=>cost.gt(0)?cents.mul(v).div(cost):new Decimal(0)),rounded=exact.map((v:Decimal)=>v.floor());
 if(cost.gt(0)){const remaining=cents.minus(rounded.reduce((s:Decimal,v:Decimal)=>s.plus(v),new Decimal(0))).toNumber();const order=exact.map((v:Decimal,index:number)=>({index,remainder:v.minus(rounded[index])})).sort((a,b)=>b.remainder.comparedTo(a.remainder)||a.index-b.index);for(let i=0;i<remaining;i++)rounded[order[i].index]=rounded[order[i].index].plus(1);}else rounded[0]=cents;
 d.epcBreakup=categories.map((name,index)=>{const source=lines.filter((l:any)=>phaseOf(l)==='EPC'&&categoryOf(l)===name);return{name,amount:rounded[index].div(100).toFixed(2),itemId:['CH-EPC','CH-Earthing','CH-Electrical Labor','CH-Deliveries'][index],description:index===0?'Installations':source.map((l:any)=>`${l.qty} ${l.unit} x ${l.specification||l.description||l.key}`).join('\n')||name};});
 d.epcBreakupBasis=cost.gt(0)?'Accepted EPC selling total allocated in proportion to its saved BOQ category costs. No fresh rates or markup applied.':'Accepted EPC selling total; detailed category costs were not recorded.';
 return d;
}
export function ptDisplayRows(d:any){return d.phases.flatMap((p:any)=>p.name==='EPC'&&d.epcBreakup?.length?d.epcBreakup.map((r:any)=>({...r,name:r.name==='Installation Cost'?'EPC':r.name==='Earthing Cost'?'Earthing':r.name})):p);}
