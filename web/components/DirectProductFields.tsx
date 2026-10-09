import {Button} from '../ui/Button.js';
import {useEffect,useState} from 'react';
import {bessConfigurations} from '../../server/boq/bess.js';
import {singlePhaseConfigurations} from '../../server/boq/equipment.js';
import {displayUnit} from '../../server/boq/unit.js';
type Selection={kind:'item'|'bess';key:string;qty:string;brandId?:number};
export function DirectProductFields({masters,initial}:{masters:any;initial:Selection[]|undefined}) {
 const [rows,setRows]=useState<Selection[]>(initial??[{kind:'item',key:'',qty:'1'}]);
 useEffect(()=>setRows(initial??[{kind:'item',key:'',qty:'1'}]),[initial]);
 const [search,setSearch]=useState<Record<number,string>>({});
 const match=(index:number,key:string,label:string)=>key===rows[index].key || label.toLowerCase().includes((search[index]??" ").trim().toLowerCase());
 const items=masters.items.filter((i:any)=>i.status!=='Inactive'&&!/^(Labour|Delivery|Misc\. Accessories|Earthing Bore|Structure -)/.test(i.key));
 const update=(index:number,patch:Partial<Selection>)=>setRows(rows.map((r,i)=>i===index?{...r,...patch}:r));
 return <div><input type="hidden" name="directProducts" value={JSON.stringify(rows)}/><p>Select individual products or complete BESS packages. Installation and EPC work are not added.</p>{rows.map((row,index)=><div className="survey-grid" key={index} style={{padding:'var(--pz-space-4) 0',borderBottom:'1px solid var(--pz-border)'}}>
 <label>Selection type<select aria-label={`Product ${index+1} selection type`} value={row.kind} onChange={e=>update(index,{kind:e.target.value as Selection['kind'],key:'',brandId:undefined})}><option value="item">Individual product</option><option value="bess">Complete BESS ID</option></select></label>
<label>Search products / BESS IDs<input type="search" aria-label={`Search product ${index+1}`} value={search[index]??""} onChange={e=>setSearch({...search,[index]:e.target.value})} placeholder="Product name, specification or BESS ID"/></label>
 <label>{row.kind==='bess'?'BESS ID':'Product'}<select aria-label={`Product ${index+1}`} required value={row.key} onChange={e=>update(index,{key:e.target.value})}><option value="">Select {row.kind==='bess'?'BESS ID':'product'}</option>{row.kind==='bess'?[...singlePhaseConfigurations,...bessConfigurations].filter(c=>match(index,c.id,`${c.id.replace(/^BESS-/,'')} ${c.batteryKwh}`)).map(c=><option key={c.id} value={c.id}>{c.id.replace(/^BESS-/,'')} · {c.batteryKwh} kWh</option>):items.filter((item:any)=>match(index,item.key,`${item.display_name||item.key} ${item.approved_specification??''}`)).map((item:any)=><option key={item.key} value={item.key}>{item.display_name||item.key} · {displayUnit(item.unit,'2')}</option>)}</select></label>
 <label>Quantity<input aria-label={`Product ${index+1} quantity`} required type="number" min={row.kind==='bess'?'1':'0.0001'} max="99999999" step={row.kind==='bess'?'1':'0.0001'} value={row.qty} onChange={e=>update(index,{qty:e.target.value})}/></label>
 {row.kind==='item'?<label>Brand<select aria-label={`Product ${index+1} brand`} value={row.brandId??''} onChange={e=>update(index,{brandId:e.target.value?Number(e.target.value):undefined})}><option value="">Use approved item specification</option>{masters.brands.filter((b:any)=>b.status==='Active'&&b.name!=='Any of the Above').map((b:any)=><option key={b.id} value={b.id}>{b.name} · {b.category}</option>)}</select></label>:<p>Uses the approved inverter, battery and BMS configuration. Choose grouped or separate package pricing when preparing the quotation.</p>}
 {row.kind==='item'&&row.key&&<p>{items.find((i:any)=>i.key===row.key)?.approved_specification||'Specification pending master-data review.'}</p>}
 <Button variant="neutral" disabled={rows.length===1} onClick={()=>setRows(rows.filter((_,i)=>i!==index))}>Remove product</Button></div>)}<Button variant="neutral" disabled={rows.length>=30} onClick={()=>setRows([...rows,{kind:'item',key:'',qty:'1'}])}>Add product / BESS package</Button></div>;
}
